import { addComponent, addEntity } from 'bitecs'
import type { HeroEvent, HeroJoined, HeroResurrected } from '@tokenfall/protocol/events'
import { DEATH_CAUSES, type DeathCause, type HeroInfo } from '@tokenfall/protocol/hero'
import { forceState, reenterState, sendInput, teleport } from '../behavior.ts'
import { addMember, removeMember } from '../dense-set.ts'
import { stateId } from '../fsm.ts'
import { bindHero, entityOfHero, NONE, rekeyHero } from '../hero-index.ts'
import { nameOf, personalityOf, STRANGER_NAME } from '../character.ts'
import { freeGrave } from '../graves.ts'
import { jitter, partySpot } from '../layout.ts'
import { joinGroups, leaveGroups, rejoinGroups } from '../membership.ts'
import { levelFor } from '@tokenfall/protocol/level'
import { peek, shift } from '../queue.ts'
import type { Sim } from '../sim.ts'
import type { System } from '../system.ts'

type Handler<E extends HeroEvent> = (sim: Sim, event: E, now: number) => boolean
type Handlers = { readonly [K in HeroEvent['kind']]: Handler<Extract<HeroEvent, { kind: K }>> }

const STATUS_CODES = {
  idle: 0,
  working: 1,
  done: 2,
  blocked: 3,
  unknown: 4,
} as const satisfies Record<HeroInfo['status'], number>

const rollCharacter = (sim: Sim, eid: number, id: string, stranger: boolean): void => {
  const { characters } = sim.config
  const personality = personalityOf(characters, id)
  const hidden = stranger && characters.strangerSheet >= 0
  sim.stores.hero.personality[eid] = personality
  sim.stores.hero.sheet[eid] = hidden
    ? characters.strangerSheet
    : characters.sheetOfPersonality[personality]!
  sim.text.name[eid] = hidden ? STRANGER_NAME : nameOf(characters, id)
}

const BLOCKED = STATUS_CODES.blocked
const NO_CAUSE = 255
const VANISHED: DeathCause = 'missing'

const causeCode = (cause: DeathCause | null | undefined): number =>
  cause === null || cause === undefined ? NO_CAUSE : DEATH_CAUSES.indexOf(cause)

const trackWaiting = (sim: Sim, eid: number, alive = true): void => {
  const { hero } = sim.stores

  if (alive && (hero.status[eid] === BLOCKED || hero.ravens[eid]! > 0)) {
    addMember(sim.waiting, eid)
  } else {
    removeMember(sim.waiting, eid)
  }
}

const crown = (sim: Sim, eid: number, lead: boolean): void => {
  sim.stores.hero.lead[eid] = lead ? 1 : 0

  if (lead) {
    addMember(sim.crowned, eid)
  } else {
    removeMember(sim.crowned, eid)
  }
}

const lifeless = (sim: Sim, eid: number): boolean =>
  sim.lifeless[sim.stores.behavior.state[eid]!] === 1

const withHero = (sim: Sim, id: string, apply: (eid: number) => void, quiet = false): boolean => {
  const eid = entityOfHero(sim.index, id)

  if (eid === NONE) {
    sim.counters.unknownHeroEvents += 1

    return true
  }

  apply(eid)

  if (!quiet) {
    addMember(sim.changed, eid)
  }

  return true
}

const startingState = (sim: Sim, hero: HeroInfo): number => {
  if (!hero.alive) {
    return stateId(sim.machine, 'dead')
  }

  if (hero.status === 'working') {
    return stateId(sim.machine, 'delving')
  }

  if (hero.status === 'done') {
    return stateId(sim.machine, 'looting')
  }

  return sim.machine.initial
}

