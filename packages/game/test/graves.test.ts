import { describe, expect, test } from 'bun:test'
import { LOCAL_MACHINE, NO_PLOT, type HeroInfo } from '@tokenfall/protocol/hero'
import death from '@tokenfall/data/death.json'
import { bootSim } from '../src/core/boot.ts'
import { NO_GRAVE } from '../src/core/graves.ts'
import { entityOfHero, NONE } from '../src/core/hero-index.ts'
import { push } from '../src/core/queue.ts'
import { createProfile, runSystems } from '../src/core/system.ts'
import { SIM_SYSTEMS } from '../src/core/systems/index.ts'

type Sim = ReturnType<typeof bootSim>

const DAY_MS = death.graves.hours * 3_600_000
const SLOTS = death.graves.rows * death.graves.columns
const AFTER_DYING = 5000

const hero = (id: string, overrides: Partial<HeroInfo> = {}): HeroInfo => ({
  id,
  session: id,
  machine: LOCAL_MACHINE,
  pane: id,
  workspace: 'w1',
  guild: '/repo',
  plot: NO_PLOT,
  title: '',
  quest: '',
  status: 'idle',
  experience: 0,
  minions: 0,
  lead: false,
  alive: true,
  diedAt: 0,
  cause: null,
  ravens: 0,
  ravenThread: null,
  ravenSince: 0,
  ...overrides,
})

const fallen = (id: string, diedAt: number): HeroInfo =>
  hero(id, { alive: false, diedAt, cause: 'exited' })

const step = (sim: Sim, now: number): void => {
  runSystems(SIM_SYSTEMS, createProfile(SIM_SYSTEMS), sim, now, 16)
}

const join = (sim: Sim, heroes: readonly HeroInfo[], now = 0): void => {
  for (const info of heroes) {
    push(sim.inbound, { kind: 'hero.joined', at: now, hero: info })
  }

  for (let frame = 0; frame * sim.config.budgets.spawnsPerFrame <= heroes.length; frame++) {
    step(sim, now)
  }
}

const graveOf = (sim: Sim, id: string): number => sim.graves.slotOf[entityOfHero(sim.index, id)]!

const state = (sim: Sim, id: string): string =>
  sim.machine.states[sim.stores.behavior.state[entityOfHero(sim.index, id)]!]!

describe('graves', () => {
  test('a Death leaves a Grave once the Death Scene ends', () => {
    const sim = bootSim(7, 0, {})
    join(sim, [hero('a')])
    push(sim.inbound, { kind: 'hero.died', at: 10, hero: 'a', cause: 'killed' })
    step(sim, 10)

    expect(state(sim, 'a')).toBe('dying')
    expect(graveOf(sim, 'a')).toBe(NO_GRAVE)

    step(sim, AFTER_DYING)

    expect(state(sim, 'a')).toBe('dead')
    expect(graveOf(sim, 'a')).not.toBe(NO_GRAVE)
    expect(sim.stores.hero.diedAt[entityOfHero(sim.index, 'a')]).toBe(10)
  })

  test('the Fallen keep their Grave slots across a reload', () => {
    const heroes = Array.from({ length: 12 }, (_unused, i) => fallen(`h${i}`, 100 + i))
    const first = bootSim(7, 0, {})
    const second = bootSim(7, 0, {})
    join(first, heroes)
    join(second, heroes.toReversed())

    for (const info of heroes) {
      expect(graveOf(second, info.id)).toBe(graveOf(first, info.id))
    }
  })

  test('a full Graveyard crumbles its oldest Grave', () => {
    const sim = bootSim(7, 0, {})
    join(
      sim,
      Array.from({ length: SLOTS }, (_unused, i) => fallen(`h${i}`, 1000 + i)),
    )

    expect(sim.graves.count).toBe(SLOTS)

    join(sim, [fallen('late', 5000)])

    expect(sim.graves.count).toBe(SLOTS)
    expect(entityOfHero(sim.index, 'h0')).toBe(NONE)
    expect(graveOf(sim, 'late')).not.toBe(NO_GRAVE)
  })

  test('a Grave crumbles after a day', () => {
    const sim = bootSim(7, 0, {})
    join(sim, [fallen('a', 0)])
    step(sim, DAY_MS - 1)

    expect(entityOfHero(sim.index, 'a')).not.toBe(NONE)

    step(sim, DAY_MS)

    expect(entityOfHero(sim.index, 'a')).toBe(NONE)
    expect(sim.graves.count).toBe(0)
  })

  test('Heroes of Level 65 and up get the big stone', () => {
    const sim = bootSim(7, 0, {})
    const experience = sim.thresholds[death.graves.bigLevel]!
    join(sim, [fallen('low', 1), hero('high', { alive: false, diedAt: 2, experience })])

    expect(sim.graves.prop[entityOfHero(sim.index, 'high')]).toBe(death.graves.props.length)
    expect(sim.graves.prop[entityOfHero(sim.index, 'low')]).toBeLessThan(death.graves.props.length)
  })

  test('a vanished Hero goes straight to its Grave', () => {
    const sim = bootSim(7, 0, {})
    join(sim, [hero('a')])
    push(sim.inbound, { kind: 'hero.died', at: 10, hero: 'a', cause: 'missing' })
    step(sim, 10)

    expect(state(sim, 'a')).toBe('dead')
    expect(graveOf(sim, 'a')).not.toBe(NO_GRAVE)
  })

  test('a Stranger gets a Death Scene but no Grave', () => {
    const sim = bootSim(7, 0, {})
    join(sim, [hero('s', { session: null })])
    push(sim.inbound, { kind: 'hero.died', at: 10, hero: 's', cause: 'exited' })
    step(sim, 10)

    expect(state(sim, 's')).toBe('dying')

    step(sim, AFTER_DYING)

    expect(entityOfHero(sim.index, 's')).toBe(NONE)
    expect(sim.graves.count).toBe(0)
  })
})

