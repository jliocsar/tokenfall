import { describe, expect, test } from 'bun:test'
import { migrate, openDatabase } from '../src/store/db.ts'
import { tailChronicle } from '../src/store/chronicle.ts'
import { MIGRATIONS } from '../src/store/migrations/index.ts'
import {
  createWorld,
  flushDirty,
  gainExperience,
  observe,
  paneGone,
  settleArrival,
  type Observed,
  type World,
} from '../src/world.ts'

const PLOTS = 8
const HERO = 'local/session/s1'
const LEVEL_40 = 1_930_000
const LEVEL_41 = 2_300_000

const freshWorld = (): World => {
  const db = openDatabase(':memory:')
  migrate(db, MIGRATIONS, undefined)

  return createWorld(db, PLOTS)
}

const seen = (pane: string, session: string | null): Observed => ({
  pane,
  workspace: 'w1',
  session,
  guild: '/repo/a',
  title: 'fastlane',
  quest: 'a quest',
  status: 'working',
})

const lines = (world: World): string[] =>
  world.chronicle
    .splice(0)
    .map((line) => `${line.kind} ${line.level ?? ''} ${line.cause ?? ''}`.trim())

describe('chronicle', () => {
  test('a new Hero joins at the Level its transcript gives it', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)

    expect(lines(world)).toEqual([])

    gainExperience(world, world.live.get(HERO)!, LEVEL_40, true, 2)

    expect(lines(world)).toEqual(['joined 40'])
  })

  test('a Hero without tokens still joins, at Level 1', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    settleArrival(world, world.live.get(HERO)!, 2)

    expect(lines(world)).toEqual(['joined 1'])
  })

  test('Level ups, Deaths and Resurrections each get a line', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    const hero = world.live.get(HERO)!
    gainExperience(world, hero, LEVEL_40, true, 2)
    gainExperience(world, hero, LEVEL_40 + 1, false, 3)
    gainExperience(world, hero, LEVEL_41, false, 4)
    paneGone(world, 'w1:p1', 'exited', 5)
    observe(world, seen('w1:p2', 's1'), 6)

    expect(lines(world)).toEqual(['joined 40', 'level 41', 'died 41 exited', 'resurrected 41'])
  })

  test('a Stranger gets no line until it is revealed', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', null), 1)
    paneGone(world, 'w1:p1', 'killed', 2)
    observe(world, seen('w1:p2', null), 3)
    observe(world, seen('w1:p2', 's1'), 4)
    settleArrival(world, world.live.get(HERO)!, 5)

    expect(lines(world)).toEqual(['linked 1'])
  })

  test('a Hero that dies before its first read still joins first', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    paneGone(world, 'w1:p1', 'exited', 2)

    expect(lines(world)).toEqual(['joined 1', 'died 1 exited'])
  })

  test('the tail is oldest first and carries the saved title', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    paneGone(world, 'w1:p1', 'exited', 2)
    flushDirty(world)
    const tail = tailChronicle(world.db, 1)

    expect(tail.map((line) => line.kind)).toEqual(['died'])
    expect(tail[0]?.title).toBe('fastlane')
    expect(tailChronicle(world.db, 10).map((line) => line.seq)).toEqual([1, 2])
  })
})
