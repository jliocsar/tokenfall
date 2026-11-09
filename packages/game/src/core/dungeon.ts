import { removeMember } from './dense-set.ts'
import {
  CELL,
  dungeonSeed,
  generateDungeon,
  walkable,
  type DungeonMap,
  type TierPlan,
} from './dungeon-gen.ts'
import { NONE } from './hero-index.ts'
import { hashString } from './random.ts'
import type { Sim } from './sim.ts'

export type DepthTier = { readonly name: string; readonly fromLevel: number }

export type DungeonTuning = {
  readonly originX: number
  readonly originY: number
  readonly stride: number
  readonly timeLimitMs: number
  readonly cellSize: number
  readonly placeRadius: number
  readonly wanderTries: number
  readonly tiers: readonly TierPlan[]
}

export type Dungeons = {
  readonly maps: (DungeonMap | undefined)[]
  readonly claims: (Int32Array | undefined)[]
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

const LIMBO = -50_000
const UNCLAIMED = -1
const CELL_CENTER = 0.5

export const createDungeons = (guilds: number, tiers: number): Dungeons => ({
  maps: Array.from<DungeonMap | undefined>({ length: guilds * tiers }),
  claims: Array.from<Int32Array | undefined>({ length: guilds * tiers }),
})

export const depthTierOf = (level: number, tiers: readonly DepthTier[]): number => {
  let tier = 0

  for (const [index, depth] of tiers.entries()) {
    if (level >= depth.fromLevel) {
      tier = index
    }
  }

  return tier
}

export const tierCount = (sim: Sim): number => sim.config.dungeon.tiers.length

export const heroTier = (sim: Sim, eid: number): number =>
  depthTierOf(sim.stores.hero.level[eid]!, sim.config.depthTiers)

export const tierInside = (sim: Sim, eid: number): number =>
  sim.stores.delve.inside[eid] === 1 ? sim.stores.delve.tier[eid]! : heroTier(sim, eid)

const slotOf = (sim: Sim, guild: number, tier: number): number => guild * tierCount(sim) + tier

export const dungeonAt = (sim: Sim, guild: number, tier: number): DungeonMap | undefined =>
  sim.dungeons.maps[slotOf(sim, guild, tier)]

export const ensureDungeon = (sim: Sim, guild: number, tier: number): DungeonMap => {
  const slot = slotOf(sim, guild, tier)
  const known = sim.dungeons.maps[slot]

  if (known !== undefined) {
    return known
  }

  const { dungeon } = sim.config
  const map = generateDungeon(
    dungeon.tiers[tier]!,
    tier,
    dungeon.tiers.length,
    dungeonSeed(sim.config.seed, sim.groups.guildKeys[guild] ?? '', tier),
    dungeon.timeLimitMs,
  )
  sim.dungeons.maps[slot] = map
  sim.dungeons.claims[slot] = new Int32Array(map.rooms).fill(UNCLAIMED)

  return map
}

export const originX = (sim: Sim, guild: number): number =>
  sim.config.dungeon.originX + guild * sim.config.dungeon.stride

export const originY = (sim: Sim, tier: number): number =>
  sim.config.dungeon.originY + tier * sim.config.dungeon.stride

export const cellX = (map: DungeonMap, cell: number): number => cell % map.width

export const cellY = (map: DungeonMap, cell: number): number => Math.floor(cell / map.width)

export const cellAt = (sim: Sim, map: DungeonMap, guild: number, x: number, y: number): number => {
  const size = sim.config.dungeon.cellSize
  const cx = Math.floor((x - originX(sim, guild)) / size)
  const cy = Math.floor((y - originY(sim, map.tier)) / size)

  if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) {
    return -1
  }

  return cy * map.width + cx
}

export const cellWorld = (
  sim: Sim,
  map: DungeonMap,
  guild: number,
  cell: number,
  out: Float64Array,
): void => {
  const size = sim.config.dungeon.cellSize
  out[0] = originX(sim, guild) + (cellX(map, cell) + CELL_CENTER) * size
  out[1] = originY(sim, map.tier) + (cellY(map, cell) + CELL_CENTER) * size
}

export const dungeonBounds = (sim: Sim, guild: number, tier: number): Bounds => {
  const plan = sim.config.dungeon.tiers[tier]!

  return {
    minX: originX(sim, guild),
    minY: originY(sim, tier),
    maxX: originX(sim, guild) + plan.width * sim.config.dungeon.cellSize,
    maxY: originY(sim, tier) + plan.height * sim.config.dungeon.cellSize,
  }
}

export const partyRoom = (sim: Sim, guild: number, tier: number, party: number): number => {
  const claims = sim.dungeons.claims[slotOf(sim, guild, tier)]!
  const held = claims.indexOf(party)

  if (held >= 0) {
    return held
  }

  const start = hashString(sim.groups.partyWorkspace[party] ?? '') % claims.length

  for (let step = 0; step < claims.length; step++) {
    const room = (start + step) % claims.length

    if (claims[room] === UNCLAIMED) {
      claims[room] = party

      return room
    }
  }

  return start
}

