import { describe, expect, test } from 'bun:test'
import { LOCAL_MACHINE, NO_PLOT, type HeroInfo, type HeroStatus } from '@tokenfall/protocol/hero'
import { bootSim } from '../src/core/boot.ts'
import { entityOfHero, NONE } from '../src/core/hero-index.ts'
import { push } from '../src/core/queue.ts'
import { runSystems, createProfile } from '../src/core/system.ts'
import { SIM_SYSTEMS } from '../src/core/systems/index.ts'
import { createAttentionQueue, nextInQueue } from '../src/features/attention/queue.ts'

const hero = (id: string, status: HeroStatus): HeroInfo => ({
  id,
  session: id,
  machine: LOCAL_MACHINE,
  pane: id,
  workspace: 'w1',
  guild: '/repo',
  plot: NO_PLOT,
  title: '',
  quest: '',
  status,
  experience: 0,
  minions: 0,
  lead: false,
  alive: true,
})

const STATUSES: readonly (readonly [string, HeroStatus])[] = [
  ['idle-1', 'idle'],
  ['done-1', 'done'],
  ['blocked-1', 'blocked'],
  ['working-1', 'working'],
  ['blocked-2', 'blocked'],
]

describe('attention queue', () => {
  test('cycles ravens first, then loot, and skips everyone else', () => {
    const sim = bootSim(1, 0, {})

    for (const [id, status] of STATUSES) {
      push(sim.inbound, { kind: 'hero.joined', at: 0, hero: hero(id, status) })
    }

    runSystems(SIM_SYSTEMS, createProfile(SIM_SYSTEMS), sim, 0, 16)
    const queue = createAttentionQueue(sim)
    const eid = (id: string): number => entityOfHero(sim.index, id)
    const first = nextInQueue(queue, sim, NONE)
    const second = nextInQueue(queue, sim, first)
    const third = nextInQueue(queue, sim, second)

    expect([first, second, third]).toEqual([eid('blocked-1'), eid('blocked-2'), eid('done-1')])
    expect(nextInQueue(queue, sim, third)).toBe(first)
  })
})
