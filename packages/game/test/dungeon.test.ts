import { describe, expect, test } from 'bun:test'
import plan from '@tokenfall/data/dungeon.json'
import curve from '@tokenfall/data/level-curve.json'
import { LOCAL_MACHINE, NO_PLOT, type HeroInfo } from '@tokenfall/protocol/hero'
import { bootSim } from '../src/core/boot.ts'
import {
  CELL,
  dungeonSeed,
  generateDungeon,
  walkable,
  type DungeonMap,
} from '../src/core/dungeon-gen.ts'
import {
  cellAt,
  depthTierOf,
  dungeonAt,
  ensureDungeon,
  partyRoom,
  settleTier,
} from '../src/core/dungeon.ts'
import { entityOfHero } from '../src/core/hero-index.ts'
import { push } from '../src/core/queue.ts'
import { createProfile, runSystems } from '../src/core/system.ts'
import { SIM_SYSTEMS } from '../src/core/systems/index.ts'
import { guildOf, partyOf } from '../src/core/groups.ts'

const SEEDS = 200
const TOWN_SEED = 7
const ROOM_RANGE = [5, 25] as const
const WORKING_EXPERIENCE = 5_000_000

const generate = (tier: number, key: string): DungeonMap =>
  generateDungeon(
    plan.tiers[tier]!,
    tier,
    plan.tiers.length,
    dungeonSeed(TOWN_SEED, key, tier),
    plan.timeLimitMs,
  )

const reachable = (map: DungeonMap): Uint8Array => {
  const seen = new Uint8Array(map.cells.length)
  const stack = [map.arrival]
  seen[map.arrival] = 1

  while (stack.length > 0) {
    const cell = stack.pop()!
    const x = cell % map.width

    for (const next of [
      x > 0 ? cell - 1 : -1,
      x < map.width - 1 ? cell + 1 : -1,
      cell - map.width,
      cell + map.width,
    ]) {
      if (next >= 0 && next < map.cells.length && seen[next] === 0 && walkable(map.cells[next]!)) {
        seen[next] = 1
        stack.push(next)
      }
    }
  }

  return seen
}

const hero = (id: string, workspace: string, experience: number): HeroInfo => ({
  id,
  session: id,
  machine: LOCAL_MACHINE,
  pane: id,
  workspace,
  guild: '/repo',
  plot: NO_PLOT,
  title: '',
  quest: '',
  status: 'working',
  experience,
  minions: 0,
  lead: false,
  alive: true,
  ravens: 0,
  ravenThread: null,
  ravenSince: 0,
})

describe('dungeon generator', () => {
  test('the same seed gives the same tier twice', () => {
    for (const tier of plan.tiers.keys()) {
      const first = generate(tier, '/repo/a')
      const second = generate(tier, '/repo/a')

      expect(second.cells).toEqual(first.cells)
      expect(second.roomOf).toEqual(first.roomOf)
      expect(second.arrival).toBe(first.arrival)
    }
  })

  test('different Guilds get different Dungeons', () => {
    expect(generate(0, '/repo/a').cells).not.toEqual(generate(0, '/repo/b').cells)
  })

  test('every room, the arrival point and the stairs are reachable', () => {
    for (const tier of plan.tiers.keys()) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const map = generate(tier, `/repo/${seed}`)
        const seen = reachable(map)

        for (let room = 0; room < map.rooms; room++) {
          expect(seen[map.roomY[room]! * map.width + map.roomX[room]!]).toBe(1)
        }

        for (const stairs of [map.up, map.down]) {
          expect(stairs < 0 || seen[stairs] === 1).toBe(true)
        }
      }
    }
  })

  test('room counts stay in range', () => {
    for (const tier of plan.tiers.keys()) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const { rooms } = generate(tier, `/repo/${seed}`)

        expect(rooms).toBeGreaterThanOrEqual(ROOM_RANGE[0])
        expect(rooms).toBeLessThanOrEqual(ROOM_RANGE[1])
      }
    }
  })

  test('Prison has no stairs up and Hell no stairs down', () => {
    const prison = generate(0, '/repo/a')
    const hell = generate(plan.tiers.length - 1, '/repo/a')

    expect(prison.up).toBe(-1)
    expect(prison.cells[prison.down]).toBe(CELL.down)
    expect(hell.down).toBe(-1)
    expect(hell.cells.includes(CELL.lava)).toBe(true)
  })
})

describe('depth tiers', () => {
  test('Levels map to tiers through depthTiers', () => {
    const cases = [
      [1, 0],
      [24, 0],
      [25, 1],
      [49, 1],
      [50, 2],
      [74, 2],
      [75, 3],
      [99, 3],
    ] as const

    for (const [level, tier] of cases) {
      expect(depthTierOf(level, curve.depthTiers)).toBe(tier)
    }
  })
})

describe('party rooms', () => {
  test('a claim is stable and a clash takes another room', () => {
    const sim = bootSim(TOWN_SEED, 0, {})
    const guild = guildOf(sim.groups, '/repo')
    const first = partyOf(sim.groups, guild, 'w1')
    const second = partyOf(sim.groups, guild, 'w2')
    ensureDungeon(sim, guild, 0)
    const room = partyRoom(sim, guild, 0, first)

    expect(partyRoom(sim, guild, 0, first)).toBe(room)
    expect(partyRoom(sim, guild, 0, second)).not.toBe(room)
  })

  test('a working Hero waits outside an unseen tier, then stands in its Party room', () => {
    const sim = bootSim(TOWN_SEED, 0, {})
    const profile = createProfile(SIM_SYSTEMS)
    push(sim.inbound, { kind: 'hero.joined', at: 0, hero: hero('a', 'w1', WORKING_EXPERIENCE) })
    runSystems(SIM_SYSTEMS, profile, sim, 0, 16)
    const eid = entityOfHero(sim.index, 'a')
    const guild = sim.stores.hero.guild[eid]!

    for (let now = 16; now < 20_000; now += 16) {
      runSystems(SIM_SYSTEMS, profile, sim, now, 16)
    }

    expect(sim.stores.delve.inside[eid]).toBe(1)
    expect(sim.stores.delve.placed[eid]).toBe(0)

    const tier = sim.stores.delve.tier[eid]!

    expect(dungeonAt(sim, guild, tier)).toBeUndefined()

    const map = settleTier(sim, guild, tier)

    expect(sim.stores.delve.placed[eid]).toBe(1)

    const cell = cellAt(sim, map, guild, sim.stores.position.x[eid]!, sim.stores.position.y[eid]!)

    expect(walkable(map.cells[cell]!)).toBe(true)
    expect(map.roomOf[cell]).toBe(partyRoom(sim, guild, tier, sim.stores.hero.party[eid]!))
  })
})