const spawnHero = (sim: Sim, event: HeroJoined, now: number): boolean => {
  const { hero } = event
  const { stores } = sim
  const eid = addEntity(sim.world)

  if (!bindHero(sim.index, hero.id, eid)) {
    throw new Error(`hero capacity reached at ${sim.index.slotOf.size} heroes`)
  }

  addComponent(sim.world, eid, sim.heroTag)
  stores.hero.status[eid] = STATUS_CODES[hero.status]
  rollCharacter(sim, eid, hero.id, hero.session === null)
  stores.hero.stranger[eid] = hero.session === null ? 1 : 0
  stores.hero.diedAt[eid] = hero.alive ? 0 : (hero.diedAt ?? event.at)
  stores.hero.cause[eid] = hero.alive ? NO_CAUSE : causeCode(hero.cause)
  sim.text.title[eid] = hero.title
  sim.text.quest[eid] = hero.quest
  joinGroups(sim, eid, hero.guild, hero.workspace, hero.plot)
  stores.hero.experience[eid] = hero.experience
  stores.hero.level[eid] = levelFor(sim.thresholds, hero.experience)
  stores.hero.minions[eid] = hero.minions
  crown(sim, eid, hero.lead)
  addMember(sim.minionCheck, eid)
  stores.hero.ravens[eid] = hero.ravens
  stores.hero.ravenSince[eid] = hero.ravenSince
  stores.hero.statusSince[eid] = event.at
  sim.text.ravenThread[eid] = hero.ravenThread ?? ''
  trackWaiting(sim, eid, hero.alive)
  stores.delve.inside[eid] = 0
  stores.delve.placed[eid] = 0
  partySpot(sim, stores.hero.party[eid]!, sim.scratch)
  jitter(sim, sim.config.town.party.radius, sim.scratch)
  teleport(sim, eid, sim.scratch[0]!, sim.scratch[1]!)
  stores.behavior.state[eid] = sim.machine.initial
  forceState(sim, eid, startingState(sim, hero), now)
  sim.spawnsThisFrame += 1
  sim.counters.joined += 1
  addMember(sim.changed, eid)
  addMember(sim.auraCheck, eid)

  return true
}

const dropStranger = (sim: Sim, id: string, now: number): void => {
  const eid = entityOfHero(sim.index, id)

  if (eid === NONE) {
    return
  }

  sim.stores.hero.stranger[eid] = 1
  addMember(sim.auraCheck, eid)
  addMember(sim.minionCheck, eid)
  trackWaiting(sim, eid, false)
  forceState(sim, eid, stateId(sim.machine, 'dead'), now)
}

const refresh = (sim: Sim, eid: number, info: HeroInfo | undefined): void => {
  const { hero } = sim.stores

  if (info === undefined) {
    rejoinGroups(sim, eid)

    return
  }

  joinGroups(sim, eid, info.guild, info.workspace, info.plot)
  hero.status[eid] = STATUS_CODES[info.status]
  hero.experience[eid] = info.experience
  hero.level[eid] = levelFor(sim.thresholds, info.experience)
  hero.minions[eid] = info.minions
  hero.ravens[eid] = info.ravens
  hero.ravenSince[eid] = info.ravenSince
  sim.text.title[eid] = info.title
  sim.text.quest[eid] = info.quest
  sim.text.ravenThread[eid] = info.ravenThread ?? ''
  crown(sim, eid, info.lead)
}

const resurrect = (sim: Sim, event: HeroResurrected, now: number): boolean => {
  const eid = entityOfHero(sim.index, event.hero)

  if (eid === NONE) {
    if (event.info === undefined) {
      sim.counters.unknownHeroEvents += 1

      return true
    }

    return HANDLERS['hero.joined'](
      sim,
      { kind: 'hero.joined', at: event.at, hero: event.info },
      now,
    )
  }

  const { hero } = sim.stores
  freeGrave(sim, eid)
  refresh(sim, eid, event.info)
  hero.diedAt[eid] = 0
  hero.cause[eid] = NO_CAUSE
  addMember(sim.auraCheck, eid)
  addMember(sim.minionCheck, eid)
  addMember(sim.changed, eid)
  trackWaiting(sim, eid)

  if (sendInput(sim, eid, sim.inputs['resurrected']!, now)) {
    sim.counters.resurrected += 1
  }

  return true
}

