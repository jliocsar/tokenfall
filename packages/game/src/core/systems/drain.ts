import { addComponent, addEntity } from 'bitecs'
import type { HeroEvent, HeroJoined } from '@tokenfall/protocol/events'
import type { HeroInfo } from '@tokenfall/protocol/hero'
import { forceState, reenterState, sendInput, teleport } from '../behavior.ts'
import { addMember } from '../dense-set.ts'
import { stateId } from '../fsm.ts'
import { bindHero, entityOfHero, NONE, rekeyHero } from '../hero-index.ts'
import { nameOf, personalityOf, STRANGER_NAME } from '../character.ts'
import { guildOf, partyOf } from '../groups.ts'
import { assignPlot, jitter, partySpot, releasePlot } from '../layout.ts'
import { levelFor } from '../level.ts'
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

const joinGroups = (
  sim: Sim,
  eid: number,
  guildKey: string,
  workspace: string,
  plot: number,
): void => {
  const { hero } = sim.stores
  const { groups } = sim
  const guild = guildOf(groups, guildKey)
  assignPlot(sim.town, guild, plot)
  hero.guild[eid] = guild
  hero.party[eid] = partyOf(groups, guild, workspace)
  groups.guildHeroes[guild] = groups.guildHeroes[guild]! + 1
}

const leaveGroups = (sim: Sim, eid: number): void => {
  const guild = sim.stores.hero.guild[eid]!
  const { guildHeroes } = sim.groups
  guildHeroes[guild] = guildHeroes[guild]! - 1

  if (guildHeroes[guild] === 0) {
    releasePlot(sim.town, guild)
  }
}

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
  sim.text.title[eid] = hero.title
  sim.text.quest[eid] = hero.quest
  joinGroups(sim, eid, hero.guild, hero.workspace, hero.plot)
  stores.hero.experience[eid] = hero.experience
  stores.hero.level[eid] = levelFor(sim.thresholds, hero.experience)
  stores.hero.minions[eid] = hero.minions
  stores.behavior.serial[eid] = 0
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
        sim.text.tool[eid] = event.tool
        addMember(sim.toolChanged, eid)
      },
      true,
    ),
  'hero.minions': (sim, event) =>
    withHero(sim, event.hero, (eid) => {
      sim.stores.hero.minions[eid] = event.minions
    }),
  'hero.linked': (sim, event) => {
    if (rekeyHero(sim.index, event.from, event.to)) {
      withHero(sim, event.to, (eid) => {
        rollCharacter(sim, eid, event.to, false)
      })
    }

    return true
  },
  'hero.died': (sim, event, now) =>
    withHero(sim, event.hero, (eid) => {
      addMember(sim.auraCheck, eid)

      if (sendInput(sim, eid, sim.inputs['died']!, now)) {
        sim.counters.died += 1
      }
    }),
  'hero.resurrected': (sim, event, now) =>
    withHero(sim, event.hero, (eid) => {
      addMember(sim.auraCheck, eid)

      if (sendInput(sim, eid, sim.inputs['resurrected']!, now)) {
        sim.counters.resurrected += 1
      }
    }),
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

  if (event.kind === 'hero.linked') {
    return HANDLERS['hero.linked'](sim, event, now)
  }

  if (event.kind === 'hero.died') {
    return HANDLERS['hero.died'](sim, event, now)
  }

  if (event.kind === 'hero.tool') {
    return HANDLERS['hero.tool'](sim, event, now)
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
