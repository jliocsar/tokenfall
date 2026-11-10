import { addMember, createDenseSet, hasMember, removeMember, type DenseSet } from './dense-set.ts'
import type { Sim } from './sim.ts'

export type CombatTier = {
  readonly name: string
  readonly from: number
  readonly swingMs: number
  readonly crit: number
}

export type MonsterKind = { readonly name: string; readonly hp: number; readonly ranged: boolean }

export type CombatTuning = {
  readonly windowMs: number
  readonly ring: number
  readonly tiers: readonly CombatTier[]
  readonly critMultiplier: number
  readonly bonusSwings: number
  readonly bonusGapMs: number
  readonly packShare: number
  readonly levelBonus: number
  readonly levelSpan: number
  readonly monsterHp: readonly number[]
  readonly monsters: readonly MonsterKind[]
  readonly pack: {
    readonly base: number
    readonly perHero: number
    readonly max: number
    readonly spread: number
  }
  readonly monsterSwingMs: number
  readonly monsterHit: readonly number[]
  readonly hpFloor: number
  readonly reach: {
    readonly melee: number
    readonly ranged: number
    readonly slack: number
    readonly spread: number
  }
  readonly rangedSheets: readonly string[]
  readonly riseMs: number
  readonly attackMs: number
  readonly heroAttackMs: number
  readonly monsterHitMs: number
  readonly tints: readonly (readonly number[])[]
  readonly crumbleMs: number
  readonly hitFlashMs: number
  readonly lungeMs: number
  readonly lunge: number
  readonly moveOnMs: number
  readonly refillMs: number
  readonly minionShare: number
  readonly minionStrikes: number
  readonly minionGapMs: number
  readonly maxRooms: number
  readonly backOff: number
  readonly backOffMs: number
  readonly rangedRadius: number
  readonly numbers: {
    readonly lifeMs: number
    readonly rise: number
    readonly lift: number
    readonly scale: number
    readonly critScale: number
    readonly wispScale: number
    readonly jitter: number
    readonly digits: number
    readonly colors: readonly (readonly number[])[]
  }
  readonly bars: {
    readonly width: number
    readonly height: number
    readonly heroLift: number
    readonly monsterLift: number
    readonly back: readonly number[]
    readonly hero: readonly number[]
    readonly monster: readonly number[]
  }
}

export type CombatConfig = CombatTuning & { readonly rangedSheet: Uint8Array }

export type Monsters = {
  readonly kind: Uint8Array
  readonly room: Int16Array
  readonly state: Uint8Array
  readonly since: Float64Array
  readonly hp: Float32Array
  readonly maxHp: Float32Array
  readonly x: Float32Array
  readonly y: Float32Array
  readonly dir: Uint8Array
  readonly target: Int32Array
  readonly nextSwing: Float64Array
  readonly hitAt: Float64Array
  readonly hitCrit: Uint8Array
  active: number
}

export type Rooms = {
  readonly alive: Uint8Array
  readonly clearedAt: Float64Array
  readonly refillAt: Float64Array
  readonly holdUntil: Float64Array
  readonly holdX: Float32Array
  readonly holdY: Float32Array
  readonly packs: Uint16Array
  count: number
  guild: number
  tier: number
}

export type DamageNumbers = {
  readonly x: Float32Array
  readonly y: Float32Array
  readonly value: Float32Array
  readonly style: Uint8Array
  readonly at: Float64Array
  head: number
}

export type CombatCounters = {
  swings: number
  crits: number
  strikes: number
  cleared: number
  skipped: number
}

export type Combat = {
  readonly calls: Float64Array
  readonly head: Uint8Array
  readonly bonus: Uint8Array
  readonly strikes: Uint8Array
  readonly hp: Float32Array
  readonly nextSwing: Float64Array
  readonly swingAt: Float64Array
  readonly swingCrit: Uint8Array
  readonly strikeAt: Float64Array
  readonly target: Int32Array
  readonly fighters: DenseSet
  readonly glowOf: Int32Array
  readonly glowing: DenseSet
  readonly monsters: Monsters
  readonly rooms: Rooms
  readonly damage: DamageNumbers
  readonly counters: CombatCounters
}

export const NO_TARGET = -1
export const NO_ROOM = -1
export const NO_EFFECT = -1
export const MONSTER_FREE = 0
export const MONSTER_RISING = 1
export const MONSTER_IDLE = 2
export const MONSTER_ATTACK = 3
export const MONSTER_CRUMBLE = 4
export const DAMAGE_HIT = 0
export const DAMAGE_CRIT = 1
export const DAMAGE_WISP = 2

export const combatConfig = (tuning: CombatTuning, sheets: readonly string[]): CombatConfig => ({
  ...tuning,
  rangedSheet: new Uint8Array(sheets.map((sheet) => (tuning.rangedSheets.includes(sheet) ? 1 : 0))),
})

