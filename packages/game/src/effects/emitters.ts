import { addComponent, addEntity, removeEntity } from 'bitecs'
import { addMember, removeMember } from '../core/dense-set.ts'
import { screenX, screenY } from '../core/iso.ts'
import { TIMER_EFFECT_END, type EffectKindState, type Sim } from '../core/sim.ts'
import { schedule } from '../core/timers.ts'

export type EffectDefinition = {
  readonly name: string
  readonly shader: string
  readonly particles: number
  readonly lifetime: number
  readonly attached: boolean
  readonly blend: string
  readonly params: Readonly<Record<string, number | readonly number[]>>
}

export const EMITTER_STRIDE = 8
export const NOT_SPAWNED = -1

export const registerEffectKind = (sim: Sim, definition: EffectDefinition): number => {
  const capacity = sim.config.budgets.effectEmittersPerKind
  const data = new Float32Array(capacity * EMITTER_STRIDE)

  for (let slot = 0; slot < capacity; slot++) {
    data[slot * EMITTER_STRIDE + 2] = NOT_SPAWNED
  }

  sim.effects.push({
    name: definition.name,
    particles: definition.particles,
    lifetimeMs: definition.lifetime * 1000,
    attached: definition.attached,
    data,
    used: new Uint8Array(capacity),
    free: new Uint16Array(capacity),
    freeCount: 0,
    highWater: 0,
    active: 0,
    dirty: true,
    dropped: 0,
  })

  return sim.effects.length - 1
}

const takeSlot = (kind: EffectKindState): number => {
  if (kind.freeCount > 0) {
    kind.freeCount -= 1

    return kind.free[kind.freeCount]!
  }

  if (kind.highWater >= kind.used.length) {
    return -1
  }

  kind.highWater += 1

  return kind.highWater - 1
}

const releaseSlot = (kind: EffectKindState, slot: number): void => {
  kind.used[slot] = 0
  kind.data[slot * EMITTER_STRIDE + 2] = NOT_SPAWNED

  if (slot === kind.highWater - 1) {
    kind.highWater -= 1

    while (kind.highWater > 0 && kind.used[kind.highWater - 1] === 0) {
      kind.highWater -= 1
    }

    kind.freeCount = 0

    for (let i = 0; i < kind.highWater; i++) {
      if (kind.used[i] === 0) {
        kind.free[kind.freeCount] = i
        kind.freeCount += 1
      }
    }
  } else {
    kind.free[kind.freeCount] = slot
    kind.freeCount += 1
  }

  kind.dirty = true
}

export const effectClock = (sim: Sim, now: number): number => (now - sim.epoch) / 1000

const writeOrigin = (sim: Sim, kind: EffectKindState, slot: number, target: number): void => {
  const x = sim.stores.position.x[target]!
  const y = sim.stores.position.y[target]!
  kind.data[slot * EMITTER_STRIDE] = screenX(x, y)
  kind.data[slot * EMITTER_STRIDE + 1] = screenY(x, y)
}

export const spawnEffect = (sim: Sim, kindId: number, target: number, now: number): number => {
  const kind = sim.effects[kindId]!
  const slot = takeSlot(kind)

  if (slot === -1) {
    kind.dropped += 1

    return -1
  }

  const eid = addEntity(sim.world)
  addComponent(sim.world, eid, sim.effectTag)
  const { emitter } = sim.stores
  emitter.kind[eid] = kindId
  emitter.slot[eid] = slot
  emitter.target[eid] = target
  emitter.end[eid] = now + kind.lifetimeMs
  emitter.serial[eid] = (emitter.serial[eid]! + 1) >>> 0
  kind.used[slot] = 1
  kind.active += 1
  writeOrigin(sim, kind, slot, target)
  kind.data[slot * EMITTER_STRIDE + 2] = effectClock(sim, now)
  kind.data[slot * EMITTER_STRIDE + 3] = sim.random() * 1000
  kind.dirty = true
  schedule(sim.timers, emitter.end[eid], eid, emitter.serial[eid], TIMER_EFFECT_END)

  if (kind.attached) {
    addMember(sim.attachedEmitters, eid)
  }

  return eid
}

export const endEffect = (sim: Sim, eid: number): void => {
  const { emitter } = sim.stores
  const kind = sim.effects[emitter.kind[eid]!]!
  releaseSlot(kind, emitter.slot[eid]!)
  kind.active -= 1
  removeMember(sim.attachedEmitters, eid)
  removeEntity(sim.world, eid)
}

export const followTargets = (sim: Sim): void => {
  const { emitter } = sim.stores
  const { dense } = sim.attachedEmitters

  for (let i = 0; i < sim.attachedEmitters.size; i++) {
    const eid = dense[i]!
    const kind = sim.effects[emitter.kind[eid]!]!
    writeOrigin(sim, kind, emitter.slot[eid]!, emitter.target[eid]!)
    kind.dirty = true
  }
}
