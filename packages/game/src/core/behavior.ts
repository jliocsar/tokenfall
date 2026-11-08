import { HERO_STATUSES } from '@tokenfall/protocol/hero'
import { enterState, NO_TRANSITION, nextState } from './fsm.ts'
import { addMember, removeMember } from './dense-set.ts'
import { dungeonSpot, entranceSpot, jitter, partySpot } from './layout.ts'
import { TIMER_STATE, TIMER_WANDER, type Sim } from './sim.ts'
import { schedule } from './timers.ts'

type Action = (sim: Sim, eid: number, now: number) => void

const TELEPORT_DISTANCE = 12

export const moveTo = (sim: Sim, eid: number, x: number, y: number): void => {
  const { motion } = sim.stores
  motion.tx[eid] = x
  motion.ty[eid] = y
  motion.speed[eid] = sim.config.tuning.walkSpeed
  addMember(sim.moving, eid)
}

export const teleport = (sim: Sim, eid: number, x: number, y: number): void => {
  sim.stores.position.x[eid] = x
  sim.stores.position.y[eid] = y
  removeMember(sim.moving, eid)
}

const setAnchor = (sim: Sim, eid: number): void => {
  sim.stores.anchor.x[eid] = sim.scratch[0]!
  sim.stores.anchor.y[eid] = sim.scratch[1]!
}

const settleAtCamp: Action = (sim, eid) => {
  partySpot(sim, sim.stores.hero.party[eid]!, sim.scratch)
  jitter(sim, sim.config.town.party.radius, sim.scratch)
  setAnchor(sim, eid)
  const dx = sim.scratch[0]! - sim.stores.position.x[eid]!
  const dy = sim.scratch[1]! - sim.stores.position.y[eid]!

  if (Math.hypot(dx, dy) > TELEPORT_DISTANCE) {
    teleport(sim, eid, sim.scratch[0]!, sim.scratch[1]!)

    return
  }

  moveTo(sim, eid, sim.scratch[0]!, sim.scratch[1]!)
}

const walkToEntrance: Action = (sim, eid) => {
  entranceSpot(sim, sim.stores.hero.guild[eid]!, sim.scratch)
  moveTo(sim, eid, sim.scratch[0]!, sim.scratch[1]!)
}

const exitDungeon: Action = (sim, eid) => {
  entranceSpot(sim, sim.stores.hero.guild[eid]!, sim.scratch)
  teleport(sim, eid, sim.scratch[0]!, sim.scratch[1]!)
}

const enterDungeon: Action = (sim, eid) => {
  dungeonSpot(sim, sim.stores.hero.guild[eid]!, sim.scratch)
  setAnchor(sim, eid)
  teleport(sim, eid, sim.scratch[0]!, sim.scratch[1]!)
}

const stop: Action = (sim, eid) => {
  removeMember(sim.moving, eid)
}

const ACTIONS = new Map<string, Action>([
  ['', () => undefined],
  ['settle-at-camp', settleAtCamp],
  ['walk-to-entrance', walkToEntrance],
  ['enter-dungeon', enterDungeon],
  ['exit-dungeon', exitDungeon],
  ['stop', stop],
])

export const validateActions = (names: readonly string[]): void => {
  for (const name of names) {
    if (!ACTIONS.has(name)) {
      throw new Error(`hero-states.json names an action that doesn't exist: "${name}"`)
    }
  }
}

const recordTransition = (sim: Sim, eid: number, from: number, to: number): void => {
  const { transitions } = sim

  if (transitions.count >= transitions.eid.length) {
    transitions.dropped += 1

    return
  }

  transitions.eid[transitions.count] = eid
  transitions.from[transitions.count] = from
  transitions.to[transitions.count] = to
  transitions.count += 1
}

export const forceState = (sim: Sim, eid: number, to: number, now: number): void => {
  const from = sim.stores.behavior.state[eid]!
  const serial = enterState(sim.stores.behavior, eid, to, now)
  const timeout = sim.machine.timeoutMs[to]!

  if (timeout > 0) {
    schedule(sim.timers, now + timeout, eid, serial, TIMER_STATE)
  }

  recordTransition(sim, eid, from, to)
  ACTIONS.get(sim.machine.onEnter[to]!)!(sim, eid, now)
}

export const sendInput = (sim: Sim, eid: number, input: number, now: number): boolean => {
  const from = sim.stores.behavior.state[eid]!
  const to = nextState(sim.machine, from, input)

  if (to === NO_TRANSITION || to === from) {
    return false
  }

  forceState(sim, eid, to, now)

  return true
}

export const settleStatus = (sim: Sim, eid: number, now: number): void => {
  const status = HERO_STATUSES[sim.stores.hero.status[eid]!]

  if (status !== undefined) {
    sendInput(sim, eid, sim.inputs[status]!, now)
  }
}

export const reenterState = (sim: Sim, eid: number, now: number): void => {
  ACTIONS.get(sim.machine.onEnter[sim.stores.behavior.state[eid]!]!)!(sim, eid, now)
}

export const scheduleWander = (sim: Sim, eid: number, now: number): void => {
  const [low, high] = sim.config.tuning.wanderEveryMs
  const delay = low! + sim.random() * (high! - low!)
  schedule(sim.timers, now + delay, eid, sim.stores.behavior.serial[eid]!, TIMER_WANDER)
}
