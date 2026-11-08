import { stateId } from '../../core/fsm.ts'
import { NONE } from '../../core/hero-index.ts'
import type { Sim } from '../../core/sim.ts'

export type Board = {
  count: number
  since: number
}

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
export const WAIT_NOTICE = 2
export const WAIT_LOOT = 3
export const BOARD = 0

export const createBoard = (): Board => ({ count: 0, since: 0 })

export const createAttentionQueue = (sim: Sim): AttentionQueue => ({
  order: new Int32Array(sim.config.budgets.heroes + 1),
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

const rankOf = (sim: Sim, id: number): number => (id === BOARD ? WAIT_NOTICE : waitOf(sim, id))

const sinceOf = (sim: Sim, board: Board, id: number, wait: number): number =>
  id === BOARD ? board.since : waitSince(sim, id, wait)

const before = (sim: Sim, board: Board, a: number, b: number): number => {
  const waitA = rankOf(sim, a)
  const waitB = rankOf(sim, b)

  return waitA - waitB || sinceOf(sim, board, a, waitA) - sinceOf(sim, board, b, waitB) || a - b
}

const collect = (queue: AttentionQueue, sim: Sim, board: Board): void => {
  const { index } = sim
  const { behavior } = sim.stores

  if (board.count > 0) {
    queue.order[0] = BOARD
    queue.size = 1
  }

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

export const nextInQueue = (
  queue: AttentionQueue,
  sim: Sim,
  board: Board,
  current: number,
): number => {
  queue.size = 0
  collect(queue, sim, board)

  if (queue.size === 0) {
    return NONE
  }

  queue.order.subarray(0, queue.size).sort((a, b) => before(sim, board, a, b))

  for (let i = 0; i < queue.size; i++) {
    if (queue.order[i] === current) {
      return queue.order[(i + 1) % queue.size]!
    }
  }

  return queue.order[0]!
}
