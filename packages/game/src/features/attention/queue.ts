import { stateId } from '../../core/fsm.ts'
import { NONE } from '../../core/hero-index.ts'
import type { Sim } from '../../core/sim.ts'

export type AttentionQueue = {
  readonly order: Int32Array
  readonly dying: number
  readonly dead: number
  size: number
}

const BLOCKED = 3
const DONE = 2

export const WAIT_NONE = -1
export const WAIT_PERMISSION = 0
export const WAIT_INBOX = 1
export const WAIT_LOOT = 2

export const createAttentionQueue = (sim: Sim): AttentionQueue => ({
  order: new Int32Array(sim.config.budgets.heroes),
  dying: stateId(sim.machine, 'dying'),
  dead: stateId(sim.machine, 'dead'),
  size: 0,
})

export const waitOf = (sim: Sim, eid: number): number => {
  const { hero } = sim.stores

  if (hero.status[eid] === BLOCKED) {
    return WAIT_PERMISSION
  }

  if (hero.ravens[eid]! > 0) {
    return WAIT_INBOX
  }

  return hero.status[eid] === DONE ? WAIT_LOOT : WAIT_NONE
}

export const waitSince = (sim: Sim, eid: number, wait: number): number =>
  wait === WAIT_INBOX ? sim.stores.hero.ravenSince[eid]! : sim.stores.hero.statusSince[eid]!

const before = (sim: Sim, a: number, b: number): number => {
  const waitA = waitOf(sim, a)
  const waitB = waitOf(sim, b)

  return waitA - waitB || waitSince(sim, a, waitA) - waitSince(sim, b, waitB) || a - b
}

const collect = (queue: AttentionQueue, sim: Sim): void => {
  const { index } = sim
  const { behavior } = sim.stores

  for (let slot = 0; slot < index.nextSlot; slot++) {
    const eid = index.entityOf[slot]!

    if (eid === NONE || waitOf(sim, eid) === WAIT_NONE) {
      continue
    }

    const state = behavior.state[eid]!

    if (state !== queue.dying && state !== queue.dead) {
      queue.order[queue.size] = eid
      queue.size += 1
    }
  }
}

export const nextInQueue = (queue: AttentionQueue, sim: Sim, current: number): number => {
  queue.size = 0
  collect(queue, sim)

  if (queue.size === 0) {
    return NONE
  }

  queue.order.subarray(0, queue.size).sort((a, b) => before(sim, a, b))

  for (let i = 0; i < queue.size; i++) {
    if (queue.order[i] === current) {
      return queue.order[(i + 1) % queue.size]!
    }
  }

  return queue.order[0]!
}
