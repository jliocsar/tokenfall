import { describe, expect, test } from 'bun:test'
import { LOCAL_MACHINE, NO_PLOT, type HeroInfo } from '@tokenfall/protocol/hero'
import { bootSim } from '../src/core/boot.ts'
import { hasMember } from '../src/core/dense-set.ts'
import { entityOfHero } from '../src/core/hero-index.ts'
import { push } from '../src/core/queue.ts'
import { NO_AURA } from '../src/core/sim.ts'
import { createProfile, runSystems } from '../src/core/system.ts'
import { SIM_SYSTEMS } from '../src/core/systems/index.ts'
import { EMITTER_STRIDE } from '../src/effects/emitters.ts'
import { MAX_WISPS, MINION_KIND } from '../src/effects/systems.ts'

const hero = (id: string, minions: number, lead: boolean): HeroInfo => ({
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
  minions,
  lead,
  alive: true,
  ravens: 0,
  ravenThread: null,
  ravenSince: 0,
})

const step = (sim: ReturnType<typeof bootSim>, now: number): void => {
  runSystems(SIM_SYSTEMS, createProfile(SIM_SYSTEMS), sim, now, 16)
}

const wispCount = (sim: ReturnType<typeof bootSim>, eid: number): number => {
  const effect = sim.wispsOf[eid]!
  const slot = sim.stores.emitter.slot[effect]!

  return sim.effects[MINION_KIND]!.data[slot * EMITTER_STRIDE + 4]!
}

describe('minion wisps', () => {
  test('a Hero with Minions gets one wisp emitter that tracks the count', () => {
    const sim = bootSim(7, 0, {})
    push(sim.inbound, { kind: 'hero.joined', at: 0, hero: hero('a', 3, false) })
    step(sim, 0)
    const eid = entityOfHero(sim.index, 'a')

    expect(sim.wispsOf[eid]).not.toBe(NO_AURA)
    expect(wispCount(sim, eid)).toBe(3)
    expect(hasMember(sim.swarmed, eid)).toBe(false)

    push(sim.inbound, { kind: 'hero.minions', at: 16, hero: 'a', minions: MAX_WISPS + 4 })
    step(sim, 16)

    expect(sim.effects[MINION_KIND]!.active).toBe(1)
    expect(hasMember(sim.swarmed, eid)).toBe(true)

    push(sim.inbound, { kind: 'hero.minions', at: 32, hero: 'a', minions: 0 })
    step(sim, 32)

    expect(sim.wispsOf[eid]).toBe(NO_AURA)
    expect(sim.effects[MINION_KIND]!.active).toBe(0)
    expect(hasMember(sim.swarmed, eid)).toBe(false)
  })

  test('a Hero with no Minions gets no emitter', () => {
    const sim = bootSim(7, 0, {})
    push(sim.inbound, { kind: 'hero.joined', at: 0, hero: hero('a', 0, false) })
    step(sim, 0)

    expect(sim.wispsOf[entityOfHero(sim.index, 'a')]).toBe(NO_AURA)
  })
})

describe('the crown', () => {
  test('hero.lead puts the crown on and takes it off', () => {
    const sim = bootSim(7, 0, {})
    push(sim.inbound, { kind: 'hero.joined', at: 0, hero: hero('a', 0, true) })
    step(sim, 0)
    const eid = entityOfHero(sim.index, 'a')

    expect(hasMember(sim.crowned, eid)).toBe(true)

    push(sim.inbound, { kind: 'hero.lead', at: 16, hero: 'a', lead: false })
    step(sim, 16)

    expect(hasMember(sim.crowned, eid)).toBe(false)
    expect(sim.stores.hero.lead[eid]).toBe(0)
  })
})
