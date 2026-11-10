import { describe, expect, test } from 'bun:test'
import { LOCAL_MACHINE, NO_PLOT, type HeroInfo } from '@tokenfall/protocol/hero'
import death from '@tokenfall/data/death.json'
import machine from '@tokenfall/data/hero-states.json'
import { bootSim } from '../src/core/boot.ts'
import { hordeSize, sceneLength } from '../src/core/death-scene.ts'
import { NO_VICTIM } from '../src/core/horde.ts'
import { entityOfHero } from '../src/core/hero-index.ts'
import { push } from '../src/core/queue.ts'
import { createProfile, runSystems } from '../src/core/system.ts'
import { SIM_SYSTEMS } from '../src/core/systems/index.ts'

type Sim = ReturnType<typeof bootSim>

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

const victims = (sim: Sim, eid: number): number =>
  Array.from(sim.horde.victim).filter((victim) => victim === eid).length

const SCENE = death.scene

describe('the Death Scene', () => {
  test('the dying timer matches the scene', () => {
    expect(machine.timers.dying).toBe(sceneLength(SCENE))
  })

  test('the Horde grows with Level', () => {
    expect(hordeSize(SCENE, 1)).toBe(3)
    expect(hordeSize(SCENE, 25)).toBe(4)
    expect(hordeSize(SCENE, 74)).toBe(5)
    expect(hordeSize(SCENE, 99)).toBe(6)
  })

  test('a dying Hero is surrounded, and the Horde leaves with the scene', () => {
    const sim = bootSim(7, 0, {})
    join(sim, [hero('a')])
    const eid = entityOfHero(sim.index, 'a')
    push(sim.inbound, { kind: 'hero.died', at: 10, hero: 'a', cause: 'killed' })
    step(sim, 10)

    expect(victims(sim, eid)).toBe(3)

    step(sim, 10 + sceneLength(SCENE))

    expect(sim.horde.active).toBe(0)
  })

  test('the Horde cap holds: the ninth Level 99 Death plays alone', () => {
    const sim = bootSim(7, 0, {})
    const experience = sim.thresholds[99]!
    const ids = Array.from({ length: 9 }, (_unused, i) => `h${i}`)
    join(
      sim,
      ids.map((id) => hero(id, { experience })),
    )

    for (const id of ids) {
      push(sim.inbound, { kind: 'hero.died', at: 10, hero: id, cause: 'killed' })
    }

    step(sim, 10)

    expect(sim.horde.active).toBe(sim.config.budgets.horde)
    expect(victims(sim, entityOfHero(sim.index, 'h8'))).toBe(0)
    expect(sim.counters.hordeSkipped).toBe(1)
    expect(Array.from(sim.horde.victim)).not.toContain(NO_VICTIM)
  })

  test('a Hero in an unseen Dungeon dies at Camp', () => {
    const sim = bootSim(7, 0, {})
    join(sim, [hero('a', { status: 'working' })])
    const eid = entityOfHero(sim.index, 'a')

    expect(sim.stores.delve.inside[eid]).toBe(1)

    push(sim.inbound, { kind: 'hero.died', at: 10, hero: 'a', cause: 'killed' })
    step(sim, 10)

    expect(sim.stores.delve.inside[eid]).toBe(0)
  })

  test('a /clear successor waits for the Death Scene, then warps in at Camp', () => {
    const sim = bootSim(7, 0, {})
    join(sim, [hero('old', { pane: 'p1' })])
    push(sim.inbound, { kind: 'hero.died', at: 10, hero: 'old', cause: 'cleared' })
    push(sim.inbound, { kind: 'hero.joined', at: 10, hero: hero('new', { pane: 'p1' }) })
    step(sim, 10)
    const state = (id: string): string =>
      sim.machine.states[sim.stores.behavior.state[entityOfHero(sim.index, id)]!]!

    expect(state('new')).toBe('succeeding')

    step(sim, 10 + sceneLength(SCENE) - 100)

    expect(state('new')).toBe('succeeding')

    step(sim, 10 + sceneLength(SCENE) + 1)

    expect(state('new')).toBe('arriving')

    step(sim, 10 + sceneLength(SCENE) + SCENE.arriveMs + 100)

    expect(state('new')).toBe('camp')
  })
})
