import { hordeSize, sceneLength } from './death-scene.ts'
import { directionOf } from './iso.ts'
import type { Sim } from './sim.ts'

export type Horde = {
  readonly victim: Int32Array
  readonly x: Float32Array
  readonly y: Float32Array
  readonly dir: Uint8Array
  readonly start: Float64Array
  active: number
}

export const NO_VICTIM = -1

export const createHorde = (size: number): Horde => ({
  victim: new Int32Array(size).fill(NO_VICTIM),
  x: new Float32Array(size),
  y: new Float32Array(size),
  dir: new Uint8Array(size),
  start: new Float64Array(size),
  active: 0,
})

export const summonHorde = (sim: Sim, eid: number, now: number): void => {
  const { horde } = sim
  const { scene } = sim.config.death
  const count = hordeSize(scene, sim.stores.hero.level[eid]!)

  if (count > horde.victim.length - horde.active) {
    sim.counters.hordeSkipped += 1

    return
  }

  const hx = sim.stores.position.x[eid]!
  const hy = sim.stores.position.y[eid]!
  const turn = (eid % 8) * 0.39
  let placed = 0

  for (let slot = 0; slot < horde.victim.length && placed < count; slot++) {
    if (horde.victim[slot] !== NO_VICTIM) {
      continue
    }

    const angle = turn + (placed / count) * Math.PI * 2
    const x = hx + Math.cos(angle) * scene.ring
    const y = hy + Math.sin(angle) * scene.ring
    horde.victim[slot] = eid
    horde.x[slot] = x
    horde.y[slot] = y
    horde.dir[slot] = directionOf(hx - x, hy - y)
    horde.start[slot] = now
    horde.active += 1
    placed += 1
  }
}

export const dismissHorde = (sim: Sim, now: number): void => {
  const { horde } = sim

  if (horde.active === 0) {
    return
  }

  const dying = sim.dyingState
  const length = sceneLength(sim.config.death.scene) - sim.config.death.scene.fadeMs

  for (let slot = 0; slot < horde.victim.length; slot++) {
    const victim = horde.victim[slot]!

    if (
      victim !== NO_VICTIM &&
      (sim.stores.behavior.state[victim] !== dying || now - horde.start[slot]! >= length)
    ) {
      horde.victim[slot] = NO_VICTIM
      horde.active -= 1
    }
  }
}