const roomCenter = (map: DungeonMap, room: number): number =>
  map.roomY[room]! * map.width + map.roomX[room]!

const spotInRoom = (sim: Sim, map: DungeonMap, room: number): number => {
  const radius = sim.config.dungeon.placeRadius
  const center = roomCenter(map, room)

  for (let attempt = 0; attempt < sim.config.dungeon.wanderTries; attempt++) {
    const x = Math.round(map.roomX[room]! + (sim.random() * 2 - 1) * radius)
    const y = Math.round(map.roomY[room]! + (sim.random() * 2 - 1) * radius)
    const cell = y * map.width + x
    const inside = x >= 0 && y >= 0 && x < map.width && y < map.height

    if (inside && map.roomOf[cell] === room && walkable(map.cells[cell]!)) {
      return cell
    }
  }

  return center
}

const putAt = (sim: Sim, eid: number, x: number, y: number): void => {
  sim.stores.position.x[eid] = x
  sim.stores.position.y[eid] = y
  sim.stores.anchor.x[eid] = x
  sim.stores.anchor.y[eid] = y
  removeMember(sim.moving, eid)
}

export const placeInDungeon = (sim: Sim, eid: number, map: DungeonMap): void => {
  const guild = sim.stores.hero.guild[eid]!
  const room = partyRoom(sim, guild, map.tier, sim.stores.hero.party[eid]!)
  cellWorld(sim, map, guild, spotInRoom(sim, map, room), sim.scratch)
  sim.stores.delve.room[eid] = room
  sim.stores.delve.placed[eid] = 1
  putAt(sim, eid, sim.scratch[0]!, sim.scratch[1]!)
}

export const enterDungeonAt = (sim: Sim, eid: number): void => {
  const tier = heroTier(sim, eid)
  const map = dungeonAt(sim, sim.stores.hero.guild[eid]!, tier)
  sim.stores.delve.tier[eid] = tier
  sim.stores.delve.inside[eid] = 1

  if (map === undefined) {
    sim.stores.delve.placed[eid] = 0
    putAt(sim, eid, LIMBO, LIMBO)

    return
  }

  placeInDungeon(sim, eid, map)
}

export const leaveDungeon = (sim: Sim, eid: number): void => {
  sim.stores.delve.placed[eid] = 0
  sim.stores.delve.inside[eid] = 0
}

export const settleTier = (sim: Sim, guild: number, tier: number): DungeonMap => {
  const map = ensureDungeon(sim, guild, tier)
  const { index } = sim
  const { hero, delve } = sim.stores

  for (let slot = 0; slot < index.nextSlot; slot++) {
    const eid = index.entityOf[slot]!
    const waiting = eid !== NONE && delve.inside[eid] === 1 && delve.placed[eid] === 0

    if (waiting && delve.tier[eid] === tier && hero.guild[eid] === guild) {
      placeInDungeon(sim, eid, map)
    }
  }

  return map
}

const clearLine = (map: DungeonMap, from: number, to: number): boolean => {
  let x = cellX(map, from)
  let y = cellY(map, from)
  const tx = cellX(map, to)
  const ty = cellY(map, to)
  const dx = Math.abs(tx - x)
  const dy = -Math.abs(ty - y)
  const sx = x < tx ? 1 : -1
  const sy = y < ty ? 1 : -1
  let error = dx + dy

  while (x !== tx || y !== ty) {
    if (!walkable(map.cells[y * map.width + x]!)) {
      return false
    }

    const twice = error * 2

    if (twice >= dy) {
      error += dy
      x += sx
    }

    if (twice <= dx) {
      error += dx
      y += sy
    }
  }

  return walkable(map.cells[ty * map.width + tx]!)
}

export const dungeonWanderSpot = (sim: Sim, eid: number, out: Float64Array): boolean => {
  const guild = sim.stores.hero.guild[eid]!
  const map = dungeonAt(sim, guild, sim.stores.delve.tier[eid]!)

  if (map === undefined) {
    return false
  }

  const from = cellAt(sim, map, guild, sim.stores.position.x[eid]!, sim.stores.position.y[eid]!)

  if (from < 0) {
    return false
  }

  for (let attempt = 0; attempt < sim.config.dungeon.wanderTries; attempt++) {
    const to = spotInRoom(sim, map, sim.stores.delve.room[eid]!)

    if (to !== from && clearLine(map, from, to)) {
      cellWorld(sim, map, guild, to, out)
      out[0] = out[0]! + (sim.random() - 0.5) * CELL_CENTER * sim.config.dungeon.cellSize
      out[1] = out[1]! + (sim.random() - 0.5) * CELL_CENTER * sim.config.dungeon.cellSize

      return true
    }
  }

  return false
}

export const stairsAt = (map: DungeonMap, cell: number): number => {
  if (cell >= 0 && map.cells[cell] === CELL.down) {
    return 1
  }

  return cell >= 0 && map.cells[cell] === CELL.up ? -1 : 0
}
