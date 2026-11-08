import { describe, expect, test } from 'bun:test'
import { LOCAL_MACHINE, NO_PLOT, type HeroInfo } from '@tokenfall/protocol/hero'
import { bootSim } from '../src/core/boot.ts'
import { push } from '../src/core/queue.ts'
import { createProfile, runSystems } from '../src/core/system.ts'
import { SIM_SYSTEMS } from '../src/core/systems/index.ts'
import { AURA_KIND, LEVEL_UP_KIND } from '../src/effects/systems.ts'

const hero = (id: string, experience: number): HeroInfo => ({
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
  experience,
  minions: 0,
  lead: false,
  alive: true,
  ravens: 0,
  ravenThread: null,
  ravenSince: 0,
})

const TOP = 4_500_000_000

describe('level 99 aura', () => {
  test('a Hero joining at Level 99 gets an aura and no burst', () => {
    const sim = bootSim(1, 0, {})
    const profile = createProfile(SIM_SYSTEMS)
    push(sim.inbound, { kind: 'hero.joined', at: 0, hero: hero('a', TOP) })
    push(sim.inbound, { kind: 'hero.joined', at: 0, hero: hero('b', 1000) })
    runSystems(SIM_SYSTEMS, profile, sim, 16, 16)

    expect(sim.effects[AURA_KIND]!.active).toBe(1)
    expect(sim.effects[LEVEL_UP_KIND]!.active).toBe(0)
  })

  test('catching up to Level 99 adds the aura without a burst, dying removes it', () => {
    const sim = bootSim(1, 0, {})
    const profile = createProfile(SIM_SYSTEMS)
    push(sim.inbound, { kind: 'hero.joined', at: 0, hero: hero('a', 1000) })
    runSystems(SIM_SYSTEMS, profile, sim, 16, 16)
    push(sim.inbound, { kind: 'hero.experience', at: 1, hero: 'a', experience: TOP, catchUp: true })
    runSystems(SIM_SYSTEMS, profile, sim, 32, 16)

    expect(sim.effects[AURA_KIND]!.active).toBe(1)
    expect(sim.effects[LEVEL_UP_KIND]!.active).toBe(0)

    push(sim.inbound, { kind: 'hero.died', at: 2, hero: 'a', cause: 'exited' })
    runSystems(SIM_SYSTEMS, profile, sim, 48, 16)

    expect(sim.effects[AURA_KIND]!.active).toBe(0)
  })

  test('a live level up bursts', () => {
    const sim = bootSim(1, 0, {})
    const profile = createProfile(SIM_SYSTEMS)
    push(sim.inbound, { kind: 'hero.joined', at: 0, hero: hero('a', 1000) })
    runSystems(SIM_SYSTEMS, profile, sim, 16, 16)
    push(sim.inbound, {
      kind: 'hero.experience',
      at: 1,
      hero: 'a',
      experience: 5_000_000,
      catchUp: false,
    })
    runSystems(SIM_SYSTEMS, profile, sim, 32, 16)

    expect(sim.effects[LEVEL_UP_KIND]!.active).toBe(1)
  })
})