const HANDLERS: Handlers = {
  'hero.joined': (sim, event, now) => {
    if (entityOfHero(sim.index, event.hero.id) !== NONE) {
      return true
    }

    if (sim.spawnsThisFrame >= sim.config.budgets.spawnsPerFrame) {
      sim.counters.deferredJoins += 1

      return false
    }

    return spawnHero(sim, event, now)
  },
  'hero.status': (sim, event, now) =>
    withHero(sim, event.hero, (eid) => {
      sim.stores.hero.status[eid] = STATUS_CODES[event.status]
      sim.stores.hero.statusSince[eid] = event.at

      if (lifeless(sim, eid)) {
        return
      }

      trackWaiting(sim, eid)
      addMember(sim.statusChanged, eid)
      sendInput(sim, eid, sim.inputs[event.status]!, now)
    }),
  'hero.quest': (sim, event) =>
    withHero(sim, event.hero, (eid) => {
      sim.text.quest[eid] = event.quest
    }),
  'hero.experience': (sim, event) =>
    withHero(
      sim,
      event.hero,
      (eid) => {
        const { hero } = sim.stores
        hero.experience[eid] = event.experience
        const level = levelFor(sim.thresholds, event.experience)

        if (level > hero.level[eid]!) {
          hero.level[eid] = level
          addMember(sim.changed, eid)
          addMember(sim.auraCheck, eid)
          addMember(sim.tierCheck, eid)

          if (!event.catchUp) {
            sim.counters.levelUps += 1
            addMember(sim.levelUps, eid)
          }
        }
      },
      true,
    ),
  'hero.moved': (sim, event, now) =>
    withHero(sim, event.hero, (eid) => {
      leaveGroups(sim, eid)
      joinGroups(sim, eid, event.guild, event.workspace, event.plot)
      reenterState(sim, eid, now)
    }),
  'hero.tool': (sim, event) =>
    withHero(
      sim,
      event.hero,
      (eid) => {
        if (lifeless(sim, eid)) {
          return
        }

        sim.text.tool[eid] = event.tool
        addMember(sim.toolChanged, eid)
        addMember(sim.toolSteps, eid)
      },
      true,
    ),
  'hero.minions': (sim, event) =>
    withHero(sim, event.hero, (eid) => {
      sim.stores.hero.minions[eid] = event.minions
      addMember(sim.minionCheck, eid)
    }),
  'hero.lead': (sim, event) =>
    withHero(sim, event.hero, (eid) => {
      crown(sim, eid, event.lead)
    }),
  'hero.ravens': (sim, event) =>
    withHero(sim, event.hero, (eid) => {
      sim.stores.hero.ravens[eid] = event.ravens
      sim.stores.hero.ravenSince[eid] = event.since
      sim.text.ravenThread[eid] = event.thread ?? ''
      trackWaiting(sim, eid, !lifeless(sim, eid))
    }),
  'hero.linked': (sim, event, now) => {
    if (entityOfHero(sim.index, event.to) !== NONE) {
      dropStranger(sim, event.from, now)

      return true
    }

    if (rekeyHero(sim.index, event.from, event.to)) {
      withHero(sim, event.to, (eid) => {
        sim.stores.hero.stranger[eid] = 0
        rollCharacter(sim, eid, event.to, false)
      })
    }

    return true
  },
  'hero.died': (sim, event, now) =>
    withHero(sim, event.hero, (eid) => {
      const vanished = event.cause === VANISHED
      sim.stores.hero.diedAt[eid] = event.at
      sim.stores.hero.cause[eid] = causeCode(event.cause)
      addMember(sim.auraCheck, eid)
      addMember(sim.minionCheck, eid)
      trackWaiting(sim, eid, false)

      if (sendInput(sim, eid, sim.inputs[vanished ? 'vanished' : 'died']!, now)) {
        sim.counters.died += 1
      }
    }),
  'hero.resurrected': (sim, event, now) => resurrect(sim, event, now),
}

const handle = (sim: Sim, event: HeroEvent, now: number): boolean => {
  if (event.kind === 'hero.joined') {
    return HANDLERS['hero.joined'](sim, event, now)
  }

  if (event.kind === 'hero.status') {
    return HANDLERS['hero.status'](sim, event, now)
  }

  if (event.kind === 'hero.quest') {
    return HANDLERS['hero.quest'](sim, event, now)
  }

  if (event.kind === 'hero.experience') {
    return HANDLERS['hero.experience'](sim, event, now)
  }

  if (event.kind === 'hero.moved') {
    return HANDLERS['hero.moved'](sim, event, now)
  }

  if (event.kind === 'hero.minions') {
    return HANDLERS['hero.minions'](sim, event, now)
  }

  if (event.kind === 'hero.lead') {
    return HANDLERS['hero.lead'](sim, event, now)
  }

  if (event.kind === 'hero.linked') {
    return HANDLERS['hero.linked'](sim, event, now)
  }

  if (event.kind === 'hero.died') {
    return HANDLERS['hero.died'](sim, event, now)
  }

  if (event.kind === 'hero.tool') {
    return HANDLERS['hero.tool'](sim, event, now)
  }

  if (event.kind === 'hero.ravens') {
    return HANDLERS['hero.ravens'](sim, event, now)
  }

  return HANDLERS['hero.resurrected'](sim, event, now)
}

export const drainSystem: System = {
  name: 'drain',
  complexity: 'O(events drained this frame), joins capped by budgets.spawnsPerFrame',
  run: (sim, now) => {
    sim.spawnsThisFrame = 0
    sim.transitions.count = 0

    while (sim.inbound.size > 0) {
      if (!handle(sim, peek(sim.inbound)!, now)) {
        return
      }

      shift(sim.inbound)
    }
  },
}
