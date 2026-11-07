import { describe, expect, test } from 'bun:test'
import { createSynthetic } from '@tokenfall/replay/synthetic'
import type { HeroEvent } from '@tokenfall/protocol/events'
import { bootSim } from '../src/core/boot.ts'
import { push } from '../src/core/queue.ts'
import { createProfile, runSystems } from '../src/core/system.ts'
import { SIM_SYSTEMS } from '../src/core/systems/index.ts'
import { heroCount } from '../src/core/hero-index.ts'
import limits from './load-limits.json'

const FRAME_MS = 1000 / 60
const TEMPO = 20

const runLoad = (heroes: number, seconds: number) => {
  const sim = bootSim(7, 0, {})
  const synthetic = createSynthetic({
    seed: 7,
    heroes,
    guilds: Math.max(1, Math.round(heroes / 12)),
    workspacesPerGuild: 3,
    tempo: TEMPO,
    startAt: 0,
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
})
