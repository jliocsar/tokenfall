import Cellular from 'rot-js/lib/map/cellular.js'
import Digger from 'rot-js/lib/map/digger.js'
import Uniform from 'rot-js/lib/map/uniform.js'
import RNG from 'rot-js/lib/rng.js'
import { mulberry32, type Random } from './random.ts'

export type TierPlan = {
  readonly name: string
  readonly generator: string
  readonly width: number
  readonly height: number
  readonly roomWidth: readonly number[]
  readonly roomHeight: readonly number[]
  readonly corridorLength: readonly number[]
  readonly dug: number
  readonly fill: number
  readonly generations: number
  readonly halls: number
  readonly hallSpacing: number
  readonly lava: number
}

export type DungeonMap = {
  readonly tier: number
  readonly width: number
  readonly height: number
  readonly cells: Uint8Array
  readonly roomOf: Int16Array
  readonly rooms: number
  readonly roomX: Uint16Array
  readonly roomY: Uint16Array
  readonly arrival: number
  readonly up: number
  readonly down: number
}

type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

type Carved = { readonly open: Uint8Array; readonly rects: readonly Rect[] }

type Carver = (plan: TierPlan, timeLimit: number) => Carved

type Rooms = {
  readonly roomOf: Int16Array
  readonly roomX: Uint16Array
  readonly roomY: Uint16Array
  readonly count: number
}

const NO_ROOM = -1
const NO_CELL = -1
const UNREACHED = -1
const LAVA_POOL_RADIUS = [1, 2.6] as const
const LAVA_KEEP_CLEAR = 2
const LAVA_TRIES_PER_POOL = 3

export const CELL = {
  rock: 0,
  floor: 1,
  wall: 2,
  door: 3,
  up: 4,
  down: 5,
  lava: 6,
} as const

const span = (range: readonly number[]): [number, number] => [range[0]!, range[1]!]

const rectOf = (room: {
  getLeft: () => number
  getTop: () => number
  getRight: () => number
  getBottom: () => number
}): Rect => ({
  x: room.getLeft(),
  y: room.getTop(),
  w: room.getRight() - room.getLeft() + 1,
  h: room.getBottom() - room.getTop() + 1,
})

const carveDigger: Carver = (plan, timeLimit) => {
  const open = new Uint8Array(plan.width * plan.height)
  const digger = new Digger(plan.width, plan.height, {
    roomWidth: span(plan.roomWidth),
    roomHeight: span(plan.roomHeight),
    corridorLength: span(plan.corridorLength),
    dugPercentage: plan.dug,
    timeLimit,
  })
  digger.create((x, y, value) => {
    open[y * plan.width + x] = value === 0 ? 1 : 0
  })

  return { open, rects: digger.getRooms().map(rectOf) }
}

const carveUniform: Carver = (plan, timeLimit) => {
  const open = new Uint8Array(plan.width * plan.height)
  const uniform = new Uniform(plan.width, plan.height, {
    roomWidth: span(plan.roomWidth),
    roomHeight: span(plan.roomHeight),
    roomDugPercentage: plan.dug,
    timeLimit,
  })
  const made = uniform.create((x, y, value) => {
    open[y * plan.width + x] = value === 0 ? 1 : 0
  })

  if (made === null) {
    throw new Error(`the ${plan.name} generator ran out of time`)
  }

  return { open, rects: uniform.getRooms().map(rectOf) }
}

const closeBorder = (cave: Cellular, width: number, height: number): void => {
  for (let x = 0; x < width; x++) {
    cave.set(x, 0, 1)
    cave.set(x, height - 1, 1)
  }

  for (let y = 0; y < height; y++) {
    cave.set(0, y, 1)
    cave.set(width - 1, y, 1)
  }
}

const carveCellular: Carver = (plan) => {
  const open = new Uint8Array(plan.width * plan.height)
  const cave = new Cellular(plan.width, plan.height)
  cave.randomize(plan.fill)

  for (let i = 0; i < plan.generations; i++) {
    cave.create()
  }

  closeBorder(cave, plan.width, plan.height)
  cave.connect((x, y, value) => {
    open[y * plan.width + x] = value === 0 ? 1 : 0
  }, 0)

  return { open, rects: [] }
}