export const createCombat = (
  config: CombatConfig,
  entities: number,
  size: number,
  numbers: number,
): Combat => ({
  calls: new Float64Array(entities * config.ring).fill(Number.NEGATIVE_INFINITY),
  head: new Uint8Array(entities),
  bonus: new Uint8Array(entities),
  strikes: new Uint8Array(entities),
  hp: new Float32Array(entities).fill(1),
  nextSwing: new Float64Array(entities),
  swingAt: new Float64Array(entities).fill(Number.NEGATIVE_INFINITY),
  swingCrit: new Uint8Array(entities),
  strikeAt: new Float64Array(entities).fill(Number.NEGATIVE_INFINITY),
  target: new Int32Array(entities).fill(NO_TARGET),
  fighters: createDenseSet(entities),
  glowOf: new Int32Array(entities).fill(NO_EFFECT),
  glowing: createDenseSet(entities),
  monsters: {
    kind: new Uint8Array(size),
    room: new Int16Array(size).fill(NO_ROOM),
    state: new Uint8Array(size),
    since: new Float64Array(size),
    hp: new Float32Array(size),
    maxHp: new Float32Array(size),
    x: new Float32Array(size),
    y: new Float32Array(size),
    dir: new Uint8Array(size),
    target: new Int32Array(size).fill(NO_TARGET),
    nextSwing: new Float64Array(size),
    hitAt: new Float64Array(size).fill(Number.NEGATIVE_INFINITY),
    hitCrit: new Uint8Array(size),
    active: 0,
  },
  rooms: {
    alive: new Uint8Array(config.maxRooms),
    clearedAt: new Float64Array(config.maxRooms),
    refillAt: new Float64Array(config.maxRooms),
    holdUntil: new Float64Array(config.maxRooms),
    holdX: new Float32Array(config.maxRooms),
    holdY: new Float32Array(config.maxRooms),
    packs: new Uint16Array(config.maxRooms),
    count: 0,
    guild: NO_ROOM,
    tier: NO_ROOM,
  },
  damage: {
    x: new Float32Array(numbers),
    y: new Float32Array(numbers),
    value: new Float32Array(numbers),
    style: new Uint8Array(numbers),
    at: new Float64Array(numbers).fill(Number.NEGATIVE_INFINITY),
    head: 0,
  },
  counters: { swings: 0, crits: 0, strikes: 0, cleared: 0, skipped: 0 },
})

export const noteDamage = (
  sim: Sim,
  x: number,
  y: number,
  value: number,
  style: number,
  at: number,
): void => {
  const { damage } = sim.combat
  const head = damage.head
  damage.x[head] = x
  damage.y[head] = y
  damage.value[head] = value
  damage.style[head] = style
  damage.at[head] = at
  damage.head = (head + 1) % damage.at.length
}

export const toolCount = (sim: Sim, eid: number, now: number): number => {
  const { ring, windowMs } = sim.config.combat
  const { calls } = sim.combat
  const base = eid * ring
  let count = 0

  for (let i = 0; i < ring; i++) {
    if (now - calls[base + i]! < windowMs) {
      count += 1
    }
  }

  return count
}

export const tierOf = (tiers: readonly CombatTier[], count: number): number => {
  let tier = 0

  for (const [index, entry] of tiers.entries()) {
    if (count >= entry.from) {
      tier = index
    }
  }

  return tier
}

export const intensityTier = (sim: Sim, eid: number, now: number): number =>
  tierOf(sim.config.combat.tiers, toolCount(sim, eid, now))

export const noteTools = (
  sim: Sim,
  eid: number,
  calls: number,
  minion: boolean,
  now: number,
): void => {
  const { combat } = sim
  const tuning = sim.config.combat

  if (minion) {
    combat.strikes[eid] = Math.min(tuning.minionStrikes, combat.strikes[eid]! + calls)

    return
  }

  const base = eid * tuning.ring
  let head = combat.head[eid]!

  for (let i = 0; i < Math.min(calls, tuning.ring); i++) {
    combat.calls[base + head] = now
    head = (head + 1) % tuning.ring
  }

  combat.head[eid] = head
  combat.bonus[eid] = Math.min(tuning.bonusSwings, combat.bonus[eid]! + calls)
}

export const engaged = (sim: Sim, eid: number): boolean => {
  const room = sim.stores.delve.room[eid]!
  const { rooms } = sim.combat

  return hasMember(sim.combat.fighters, eid) && room < rooms.count && rooms.alive[room]! > 0
}

export const joinFight = (sim: Sim, eid: number): void => {
  const { combat } = sim

  if (hasMember(combat.fighters, eid)) {
    return
  }

  addMember(combat.fighters, eid)
  combat.hp[eid] = 1
  combat.target[eid] = NO_TARGET
  combat.nextSwing[eid] = 0
}

export const forgetCombat = (sim: Sim, eid: number): void => {
  const { combat } = sim
  const { ring } = sim.config.combat
  combat.calls.fill(Number.NEGATIVE_INFINITY, eid * ring, eid * ring + ring)
  combat.bonus[eid] = 0
  combat.strikes[eid] = 0
  combat.hp[eid] = 1
  combat.target[eid] = NO_TARGET
  combat.swingAt[eid] = Number.NEGATIVE_INFINITY
  combat.strikeAt[eid] = Number.NEGATIVE_INFINITY
  removeMember(combat.fighters, eid)
}
