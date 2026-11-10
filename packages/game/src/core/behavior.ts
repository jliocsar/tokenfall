import { HERO_STATUSES } from '@tokenfall/protocol/hero'
import { enterState, NO_TRANSITION, nextState } from './fsm.ts'
import { addMember, removeMember } from './dense-set.ts'
import { enterDungeonAt } from './delve.ts'
import { claimGrave } from './graves.ts'
import { summonHorde } from './horde.ts'
import { leaveGroups } from './membership.ts'
import { leaveDungeon, seenInDungeon } from './dungeon.ts'
import { entranceSpot, jitter, partySpot } from './layout.ts'
import { TIMER_STATE, TIMER_WANDER, type Sim } from './sim.ts'
import { schedule } from './timers.ts'
import { spawnEffectAt } from '../effects/emitters.ts'
import { DUST_KIND, NECRO_KIND, WARP_FLARE_KIND } from '../effects/systems.ts'

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
  leaveDungeon(sim, eid)
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

const flareHere = (sim: Sim, eid: number, now: number): void => {
  spawnEffectAt(sim, WARP_FLARE_KIND, sim.stores.position.x[eid]!, sim.stores.position.y[eid]!, now)
}

const exitDungeon: Action = (sim, eid, now) => {
  if (sim.stores.delve.placed[eid] === 1) {
    flareHere(sim, eid, now)
  }

  leaveDungeon(sim, eid)
  entranceSpot(sim, sim.stores.hero.guild[eid]!, sim.scratch)
  teleport(sim, eid, sim.scratch[0]!, sim.scratch[1]!)
  flareHere(sim, eid, now)
}

const enterDungeon: Action = (sim, eid, now) => {
  enterDungeonAt(sim, eid)

  if (sim.stores.delve.placed[eid] === 1) {
    flareHere(sim, eid, now)
  }
}

const stop: Action = (sim, eid) => {
  removeMember(sim.moving, eid)
}

export const forgetDying = (sim: Sim, eid: number): void => {
  const pane = sim.text.pane[eid]!

  if (sim.dyingPanes.get(pane) === eid) {
    sim.dyingPanes.delete(pane)
  }
}

const campNow = (sim: Sim, eid: number): void => {
  leaveDungeon(sim, eid)
  partySpot(sim, sim.stores.hero.party[eid]!, sim.scratch)
  jitter(sim, sim.config.town.party.radius, sim.scratch)
  setAnchor(sim, eid)
  teleport(sim, eid, sim.scratch[0]!, sim.scratch[1]!)
}

const summon: Action = (sim, eid, now) => {
  removeMember(sim.moving, eid)
  sim.dyingPanes.set(sim.text.pane[eid]!, eid)

  if (sim.stores.delve.inside[eid] === 1 && !seenInDungeon(sim, eid)) {
    flareHere(sim, eid, now)
    campNow(sim, eid)
    flareHere(sim, eid, now)
  }

  summonHorde(sim, eid, now)
}

const riseAtGrave: Action = (sim, eid, now) => {
  removeMember(sim.moving, eid)
  const x = sim.stores.position.x[eid]!
  const y = sim.stores.position.y[eid]!
  spawnEffectAt(sim, NECRO_KIND, x, y, now)
  spawnEffectAt(sim, DUST_KIND, x, y, now)
}

const walkToCamp: Action = (sim, eid) => {
  partySpot(sim, sim.stores.hero.party[eid]!, sim.scratch)
  jitter(sim, sim.config.town.party.radius, sim.scratch)
  setAnchor(sim, eid)
  moveTo(sim, eid, sim.scratch[0]!, sim.scratch[1]!)
}

const arriveAtCamp: Action = (sim, eid, now) => {
  campNow(sim, eid)
  flareHere(sim, eid, now)
}

const bury: Action = (sim, eid, now) => {
  forgetDying(sim, eid)
  removeMember(sim.moving, eid)
  leaveDungeon(sim, eid)
  leaveGroups(sim, eid)
  addMember(sim.changed, eid)

  if (sim.stores.hero.stranger[eid] === 1) {
    addMember(sim.releasing, eid)

    return
  }

  claimGrave(sim, eid, now)
}

const ACTIONS = new Map<string, Action>([
  ['', () => undefined],
  ['settle-at-camp', settleAtCamp],
  ['walk-to-entrance', walkToEntrance],
  ['enter-dungeon', enterDungeon],
  ['exit-dungeon', exitDungeon],
  ['warp-flare', flareHere],
  ['stop', stop],
  ['bury', bury],
  ['summon-horde', summon],
  ['arrive-at-camp', arriveAtCamp],
  ['rise-at-grave', riseAtGrave],
  ['walk-to-camp', walkToCamp],
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
