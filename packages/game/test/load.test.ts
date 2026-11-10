import { describe, expect, test } from 'bun:test'
import { createSynthetic } from '@tokenfall/replay/synthetic'
import type { HeroEvent } from '@tokenfall/protocol/events'
import { bootSim } from '../src/core/boot.ts'
import { push } from '../src/core/queue.ts'
import { createProfile, runSystems } from '../src/core/system.ts'
import { SIM_SYSTEMS } from '../src/core/systems/index.ts'
import { heroCount, NONE } from '../src/core/hero-index.ts'
import { heroTier, openView, settleTier } from '../src/core/dungeon.ts'
import limits from './load-limits.json'

const FRAME_MS = 1000 / 60
const TEMPO = 20
const OPEN_AT_FRAME = 120
const COMBAT_TEMPO = 1

type Sim = ReturnType<typeof bootSim>

const openBusiestTier = (sim: Sim): void => {
  const { guildHeroes } = sim.groups
  let guild = 0

  for (let index = 0; index < sim.groups.guildKeys.length; index++) {
    if (guildHeroes[index]! > guildHeroes[guild]!) {
      guild = index
    }
  }

  const counts = new Uint16Array(sim.config.dungeon.tiers.length)

  for (let slot = 0; slot < sim.index.nextSlot; slot++) {
    const eid = sim.index.entityOf[slot]!

    if (eid !== NONE && sim.stores.hero.guild[eid] === guild) {
      counts[heroTier(sim, eid)] = counts[heroTier(sim, eid)]! + 1
    }
  }

  const tier = counts.indexOf(Math.max(...counts))

  settleTier(sim, guild, tier)
  openView(sim, guild, tier)
}

const runLoad = (heroes: number, seconds: number, combat = false) => {
  const sim = bootSim(7, 0, {})
  const synthetic = createSynthetic({
    seed: 7,
    heroes,
    guilds: Math.max(1, Math.round(heroes / 12)),
    workspacesPerGuild: 3,
    tempo: combat ? COMBAT_TEMPO : TEMPO,
    startAt: 0,
    combat,
  })

  for (const hero of synthetic.heroes) {
    push(sim.inbound, { kind: 'hero.joined', at: 0, hero })
  }

  const profile = createProfile(SIM_SYSTEMS)
  const events: HeroEvent[] = []
  const frames = Math.round((seconds * 1000) / FRAME_MS)
  const frameMs = new Float64Array(frames)
  let now = 0

  for (let frame = 0; frame < frames; frame++) {
    now += FRAME_MS

    if (frame % 6 === 0) {
      events.length = 0
      synthetic.step(now, events)

      for (const event of events) {
        push(sim.inbound, event)
      }
    }

    if (combat && frame === OPEN_AT_FRAME) {
      openBusiestTier(sim)
    }

    const start = performance.now()
    runSystems(SIM_SYSTEMS, profile, sim, now, FRAME_MS)
    frameMs[frame] = performance.now() - start
  }

  const sorted = frameMs.slice(Math.round(frames / 4)).sort()

  return {
    sim,
    mean: sorted.reduce((total, ms) => total + ms, 0) / sorted.length,
    p99: sorted[Math.floor(sorted.length * 0.99)]!,
  }
}

describe('synthetic load', () => {
  test('1000 heroes stay inside the sim frame budget', () => {
    runLoad(200, 2)
    const { sim, mean, p99 } = runLoad(1000, 20)
    console.log(
      `1000 heroes: mean ${mean.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, level ups ${sim.counters.levelUps}, deaths ${sim.counters.died}, store bytes ${sim.arena.allocations.reduce((total, a) => total + a.bytes, 0)}`,
    )

    expect(heroCount(sim.index)).toBe(1000)
    expect(mean).toBeLessThan(limits.simMeanMs)
    expect(p99).toBeLessThan(limits.simP99Ms)
    expect(sim.inbound.dropped + sim.timers.dropped + sim.transitions.dropped).toBe(0)
  })

  test('1000 heroes with the busiest tier open and tool bursts on stay inside the budget', () => {
    const { sim, mean, p99 } = runLoad(1000, 20, true)
    const { counters, monsters } = sim.combat
    console.log(
      `1000 combat: mean ${mean.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, swings ${counters.swings}, crits ${counters.crits}, strikes ${counters.strikes}, cleared ${counters.cleared}, monsters ${monsters.active}`,
    )

    expect(counters.swings).toBeGreaterThan(0)
    expect(mean).toBeLessThan(limits.simMeanMs)
    expect(p99).toBeLessThan(limits.simP99Ms)
    expect(sim.inbound.dropped + sim.timers.dropped + sim.transitions.dropped).toBe(0)
  })
})
