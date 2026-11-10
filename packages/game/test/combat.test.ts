import { describe, expect, test } from 'bun:test'
import budgets from '@tokenfall/data/budgets.json'
import combat from '@tokenfall/data/combat.json'
import curve from '@tokenfall/data/level-curve.json'
import { LOCAL_MACHINE, NO_PLOT, type HeroInfo } from '@tokenfall/protocol/hero'
import { bootSim } from '../src/core/boot.ts'
import { hasMember } from '../src/core/dense-set.ts'
import { closeView, depthTierOf, ensureDungeon, openView } from '../src/core/dungeon.ts'
import { guildOf } from '../src/core/groups.ts'
import { entityOfHero } from '../src/core/hero-index.ts'
import { intensityTier, MONSTER_FREE, noteTools, tierOf, toolCount } from '../src/core/monsters.ts'
import { push } from '../src/core/queue.ts'
import { createProfile, runSystems } from '../src/core/system.ts'
import { SIM_SYSTEMS } from '../src/core/systems/index.ts'
import { EMITTER_STRIDE } from '../src/effects/emitters.ts'
import { BOLT_KIND, CRIT_KIND, FRENZY_KIND, HEAL_KIND, SLASH_KIND } from '../src/effects/systems.ts'

type Sim = ReturnType<typeof bootSim>

type Party = { readonly sim: Sim; readonly heroes: readonly number[]; readonly room: number }

const TOWN_SEED = 7
const FRAME_MS = 16
const SETTLE_MS = 30_000
const FIGHT_LIMIT_MS = 120_000
const BURST = 5
const BURST_EVERY_MS = 2000
const NORMAL_SECONDS = [12, 30] as const
const FRENZY_SECONDS = [2.5, 8] as const
const PROFILE = createProfile(SIM_SYSTEMS)

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
  status: 'working',
  experience,
  minions: 0,
  lead: false,
  alive: true,
  diedAt: 0,
  cause: null,
  ravens: 0,
  ravenThread: null,
  ravenSince: 0,
})

const step = (sim: Sim, now: number): void => {
  runSystems(SIM_SYSTEMS, PROFILE, sim, now, FRAME_MS)
}

const run = (sim: Sim, from: number, until: number): void => {
  for (let now = from; now < until; now += FRAME_MS) {
    step(sim, now)
  }
}

const party = (
  size: number,
  level: number,
  options: { readonly open?: boolean; readonly seed?: number; readonly monsters?: number } = {},
): Party => {
  const sim = bootSim(options.seed ?? TOWN_SEED, 0, {
    monsters: options.monsters ?? budgets.monsters,
  })
  const guild = guildOf(sim.groups, '/repo')
  const tier = depthTierOf(level, curve.depthTiers)
  ensureDungeon(sim, guild, tier)

  if (options.open !== false) {
    openView(sim, guild, tier)
  }

  for (let i = 0; i < size; i++) {
    push(sim.inbound, { kind: 'hero.joined', at: 0, hero: hero(`h${i}`, sim.thresholds[level]!) })
  }

  step(sim, 0)
  const heroes = Array.from({ length: size }, (_hero, i) => entityOfHero(sim.index, `h${i}`))

  return { sim, heroes, room: sim.stores.delve.room[heroes[0]!]! }
}

const burst = (sim: Sim, heroes: readonly number[], now: number): void => {
  for (const eid of heroes) {
    noteTools(sim, eid, BURST, false, now)
  }
}

const timeToClear = ({ sim, heroes, room }: Party, frenzy: boolean): number => {
  let first = -1
  let nextBurst = 0

  for (let now = FRAME_MS; now < FIGHT_LIMIT_MS; now += FRAME_MS) {
    if (frenzy && first >= 0 && now >= nextBurst) {
      burst(sim, heroes, now)
      nextBurst = now + BURST_EVERY_MS
    }

    step(sim, now)

    if (first < 0 && sim.combat.counters.swings > 0) {
      first = now

      if (frenzy) {
        burst(sim, heroes, now)
        nextBurst = now + BURST_EVERY_MS
      }
    }

    if (sim.combat.rooms.clearedAt[room]! > 0) {
      return (now - first) / 1000
    }
  }

  return Number.POSITIVE_INFINITY
}

