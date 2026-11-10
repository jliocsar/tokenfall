import { addMember, hasMember } from './dense-set.ts'
import { walkable, type DungeonMap } from './dungeon-gen.ts'
import {
  cellAt,
  cellWorld,
  dungeonAt,
  dungeonWanderSpot,
  heroTier,
  LIMBO,
  partyRoom,
  putHero,
  roomCenter,
  noteFighter,
  slotOf,
  spotInRoom,
} from './dungeon.ts'
import { engaged } from './monsters.ts'
import type { Sim } from './sim.ts'

const WALK_ROUTE = 1
const WALK_FINAL = 2
const UNREACHED = -1

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const

export const STAIRS_GOAL = -2

const passable = (map: DungeonMap, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < map.width && y < map.height && walkable(map.cells[y * map.width + x]!)

const canStep = (map: DungeonMap, x: number, y: number, dx: number, dy: number): boolean =>
  passable(map, x + dx, y + dy) &&
  (dx === 0 || dy === 0 || (passable(map, x + dx, y) && passable(map, x, y + dy)))

const buildField = (map: DungeonMap, target: number): Int16Array => {
  const field = new Int16Array(map.cells.length).fill(UNREACHED)
  const queue = new Int32Array(map.cells.length)
  let head = 0
  let tail = 1
  queue[0] = target
  field[target] = 0

  while (head < tail) {
    const cell = queue[head]!
    head += 1
    const x = cell % map.width
    const y = Math.floor(cell / map.width)

    for (const [dx, dy] of NEIGHBORS) {
      const next = (y + dy) * map.width + x + dx

      if (canStep(map, x, y, dx, dy) && field[next] === UNREACHED) {
        field[next] = field[cell]! + 1
        queue[tail] = next
        tail += 1
      }
    }
  }

  return field
}

const fieldTo = (sim: Sim, guild: number, map: DungeonMap, goal: number): Int16Array => {
  const slot = slotOf(sim, guild, map.tier)
  const fields = (sim.dungeons.fields[slot] ??= Array.from<Int16Array | undefined>({
    length: map.rooms + 1,
  }))
  const index = goal === STAIRS_GOAL ? map.rooms : goal

  return (fields[index] ??= buildField(
    map,
    goal === STAIRS_GOAL ? map.down : roomCenter(map, goal),
  ))
}

export const walkTo = (sim: Sim, eid: number, x: number, y: number): void => {
  const { motion } = sim.stores
  motion.tx[eid] = x
  motion.ty[eid] = y
  motion.speed[eid] = sim.config.tuning.walkSpeed
  addMember(sim.moving, eid)
}

const nextStep = (
  sim: Sim,
  eid: number,
  map: DungeonMap,
  field: Int16Array,
  from: number,
): boolean => {
  const x = from % map.width
  const y = Math.floor(from / map.width)
  let best = from

  for (const [dx, dy] of NEIGHBORS) {
    const next = (y + dy) * map.width + x + dx
    const closer = field[next]! >= 0 && field[next]! < field[best]!

    if (canStep(map, x, y, dx, dy) && closer) {
      best = next
    }
  }

  if (best === from) {
    return false
  }

  cellWorld(sim, map, sim.stores.hero.guild[eid]!, best, sim.scratch)
  walkTo(sim, eid, sim.scratch[0]!, sim.scratch[1]!)

  return true
}

const finishLeg = (sim: Sim, eid: number, map: DungeonMap, goal: number): void => {
  cellWorld(sim, map, sim.stores.hero.guild[eid]!, spotInRoom(sim, map, goal), sim.scratch)
  sim.stores.delve.walking[eid] = WALK_FINAL
  walkTo(sim, eid, sim.scratch[0]!, sim.scratch[1]!)
}

const descend = (sim: Sim, eid: number): void => {
  const { delve, hero } = sim.stores
  const guild = hero.guild[eid]!
  const tier = delve.tier[eid]! + 1
  const map = dungeonAt(sim, guild, tier)
  delve.tier[eid] = tier
  delve.walking[eid] = 0

  if (map === undefined) {
    delve.placed[eid] = 0
    putHero(sim, eid, LIMBO, LIMBO)

    return
  }

  cellWorld(sim, map, guild, map.up >= 0 ? map.up : map.arrival, sim.scratch)
  putHero(sim, eid, sim.scratch[0]!, sim.scratch[1]!)
  const room = partyRoom(sim, guild, tier, hero.party[eid]!)
  delve.room[eid] = room
  startWalk(sim, eid, room)
  noteFighter(sim, eid)

  if (heroTier(sim, eid) > tier) {
    addMember(sim.tierCheck, eid)
  }
}

const routeOn = (sim: Sim, eid: number, map: DungeonMap): boolean => {
  const { delve, hero, position } = sim.stores
  const guild = hero.guild[eid]!
  const from = cellAt(sim, map, guild, position.x[eid]!, position.y[eid]!)
  const goal = delve.goal[eid]!

  if (from < 0) {
    return false
  }

  if (goal === STAIRS_GOAL && from === map.down) {
    descend(sim, eid)

    return hasMember(sim.moving, eid)
  }

  if (goal !== STAIRS_GOAL && map.roomOf[from] === goal) {
    finishLeg(sim, eid, map, goal)

    return true
  }

  return nextStep(sim, eid, map, fieldTo(sim, guild, map, goal), from)
}

export const advanceWalk = (sim: Sim, eid: number): boolean => {
  const { delve } = sim.stores
  const walking = delve.walking[eid]!

  if (walking !== WALK_ROUTE) {
    delve.walking[eid] = 0

    return false
  }

  const map = dungeonAt(sim, sim.stores.hero.guild[eid]!, delve.tier[eid]!)

  if (map === undefined || !routeOn(sim, eid, map)) {
    delve.walking[eid] = 0

    return false
  }

  return true
}

export const roomDistance = (
  sim: Sim,
  guild: number,
  map: DungeonMap,
  from: number,
  to: number,
): number => fieldTo(sim, guild, map, from)[roomCenter(map, to)]!

export const startWalk = (sim: Sim, eid: number, goal: number): void => {
  sim.stores.delve.goal[eid] = goal
  sim.stores.delve.walking[eid] = WALK_ROUTE
  advanceWalk(sim, eid)
}

const nearbyRoom = (sim: Sim, map: DungeonMap, guild: number, home: number): number => {
  const field = fieldTo(sim, guild, map, home)
  const rooms = Array.from({ length: map.rooms }, (_room, room) => room)
    .filter((room) => room !== home && field[roomCenter(map, room)]! > 0)
    .toSorted((a, b) => field[roomCenter(map, a)]! - field[roomCenter(map, b)]!)
    .slice(0, sim.config.dungeon.roamRooms)

  return rooms.length === 0 ? home : rooms[Math.floor(sim.random() * rooms.length)]!
}

export const enterDungeonAt = (sim: Sim, eid: number): void => {
  const { delve, hero } = sim.stores
  const tier = heroTier(sim, eid)
  const guild = hero.guild[eid]!
  const map = dungeonAt(sim, guild, tier)
  delve.tier[eid] = tier
  delve.inside[eid] = 1
  delve.walking[eid] = 0

  if (map === undefined) {
    delve.placed[eid] = 0
    putHero(sim, eid, LIMBO, LIMBO)

    return
  }

  cellWorld(sim, map, guild, map.arrival, sim.scratch)
  putHero(sim, eid, sim.scratch[0]!, sim.scratch[1]!)
  delve.placed[eid] = 1
  const room = partyRoom(sim, guild, tier, hero.party[eid]!)
  delve.room[eid] = room
  startWalk(sim, eid, room)
  noteFighter(sim, eid)
}

export const toolStep = (sim: Sim, eid: number): void => {
  const { delve, hero, position } = sim.stores
  const idle = delve.walking[eid] === 0 && !hasMember(sim.moving, eid)
  const guild = hero.guild[eid]!
  const map = dungeonAt(sim, guild, delve.tier[eid]!)

  if (delve.placed[eid] !== 1 || !idle || map === undefined || engaged(sim, eid)) {
    return
  }

  const home = delve.room[eid]!
  const roam = sim.random() < sim.config.dungeon.roamChance
  const goal = roam ? nearbyRoom(sim, map, guild, home) : home
  const from = cellAt(sim, map, guild, position.x[eid]!, position.y[eid]!)

  if (from >= 0 && map.roomOf[from] === goal) {
    if (dungeonWanderSpot(sim, eid, sim.scratch)) {
      walkTo(sim, eid, sim.scratch[0]!, sim.scratch[1]!)
    }

    return
  }

  startWalk(sim, eid, goal)
}

export const checkTier = (sim: Sim, eid: number): void => {
  const { delve } = sim.stores
  const wanted = heroTier(sim, eid)

  if (delve.inside[eid] !== 1 || wanted <= delve.tier[eid]!) {
    return
  }

  if (delve.placed[eid] !== 1) {
    delve.tier[eid] = wanted

    return
  }

  const map = dungeonAt(sim, sim.stores.hero.guild[eid]!, delve.tier[eid]!)

  if (map !== undefined && map.down >= 0) {
    startWalk(sim, eid, STAIRS_GOAL)
  }
}