const CARVERS: ReadonlyMap<string, Carver> = new Map([
  ['digger', carveDigger],
  ['uniform', carveUniform],
  ['cellular', carveCellular],
])

const distancesFrom = (
  open: Uint8Array,
  width: number,
  sources: readonly number[],
  out: Int32Array,
  queue: Int32Array,
): void => {
  out.fill(UNREACHED)
  let head = 0
  let tail = 0

  for (const source of sources) {
    out[source] = 0
    queue[tail] = source
    tail += 1
  }

  while (head < tail) {
    const cell = queue[head]!
    head += 1
    const x = cell % width
    const neighbors = [
      x > 0 ? cell - 1 : NO_CELL,
      x < width - 1 ? cell + 1 : NO_CELL,
      cell - width,
      cell + width,
    ]

    for (const next of neighbors) {
      if (next >= 0 && next < open.length && open[next] === 1 && out[next] === UNREACHED) {
        out[next] = out[cell]! + 1
        queue[tail] = next
        tail += 1
      }
    }
  }
}

const openCells = (open: Uint8Array): number[] => {
  const cells: number[] = []

  for (let cell = 0; cell < open.length; cell++) {
    if (open[cell] === 1) {
      cells.push(cell)
    }
  }

  return cells
}

const farthestOpen = (distance: Int32Array, open: Uint8Array): number => {
  let best = NO_CELL

  for (let cell = 0; cell < open.length; cell++) {
    if (open[cell] === 1 && (best === NO_CELL || distance[cell]! > distance[best]!)) {
      best = cell
    }
  }

  return best
}

const roomsFromRects = (rects: readonly Rect[], width: number, size: number): Rooms => {
  const roomOf = new Int16Array(size).fill(NO_ROOM)
  const roomX = new Uint16Array(rects.length)
  const roomY = new Uint16Array(rects.length)

  for (const [room, rect] of rects.entries()) {
    roomX[room] = rect.x + Math.floor(rect.w / 2)
    roomY[room] = rect.y + Math.floor(rect.h / 2)

    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        roomOf[y * width + x] = room
      }
    }
  }

  return { roomOf, roomX, roomY, count: rects.length }
}

const pickHalls = (plan: TierPlan, open: Uint8Array, random: Random): number[] => {
  const cells = openCells(open)
  const distance = new Int32Array(open.length)
  const queue = new Int32Array(open.length)
  const halls = [cells[Math.floor(random() * cells.length)]!]

  while (halls.length < plan.halls) {
    distancesFrom(open, plan.width, halls, distance, queue)
    const next = farthestOpen(distance, open)

    if (next === NO_CELL || distance[next]! < plan.hallSpacing) {
      break
    }

    halls.push(next)
  }

  return halls
}

const nearestHall = (
  open: Uint8Array,
  width: number,
  halls: readonly number[],
  roomOf: Int16Array,
): void => {
  const owner = roomOf
  const queue = new Int32Array(open.length)
  let head = 0
  let tail = 0

  for (const [room, cell] of halls.entries()) {
    owner[cell] = room
    queue[tail] = cell
    tail += 1
  }

  while (head < tail) {
    const cell = queue[head]!
    head += 1
    const x = cell % width

    for (const next of [
      x > 0 ? cell - 1 : NO_CELL,
      x < width - 1 ? cell + 1 : NO_CELL,
      cell - width,
      cell + width,
    ]) {
      if (next >= 0 && next < open.length && open[next] === 1 && owner[next] === NO_ROOM) {
        owner[next] = owner[cell]!
        queue[tail] = next
        tail += 1
      }
    }
  }
}

const roomsFromHalls = (plan: TierPlan, open: Uint8Array, random: Random): Rooms => {
  const halls = pickHalls(plan, open, random)
  const roomOf = new Int16Array(open.length).fill(NO_ROOM)
  nearestHall(open, plan.width, halls, roomOf)

  return {
    roomOf,
    roomX: Uint16Array.from(halls, (cell) => cell % plan.width),
    roomY: Uint16Array.from(halls, (cell) => Math.floor(cell / plan.width)),
    count: halls.length,
  }
}