describe('intensity', () => {
  test('tool starts raise it, it decays to 0 and maps to the tiers', () => {
    const sim = bootSim(TOWN_SEED, 0, {})
    const eid = 5

    expect(toolCount(sim, eid, 0)).toBe(0)

    noteTools(sim, eid, 1, false, 100)

    expect(toolCount(sim, eid, 200)).toBe(1)
    expect(intensityTier(sim, eid, 200)).toBe(0)

    noteTools(sim, eid, 2, false, 300)

    expect(toolCount(sim, eid, 400)).toBe(3)
    expect(combat.tiers[intensityTier(sim, eid, 400)]!.name).toBe('busy')

    noteTools(sim, eid, BURST, false, 500)

    expect(combat.tiers[intensityTier(sim, eid, 600)]!.name).toBe('frenzy')
    expect(toolCount(sim, eid, 500 + combat.windowMs)).toBe(0)
    expect(intensityTier(sim, eid, 500 + combat.windowMs)).toBe(0)
  })

  test('the tier table follows data/combat.json', () => {
    const cases = [
      [0, 'steady'],
      [1, 'steady'],
      [2, 'busy'],
      [4, 'busy'],
      [5, 'frenzy'],
      [8, 'frenzy'],
    ] as const

    for (const [count, name] of cases) {
      expect(combat.tiers[tierOf(combat.tiers, count)]!.name).toBe(name)
    }
  })

  test('Minion calls become strikes, not intensity', () => {
    const sim = bootSim(TOWN_SEED, 0, {})
    noteTools(sim, 3, 2, true, 100)

    expect(toolCount(sim, 3, 200)).toBe(0)
    expect(sim.combat.strikes[3]).toBe(2)
  })
})

describe('packs', () => {
  test('a Pack has 2 plus 1 per Hero in the Party', () => {
    const { sim, room } = party(3, 1)

    expect(sim.combat.rooms.alive[room]).toBe(combat.pack.base + 3 * combat.pack.perHero)
  })

  test('budgets.monsters is honored and the rest of the rooms stay empty', () => {
    const { sim } = party(1, 1, { monsters: 4 })

    expect(sim.combat.monsters.active).toBe(4)
    expect(sim.combat.counters.skipped).toBeGreaterThan(0)
  })

  test('the same seed gives the same Packs', () => {
    const first = party(2, 1).sim.combat.monsters
    const second = party(2, 1).sim.combat.monsters

    expect(second.kind).toEqual(first.kind)
    expect(second.x).toEqual(first.x)
    expect(second.y).toEqual(first.y)
    expect(party(2, 1, { seed: 8 }).sim.combat.monsters.x).not.toEqual(first.x)
  })

  test('an unseen tier runs no combat', () => {
    const { sim } = party(2, 1, { open: false })
    run(sim, FRAME_MS, SETTLE_MS)

    expect(sim.combat.monsters.active).toBe(0)
    expect(sim.combat.counters.swings).toBe(0)
    expect(sim.combat.fighters.size).toBe(0)
  })
})

describe('the fight', () => {
  test(
    'a Pack falls in about 20 s at normal pace, across Levels and tiers',
    () => {
      for (const level of [1, 12, 30, 60, 90]) {
        const seconds = timeToClear(party(2, level), false)

        expect(seconds).toBeGreaterThan(NORMAL_SECONDS[0])
        expect(seconds).toBeLessThan(NORMAL_SECONDS[1])
      }
    },
    FIGHT_LIMIT_MS,
  )

  test(
    'a Pack falls in about 5 s in a Frenzy',
    () => {
      for (const level of [1, 30, 90]) {
        const seconds = timeToClear(party(2, level), true)

        expect(seconds).toBeGreaterThan(FRENZY_SECONDS[0])
        expect(seconds).toBeLessThan(FRENZY_SECONDS[1])
      }
    },
    FIGHT_LIMIT_MS,
  )

  test('Hero HP never drops under the floor and refills on a clear', () => {
    const fight = party(1, 1)
    const [eid] = fight.heroes
    let lowest = 1

    for (let now = FRAME_MS; now < FIGHT_LIMIT_MS; now += FRAME_MS) {
      step(fight.sim, now)
      lowest = Math.min(lowest, fight.sim.combat.hp[eid!]!)

      if (fight.sim.combat.rooms.clearedAt[fight.room]! > 0) {
        break
      }
    }

    expect(lowest).toBeLessThan(1)
    expect(lowest).toBeGreaterThanOrEqual(combat.hpFloor - 1e-6)
    expect(fight.sim.combat.hp[eid!]).toBe(1)
  })

  test('a cleared room sends the Party on and refills once it is empty', () => {
    const fight = party(1, 1)
    const [eid] = fight.heroes
    timeToClear(fight, true)
    const cleared = fight.sim.combat.rooms.clearedAt[fight.room]!
    run(fight.sim, cleared, cleared + combat.moveOnMs + FRAME_MS * 2)

    expect(fight.sim.stores.delve.room[eid!]).not.toBe(fight.room)

    run(
      fight.sim,
      cleared + combat.moveOnMs + FRAME_MS * 2,
      cleared + combat.moveOnMs + combat.refillMs + 2000,
    )

    expect(fight.sim.combat.rooms.alive[fight.room]).toBeGreaterThan(0)
  })

  test('a Hero leaving mid-fight leaves the Pack hurt', () => {
    const { sim, heroes } = party(1, 1)
    const [eid] = heroes
    let now = FRAME_MS

    while (sim.combat.counters.swings < 2 && now < FIGHT_LIMIT_MS) {
      step(sim, now)
      now += FRAME_MS
    }

    const slot = sim.combat.target[eid!]!
    const hurt = sim.combat.monsters.hp[slot]!
    push(sim.inbound, { kind: 'hero.status', at: now, hero: 'h0', status: 'idle' })
    run(sim, now, now + 5000)

    expect(hasMember(sim.combat.fighters, eid!)).toBe(false)
    expect(sim.combat.monsters.state[slot]).not.toBe(MONSTER_FREE)
    expect(sim.combat.monsters.hp[slot]).toBe(hurt)
    expect(hurt).toBeLessThan(sim.combat.monsters.maxHp[slot]!)
  })

  test('a Death mid-fight makes the Pack back off, then the fight goes on', () => {
    const { sim, room } = party(2, 1)
    let now = FRAME_MS

    while (sim.combat.counters.swings < 2 && now < FIGHT_LIMIT_MS) {
      step(sim, now)
      now += FRAME_MS
    }

    push(sim.inbound, { kind: 'hero.died', at: now, hero: 'h0', cause: 'killed' })
    run(sim, now, now + 100)
    now += 100
    const swings = sim.combat.counters.swings

    expect(sim.combat.rooms.holdUntil[room]).toBeGreaterThan(now)

    run(sim, now, now + 1000)

    expect(sim.combat.counters.swings).toBe(swings)

    const until = sim.combat.rooms.holdUntil[room]!
    run(sim, now + 1000, until + 4000)

    expect(sim.combat.counters.swings).toBeGreaterThan(swings)
  })
})

