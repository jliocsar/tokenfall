import { describe, expect, test } from 'bun:test'
import type { HeroEvent } from '@tokenfall/protocol/events'
import { isLeadTab } from '../src/adapters/herdr/adapter.ts'
import { assertAllowed, request } from '../src/adapters/herdr/client.ts'
import { handleHook, type Hook } from '../src/adapters/hooks/handle.ts'
import { migrate, openDatabase, schemaVersion } from '../src/store/db.ts'
import { MIGRATIONS } from '../src/store/migrations/index.ts'
import {
  anyDone,
  createWorld,
  flushDirty,
  observe,
  killHero,
  paneGone,
  setLeads,
  setStatus,
  snapshotHeroes,
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

const hook = (event: string, session: string, extra: Partial<Hook> = {}): Hook => ({
  event,
  session,
  tool: undefined,
  agent: undefined,
  source: undefined,
  reason: undefined,
  ...extra,
})

const deaths = (events: readonly HeroEvent[]): number =>
  events.filter((event) => event.kind === 'hero.died').length

const HOUR = 3_600_000

const restarted = (world: World): World => {
  flushDirty(world)

  return createWorld(world.db, PLOTS)
}

const KILLS: readonly (readonly [string, (world: World, now: number) => void])[] = [
  ['pane.closed', (world, now) => paneGone(world, 'w1:p1', 'killed', now)],
  ['pane.exited', (world, now) => paneGone(world, 'w1:p1', 'exited', now)],
  ['released', (world, now) => paneGone(world, 'w1:p1', 'released', now)],
  ['SessionEnd', (world, now) => handleHook(world, hook('SessionEnd', 's1'), 'w1:p1', now)],
  [
    '/clear',
    (world, now) => handleHook(world, hook('SessionEnd', 's1', { reason: 'clear' }), 'w1:p1', now),
  ],
  ['missing', (world, now) => sweepMissing(world, new Set(), 1, now)],
]

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
    paneGone(world, 'w1:p1', 'exited', 2)
    observe(world, seen('w1:p2', 's1'), 3)
    const events = drain(world)

    expect(kinds(events)).toEqual([
      'hero.joined',
      'hero.died',
      'hero.resurrected',
      'hero.status',
      'hero.quest',
    ])
    expect(events[2]).toMatchObject({
      info: { alive: true, pane: 'w1:p2', diedAt: 0, cause: null },
    })
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

describe('death', () => {
  for (const [first, killFirst] of KILLS) {
    for (const [second, killSecond] of KILLS) {
      test(`${first} then ${second} kills once`, () => {
        const world = freshWorld()
        observe(world, seen('w1:p1', 's1'), 1)
        killFirst(world, 2)
        killSecond(world, 3)

        expect(deaths(drain(world))).toBe(1)
      })
    }
  }

  test('a record that is already dead cannot die again', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    const record = world.live.get('local/session/s1')!
    paneGone(world, 'w1:p1', 'killed', 2)
    drain(world)
    killHero(world, record, 'exited', 3)

    expect(drain(world)).toEqual([])
    expect(record.deathCause).toBe('killed')
  })

  test('/clear in the same pane kills the old Hero once', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    handleHook(world, hook('SessionEnd', 's1', { reason: 'clear' }), 'w1:p1', 2)
    observe(world, seen('w1:p1', 's2'), 3)

    expect(deaths(drain(world))).toBe(1)
  })

  test('SessionEnd for a resume is still not a Death', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    handleHook(world, hook('SessionEnd', 's1', { reason: 'resume' }), 'w1:p1', 2)

    expect(deaths(drain(world))).toBe(0)
  })
})

describe('the Fallen', () => {
  test('the snapshot carries the Fallen within a day, newest first', () => {
    const world = freshWorld()
    const now = 100 * HOUR
    observe(world, seen('w1:p1', 'old'), 1)
    paneGone(world, 'w1:p1', 'killed', now - 25 * HOUR)
    observe(world, seen('w1:p2', 'a'), 2)
    paneGone(world, 'w1:p2', 'exited', now - 2 * HOUR)
    observe(world, seen('w1:p3', 'b'), 3)
    paneGone(world, 'w1:p3', 'cleared', now - HOUR)
    observe(world, seen('w1:p4', null), 4)
    paneGone(world, 'w1:p4', 'killed', now - HOUR)
    observe(world, seen('w1:p5', 'alive'), 5)
    const heroes = snapshotHeroes(world, now)

    expect(heroes.map((hero) => hero.id)).toEqual([
      'local/session/alive',
      'local/session/b',
      'local/session/a',
    ])
    expect(heroes[1]).toMatchObject({ alive: false, diedAt: now - HOUR, cause: 'cleared' })
    expect(heroes[0]).toMatchObject({ alive: true, diedAt: 0, cause: null })
  })

  test('the snapshot holds at most 30 Graves', () => {
    const world = freshWorld()
    const now = 100 * HOUR

    for (let index = 0; index < 35; index++) {
      observe(world, seen(`w1:p${index}`, `s${index}`), index)
      paneGone(world, `w1:p${index}`, 'killed', now - HOUR + index)
    }

    const heroes = snapshotHeroes(world, now)

    expect(heroes.length).toBe(30)
    expect(heroes[0]?.id).toBe('local/session/s34')
  })

  test('a Resurrection after a daemon restart, through Herdr', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    paneGone(world, 'w1:p1', 'killed', 2)
    const later = restarted(world)
    observe(later, seen('w1:p2', 's1'), 3)
    const events = drain(later)

    expect(kinds(events)).toEqual(['hero.resurrected', 'hero.status', 'hero.quest'])
    expect(snapshotHeroes(later, 4).map((hero) => hero.alive)).toEqual([true])
  })

  test('a Resurrection after a daemon restart, through the hook', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    paneGone(world, 'w1:p1', 'exited', 2)
    const later = restarted(world)
    observe(later, seen('w1:p2', null), 3)
    handleHook(later, hook('SessionStart', 's1', { source: 'resume' }), 'w1:p2', 4)
    const events = drain(later)

    expect(kinds(events)).toEqual(['hero.joined', 'hero.linked', 'hero.resurrected'])
    expect(events.find((event) => event.kind === 'hero.resurrected')).toMatchObject({
      hero: 'local/session/s1',
      info: { alive: true, pane: 'w1:p2' },
    })
    expect(later.paneHero.get('w1:p2')).toBe('local/session/s1')
  })
})

describe('save', () => {
  test('migration 0002 keeps v1 Heroes and indexes died_at', () => {
    const db = openDatabase(':memory:')
    migrate(db, MIGRATIONS.slice(0, 1), undefined)
    db.run(
      `INSERT INTO heroes (id, session, machine, pane, workspace, guild, title, quest, alive, born_at, seen_at, died_at, death_cause)
       VALUES ('local/session/s1', 's1', 'local', 'w1:p1', 'w1', '/repo/a', '', 'q', 0, 1, 2, 3, 'killed')`,
    )
    migrate(db, MIGRATIONS, undefined)
    const index = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'heroes_died_at'",
      )
      .get()

    expect(schemaVersion(db)).toBe(2)
    expect(index?.name).toBe('heroes_died_at')
    expect(snapshotHeroes(createWorld(db, PLOTS), 10).map((hero) => hero.cause)).toEqual(['killed'])
  })

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