const isOpenNeighbor = (open: Uint8Array, width: number, height: number, cell: number): boolean => {
  const x = cell % width
  const y = Math.floor(cell / width)

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx
      const ny = y + dy

      if (nx >= 0 && ny >= 0 && nx < width && ny < height && open[ny * width + nx]! > 0) {
        return true
      }
    }
  }

  return false
}

const roomCell = (rooms: Rooms, width: number, room: number): number =>
  rooms.roomY[room]! * width + rooms.roomX[room]!

const reachesAll = (
  open: Uint8Array,
  width: number,
  from: number,
  targets: readonly number[],
  scratch: Int32Array,
  queue: Int32Array,
): boolean => {
  distancesFrom(open, width, [from], scratch, queue)

  return targets.every((target) => scratch[target] !== UNREACHED)
}

const poolCells = (
  plan: TierPlan,
  open: Uint8Array,
  random: Random,
  keep: Uint8Array,
): number[] => {
  const cells = openCells(open)
  const center = cells[Math.floor(random() * cells.length)]!
  const radius = LAVA_POOL_RADIUS[0] + random() * (LAVA_POOL_RADIUS[1] - LAVA_POOL_RADIUS[0])
  const cx = center % plan.width
  const cy = Math.floor(center / plan.width)
  const pool: number[] = []

  for (let y = Math.floor(cy - radius); y <= cy + radius; y++) {
    for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
      const cell = y * plan.width + x
      const inside = x >= 0 && y >= 0 && x < plan.width && y < plan.height

      if (inside && open[cell] === 1 && keep[cell] === 0 && Math.hypot(x - cx, y - cy) <= radius) {
        pool.push(cell)
      }
    }
  }

  return pool
}

const keepClear = (plan: TierPlan, targets: readonly number[]): Uint8Array => {
  const keep = new Uint8Array(plan.width * plan.height)

  for (const target of targets) {
    const tx = target % plan.width
    const ty = Math.floor(target / plan.width)

    for (let y = ty - LAVA_KEEP_CLEAR; y <= ty + LAVA_KEEP_CLEAR; y++) {
      for (let x = tx - LAVA_KEEP_CLEAR; x <= tx + LAVA_KEEP_CLEAR; x++) {
        if (x >= 0 && y >= 0 && x < plan.width && y < plan.height) {
          keep[y * plan.width + x] = 1
        }
      }
    }
  }

  return keep
}

const pourLava = (
  plan: TierPlan,
  open: Uint8Array,
  lava: Uint8Array,
  targets: readonly number[],
  random: Random,
): void => {
  const goal = Math.floor(openCells(open).length * plan.lava)
  const keep = keepClear(plan, targets)
  const scratch = new Int32Array(open.length)
  const queue = new Int32Array(open.length)
  let poured = 0
  let tries = Math.ceil(goal / 4) * LAVA_TRIES_PER_POOL

  while (poured < goal && tries > 0) {
    tries -= 1
    const pool = poolCells(plan, open, random, keep)

    for (const cell of pool) {
      open[cell] = 0
    }

    if (reachesAll(open, plan.width, targets[0]!, targets, scratch, queue)) {
      for (const cell of pool) {
        lava[cell] = 1
      }

      poured += pool.length
    } else {
      for (const cell of pool) {
        open[cell] = 1
      }
    }
  }
}

const farthestRooms = (
  rooms: Rooms,
  width: number,
  open: Uint8Array,
  arrivalRoom: number,
): readonly [number, number] => {
  const distance = new Int32Array(open.length)
  distancesFrom(
    open,
    width,
    [roomCell(rooms, width, arrivalRoom)],
    distance,
    new Int32Array(open.length),
  )
  const order = Array.from({ length: rooms.count }, (_room, room) => room)
    .filter((room) => room !== arrivalRoom)
    .toSorted((a, b) => distance[roomCell(rooms, width, b)]! - distance[roomCell(rooms, width, a)]!)

  return [order[0] ?? arrivalRoom, order[Math.floor(order.length / 2)] ?? arrivalRoom]
}

