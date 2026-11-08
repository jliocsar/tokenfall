import { describe, expect, test } from 'bun:test'
import { LOCAL_MACHINE, NO_PLOT, type HeroInfo, type HeroStatus } from '@tokenfall/protocol/hero'
import { bootSim } from '../src/core/boot.ts'
import { stateId } from '../src/core/fsm.ts'
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
  ravens: 0,
  ravenThread: null,
  ravenSince: 0,
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

  test('orders permission Ravens, then Inbox Ravens, then chests, oldest first', () => {
    const sim = bootSim(1, 0, {})
    const joins: readonly HeroInfo[] = [
      { ...hero('loot-old', 'done') },
      { ...hero('inbox-new', 'working'), ravens: 1, ravenSince: 50 },
      { ...hero('inbox-old', 'idle'), ravens: 2, ravenSince: 10 },
      { ...hero('blocked-new', 'blocked') },
      { ...hero('blocked-old', 'blocked') },
    ]

    joins.forEach((info, i) => {
      push(sim.inbound, { kind: 'hero.joined', at: 100 - i, hero: info })
    })
    push(sim.inbound, {
      kind: 'hero.ravens',
      at: 200,
      hero: 'loot-old',
      ravens: 0,
      thread: null,
      since: 0,
    })
    runSystems(SIM_SYSTEMS, createProfile(SIM_SYSTEMS), sim, 0, 16)
    const queue = createAttentionQueue(sim)
    const order: number[] = []
    let current = NONE

    for (let i = 0; i < joins.length; i++) {
      current = nextInQueue(queue, sim, current)
      order.push(current)
    }

    const eid = (id: string): number => entityOfHero(sim.index, id)

    expect(order).toEqual(
      ['blocked-old', 'blocked-new', 'inbox-old', 'inbox-new', 'loot-old'].map(eid),
    )
  })

  test('a chest seen during the warp out still opens once the warp ends', () => {
    const sim = bootSim(1, 0, {})
    const profile = createProfile(SIM_SYSTEMS)
    push(sim.inbound, { kind: 'hero.joined', at: 0, hero: hero('h', 'working') })
    runSystems(SIM_SYSTEMS, profile, sim, 0, 16)
    push(sim.inbound, { kind: 'hero.status', at: 10, hero: 'h', status: 'done' })
    runSystems(SIM_SYSTEMS, profile, sim, 10, 16)
    push(sim.inbound, { kind: 'hero.status', at: 100, hero: 'h', status: 'idle' })
    runSystems(SIM_SYSTEMS, profile, sim, 100, 16)
    runSystems(SIM_SYSTEMS, profile, sim, 700, 16)
    const state = sim.stores.behavior.state[entityOfHero(sim.index, 'h')]

    expect(state).toBe(stateId(sim.machine, 'opening'))
  })
})
