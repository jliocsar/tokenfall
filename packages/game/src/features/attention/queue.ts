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

export const createAttentionQueue = (sim: Sim): AttentionQueue => ({
  order: new Int32Array(sim.config.budgets.heroes),
  dying: stateId(sim.machine, 'dying'),
  dead: stateId(sim.machine, 'dead'),
  size: 0,
})

const collect = (queue: AttentionQueue, sim: Sim, status: number): void => {
  const { index } = sim
  const { hero, behavior } = sim.stores

  for (let slot = 0; slot < index.nextSlot; slot++) {
    const eid = index.entityOf[slot]!

    if (eid === NONE || hero.status[eid] !== status) {
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
  collect(queue, sim, BLOCKED)
  collect(queue, sim, DONE)

  if (queue.size === 0) {
    return NONE
  }

  for (let i = 0; i < queue.size; i++) {
    if (queue.order[i] === current) {
      return queue.order[(i + 1) % queue.size]!
    }
  }

  return queue.order[0]!
}