describe('resurrection', () => {
  test('a Hero with a Grave rises from it', () => {
    const sim = bootSim(7, 0, {})
    join(sim, [fallen('a', 10)])
    const eid = entityOfHero(sim.index, 'a')
    push(sim.inbound, { kind: 'hero.resurrected', at: 20, hero: 'a', info: hero('a') })
    step(sim, 20)

    expect(entityOfHero(sim.index, 'a')).toBe(eid)
    expect(state(sim, 'a')).toBe('rising')
    expect(graveOf(sim, 'a')).toBe(NO_GRAVE)
    expect(sim.stores.hero.grouped[eid]).toBe(1)
    expect(sim.graves.count).toBe(0)
  })

  test('a Hero whose Grave is gone comes back from its info', () => {
    const sim = bootSim(7, 0, {})
    push(sim.inbound, { kind: 'hero.resurrected', at: 20, hero: 'a', info: hero('a') })
    step(sim, 20)

    expect(entityOfHero(sim.index, 'a')).not.toBe(NONE)
    expect(state(sim, 'a')).toBe('camp')
  })

  test('a Stranger linked to a dead Hero gives way to its Grave', () => {
    const sim = bootSim(7, 0, {})
    join(sim, [fallen('a', 10), hero('pane-1', { session: null })])
    const grave = entityOfHero(sim.index, 'a')
    push(sim.inbound, { kind: 'hero.linked', at: 20, from: 'pane-1', to: 'a', session: 'a' })
    push(sim.inbound, { kind: 'hero.resurrected', at: 20, hero: 'a', info: hero('a') })
    step(sim, 20)

    expect(entityOfHero(sim.index, 'pane-1')).toBe(NONE)
    expect(entityOfHero(sim.index, 'a')).toBe(grave)
    expect(state(sim, 'a')).toBe('rising')
  })

  test('a dead Hero rejoins its Guild', () => {
    const sim = bootSim(7, 0, {})
    join(sim, [hero('a')])
    const eid = entityOfHero(sim.index, 'a')
    const guild = sim.stores.hero.guild[eid]!
    push(sim.inbound, { kind: 'hero.died', at: 10, hero: 'a', cause: 'exited' })
    step(sim, 10)
    step(sim, AFTER_DYING)

    expect(sim.groups.guildHeroes[guild]).toBe(0)

    push(sim.inbound, { kind: 'hero.resurrected', at: 6000, hero: 'a' })
    step(sim, 6000)

    expect(sim.groups.guildHeroes[guild]).toBe(1)
  })
})