const aimed = (sim: Sim, kindId: number): boolean => {
  const kind = sim.effects[kindId]!

  for (let slot = 0; slot < kind.highWater; slot++) {
    const base = slot * EMITTER_STRIDE + 4

    if (kind.used[slot] === 1 && (kind.data[base] !== 0 || kind.data[base + 1] !== 0)) {
      return true
    }
  }

  return false
}

describe('effects', () => {
  test('every swing throws a slash or a bolt toward its target, and a crit flashes', () => {
    const { sim, heroes, room } = party(3, 30)
    let swings = 0
    let crits = 0
    let swingFrames = 0
    let critFrames = 0

    for (let now = FRAME_MS; sim.combat.rooms.clearedAt[room] === 0; now += FRAME_MS) {
      if (now % BURST_EVERY_MS < FRAME_MS) {
        burst(sim, heroes, now)
      }

      step(sim, now)

      if (sim.combat.counters.swings > swings) {
        swingFrames += 1

        expect(sim.effects[SLASH_KIND]!.active + sim.effects[BOLT_KIND]!.active).toBeGreaterThan(0)
        expect(aimed(sim, SLASH_KIND) || aimed(sim, BOLT_KIND)).toBe(true)
      }

      if (sim.combat.counters.crits > crits) {
        critFrames += 1

        expect(sim.effects[CRIT_KIND]!.active).toBeGreaterThan(0)
      }

      swings = sim.combat.counters.swings
      crits = sim.combat.counters.crits
    }

    expect(swingFrames).toBeGreaterThan(0)
    expect(critFrames).toBeGreaterThan(0)
  })

  test('a cleared room makes its Party glow', () => {
    const fight = party(3, 1)
    timeToClear(fight, true)

    expect(fight.sim.effects[HEAL_KIND]!.active).toBe(fight.heroes.length)
  })

  test('a Frenzy lights an aura that goes out when the calls stop or the view closes', () => {
    const fight = party(2, 1)
    const { sim } = fight
    let now = FRAME_MS

    while (sim.combat.counters.swings === 0) {
      step(sim, now)
      now += FRAME_MS
    }

    burst(sim, fight.heroes, now)
    step(sim, now)

    expect(sim.effects[FRENZY_KIND]!.active).toBe(fight.heroes.length)

    run(sim, now + FRAME_MS, now + combat.windowMs + FRAME_MS * 2)

    expect(sim.effects[FRENZY_KIND]!.active).toBe(0)

    now += combat.windowMs + FRAME_MS * 4
    burst(sim, fight.heroes, now)
    step(sim, now)

    expect(sim.effects[FRENZY_KIND]!.active).toBe(fight.heroes.length)

    closeView(sim)
    step(sim, now + FRAME_MS)

    expect(sim.effects[FRENZY_KIND]!.active).toBe(0)
  })
})