const paintCells = (
  plan: TierPlan,
  open: Uint8Array,
  lava: Uint8Array,
  doors: readonly number[],
): Uint8Array => {
  const cells = new Uint8Array(open.length)
  const solid = Uint8Array.from(open, (value, cell) => value | lava[cell]!)

  for (let cell = 0; cell < open.length; cell++) {
    if (open[cell] === 1) {
      cells[cell] = CELL.floor
    } else if (lava[cell] === 1) {
      cells[cell] = CELL.lava
    } else if (isOpenNeighbor(solid, plan.width, plan.height, cell)) {
      cells[cell] = CELL.wall
    }
  }

  for (const door of doors) {
    if (open[door] === 1) {
      cells[door] = CELL.door
    }
  }

  return cells
}

const doorCells = (rects: readonly Rect[], open: Uint8Array, width: number): number[] => {
  const doors: number[] = []

  for (const rect of rects) {
    for (let x = rect.x - 1; x <= rect.x + rect.w; x++) {
      for (const y of [rect.y - 1, rect.y + rect.h]) {
        doors.push(y * width + x)
      }
    }

    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (const x of [rect.x - 1, rect.x + rect.w]) {
        doors.push(y * width + x)
      }
    }
  }

  return doors.filter((cell) => cell >= 0 && cell < open.length && open[cell] === 1)
}

export const dungeonSeed = (townSeed: number, guildKey: string, tier: number): number => {
  let hash = (2_166_136_261 ^ townSeed) >>> 0
  const key = `${guildKey}#${tier}`

  for (let i = 0; i < key.length; i++) {
    hash = Math.imul(hash ^ key.charCodeAt(i), 16_777_619)
  }

  return hash >>> 0 || 1
}

export const generateDungeon = (
  plan: TierPlan,
  tier: number,
  tierCount: number,
  seed: number,
  timeLimit: number,
): DungeonMap => {
  const carve = CARVERS.get(plan.generator)

  if (carve === undefined) {
    throw new Error(`dungeon.json names a generator that doesn't exist: "${plan.generator}"`)
  }

  RNG.setSeed(seed)
  const random = mulberry32(seed)
  const { open, rects } = carve(plan, timeLimit)
  const rooms =
    rects.length > 0
      ? roomsFromRects(rects, plan.width, open.length)
      : roomsFromHalls(plan, open, random)
  const arrivalRoom = 0
  const [downRoom, upRoom] = farthestRooms(rooms, plan.width, open, arrivalRoom)
  const arrival = roomCell(rooms, plan.width, arrivalRoom)
  const down = roomCell(rooms, plan.width, downRoom)
  const up = roomCell(rooms, plan.width, upRoom)
  const lava = new Uint8Array(open.length)
  const centers = Array.from({ length: rooms.count }, (_room, room) =>
    roomCell(rooms, plan.width, room),
  )

  if (plan.lava > 0) {
    pourLava(plan, open, lava, [arrival, down, up, ...centers], random)
  }

  const cells = paintCells(plan, open, lava, doorCells(rects, open, plan.width))
  const hasDown = tier < tierCount - 1 && down !== arrival
  const hasUp = tier > 0 && up !== down && up !== arrival

  if (hasDown) {
    cells[down] = CELL.down
  }

  if (hasUp) {
    cells[up] = CELL.up
  }

  return {
    tier,
    width: plan.width,
    height: plan.height,
    cells,
    roomOf: rooms.roomOf,
    rooms: rooms.count,
    roomX: rooms.roomX,
    roomY: rooms.roomY,
    arrival,
    up: hasUp ? up : NO_CELL,
    down: hasDown ? down : NO_CELL,
  }
}

export const walkable = (cell: number): boolean =>
  cell === CELL.floor || cell === CELL.door || cell === CELL.up || cell === CELL.down
