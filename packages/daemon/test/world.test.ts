import { describe, expect, test } from 'bun:test'
import type { HeroEvent } from '@tokenfall/protocol/events'
import { isLeadTab } from '../src/adapters/herdr/adapter.ts'
import { assertAllowed, request } from '../src/adapters/herdr/client.ts'
import { migrate, openDatabase, schemaVersion } from '../src/store/db.ts'
import { MIGRATIONS } from '../src/store/migrations/index.ts'
import {
  anyDone,
  createWorld,
  flushDirty,
  observe,
  paneGone,
  setLeads,
  setStatus,
  sweepMissing,
  type Observed,
  type World,
} from '../src/world.ts'

const PLOTS = 8

const freshWorld = (): World => {
  const db = openDatabase(':memory:')
  migrate(db, MIGRATIONS, undefined)

  return createWorld(db, PLOTS)
}

const seen = (pane: string, session: string | null, extra: Partial<Observed> = {}): Observed => ({
  pane,
  workspace: 'w1',
  session,
  guild: '/repo/a',
  title: '',
  quest: 'a quest',
  status: 'working',
  ...extra,
})

const drain = (world: World): HeroEvent[] => world.outbox.splice(0)

const kinds = (events: readonly HeroEvent[]): string[] => events.map((event) => event.kind)

describe('identity', () => {
  test('a session Hero joins with a plot and is saved', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    const events = drain(world)

    expect(kinds(events)).toEqual(['hero.joined'])
    expect(world.live.get('local/session/s1')?.plot).toBe(0)

    flushDirty(world)
    const reopened = createWorld(world.db, PLOTS)

    expect(reopened.live.get('local/session/s1')?.status).toBe('unknown')
    expect(reopened.live.get('local/session/s1')?.plot).toBe(0)
  })

  test('a Stranger becomes a Hero when its session arrives', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', null), 1)
    observe(world, seen('w1:p1', 's1'), 2)
    const events = drain(world)

    expect(kinds(events)).toEqual(['hero.joined', 'hero.linked'])
    expect(world.live.has('local/pane/w1:p1')).toBe(false)
    expect(world.paneHero.get('w1:p1')).toBe('local/session/s1')
  })

  test('a new session in the same pane kills the old Hero as cleared', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    observe(world, seen('w1:p1', 's2'), 2)
    const events = drain(world)

    expect(kinds(events)).toEqual(['hero.joined', 'hero.died', 'hero.joined'])
    expect(events[1]).toMatchObject({ hero: 'local/session/s1', cause: 'cleared' })
  })

  test('a pane without a session keeps its Hero until a session shows up', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    observe(world, seen('w1:p1', null, { status: 'idle' }), 2)
    const events = drain(world)

    expect(kinds(events)).toEqual(['hero.joined', 'hero.status'])
  })

  test('resuming a dead Hero brings it back', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    world.known.add('local/session/s1')
    paneGone(world, 'w1:p1', 'exited', 2)
    observe(world, seen('w1:p2', 's1'), 3)
    const events = drain(world)

    expect(kinds(events)).toEqual([
      'hero.joined',
      'hero.died',
      'hero.joined',
      'hero.resurrected',
      'hero.status',
      'hero.quest',
    ])
  })

  test('the plot is freed when the last Hero of a Guild dies', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    paneGone(world, 'w1:p1', 'killed', 2)
    observe(world, seen('w1:p2', 's2', { guild: '/repo/b' }), 3)

    expect(world.plots.has('/repo/a')).toBe(false)
    expect(world.plots.get('/repo/b')).toBe(0)
  })

  test('a Hero missing from two re-reads dies as missing', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    sweepMissing(world, new Set(), 2, 2)

    expect(world.live.size).toBe(1)

    sweepMissing(world, new Set(), 2, 3)

    expect(world.live.size).toBe(0)
    expect(drain(world).at(-1)).toMatchObject({ kind: 'hero.died', cause: 'missing' })
  })
})

describe('save', () => {
  test('migrations run once and record the schema', () => {
    const db = openDatabase(':memory:')
    migrate(db, MIGRATIONS, undefined)
    migrate(db, MIGRATIONS, undefined)

    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
  })

  test('a save from a newer build is refused', () => {
    const db = openDatabase(':memory:')
    migrate(db, MIGRATIONS, undefined)

    expect(() => migrate(db, [], undefined)).toThrow('this build only knows 0')
  })
})

describe('herdr allowlist', () => {
  test('write methods are refused before any socket opens', () => {
    expect(() => {
      assertAllowed('pane.send_text')
    }).toThrow('read-only allowlist')
    expect(() => request('pane.send_input', {})).toThrow('read-only allowlist')
  })

  test('read methods pass', () => {
    expect(() => {
      assertAllowed('agent.list')
    }).not.toThrow()
    expect(() => {
      assertAllowed('tab.list')
    }).not.toThrow()
  })

  test('tab writes stay refused', () => {
    for (const method of ['tab.create', 'tab.rename', 'tab.focus', 'tab.close']) {
      expect(() => {
        assertAllowed(method)
      }).toThrow('read-only allowlist')
    }
  })
})

describe('the lead', () => {
  test('a tab labelled lead marks its pane, with or without the tab number', () => {
    expect(isLeadTab('lead')).toBe(true)
    expect(isLeadTab('1 · lead')).toBe(true)
    expect(isLeadTab('leader')).toBe(false)
    expect(isLeadTab('2 · node_modules › lead the way')).toBe(false)
  })

  test('setLeads sends hero.lead only when it changes', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    observe(world, seen('w1:p2', 's2'), 1)
    drain(world)
    setLeads(world, new Set(['w1:p1']), 2)
    const events = drain(world)

    expect(kinds(events)).toEqual(['hero.lead'])
    expect(events[0]).toMatchObject({ at: 2, lead: true })

    setLeads(world, new Set(['w1:p1']), 3)

    expect(drain(world)).toEqual([])

    setLeads(world, new Set(), 4)

    expect(kinds(drain(world))).toEqual(['hero.lead'])
  })
})

describe('seen state', () => {
  test('a finished Hero turns idle when a re-read says it was seen', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1', { status: 'done' }), 1)
    drain(world)

    expect(anyDone(world)).toBe(true)

    setStatus(world, 'w1:p1', 'done', 2)

    expect(drain(world)).toEqual([])

    setStatus(world, 'w1:p1', 'idle', 3)

    expect(drain(world)).toEqual([
      { kind: 'hero.status', at: 3, hero: 'local/session/s1', status: 'idle' },
    ])
    expect(anyDone(world)).toBe(false)
  })
})
