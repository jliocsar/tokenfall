import { addComponent, addEntity } from 'bitecs'
import type { HeroEvent, HeroJoined } from '@tokenfall/protocol/events'
import type { HeroInfo } from '@tokenfall/protocol/hero'
import { forceState, sendInput, teleport } from '../behavior.ts'
import { addMember } from '../dense-set.ts'
import { stateId } from '../fsm.ts'
import { bindHero, entityOfHero, NONE, rekeyHero } from '../hero-index.ts'
import { campSpot, jitter } from '../layout.ts'
import { levelFor } from '../level.ts'
import { peek, shift } from '../queue.ts'
import { hashString } from '../random.ts'
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

const idOf = (map: Map<string, number>, key: string): number => {
  const known = map.get(key)

  if (known !== undefined) {
    return known
  }

  map.set(key, map.size)

  return map.size - 1
}

const withHero = (sim: Sim, id: string, apply: (eid: number) => void): boolean => {
  const eid = entityOfHero(sim.index, id)

  if (eid === NONE) {
    sim.counters.unknownHeroEvents += 1

    return true
  }

  apply(eid)

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
  stores.hero.sheet[eid] = hashString(hero.id) % sim.config.sheets
  stores.hero.guild[eid] = idOf(sim.guilds, hero.guild)
  stores.hero.party[eid] = idOf(sim.parties, `${hero.guild}\u0000${hero.workspace}`)
  stores.hero.experience[eid] = hero.experience
  stores.hero.level[eid] = levelFor(sim.thresholds, hero.experience)
  stores.hero.minions[eid] = hero.minions
  stores.behavior.serial[eid] = 0
  campSpot(stores.hero.guild[eid], sim.scratch)
  jitter(sim, sim.config.tuning.wanderRadius, sim.scratch)
  teleport(sim, eid, sim.scratch[0]!, sim.scratch[1]!)
  stores.behavior.state[eid] = sim.machine.initial
  forceState(sim, eid, startingState(sim, hero), now)
  sim.spawnsThisFrame += 1
  sim.counters.joined += 1

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
      sendInput(sim, eid, sim.inputs[event.status]!, now)
    }),
  'hero.quest': (sim, event) => withHero(sim, event.hero, () => undefined),
  'hero.experience': (sim, event) =>
    withHero(sim, event.hero, (eid) => {
      const { hero } = sim.stores
      hero.experience[eid] = event.experience
      const level = levelFor(sim.thresholds, event.experience)

      if (level > hero.level[eid]!) {
        hero.level[eid] = level
        sim.counters.levelUps += 1
        addMember(sim.levelUps, eid)
      }
    }),
  'hero.moved': (sim, event) =>
    withHero(sim, event.hero, (eid) => {
      sim.stores.hero.guild[eid] = idOf(sim.guilds, event.guild)
      sim.stores.hero.party[eid] = idOf(sim.parties, `${event.guild}\u0000${event.workspace}`)
    }),
  'hero.minions': (sim, event) =>
    withHero(sim, event.hero, (eid) => {
      sim.stores.hero.minions[eid] = event.minions
    }),
  'hero.linked': (sim, event) => {
    rekeyHero(sim.index, event.from, event.to)

    return true
  },
  'hero.died': (sim, event, now) =>
    withHero(sim, event.hero, (eid) => {
      if (sendInput(sim, eid, sim.inputs['died']!, now)) {
        sim.counters.died += 1
      }
    }),
  'hero.resurrected': (sim, event, now) =>
    withHero(sim, event.hero, (eid) => {
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
