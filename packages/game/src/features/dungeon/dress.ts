import plan from '@tokenfall/data/dungeon.json'
import { CELL, walkable, type DungeonMap } from '../../core/dungeon-gen.ts'
import type { PropPlacement } from '../../render/heroes.ts'

export type DungeonLight = {
  readonly x: number
  readonly y: number
  readonly kind: 'fire' | 'lantern' | 'torch'
}

export type FloorTile = {
  readonly name: string
  readonly x: number
  readonly y: number
  readonly tint: number
}

export type Dressing = {
  readonly floors: readonly FloorTile[]
  readonly lava: readonly number[]
  readonly props: readonly PropPlacement[]
  readonly lights: readonly DungeonLight[]
}

type Look = (typeof plan.tiers)[number]

type Edges = {
  readonly along: Uint8Array
  readonly down: Uint8Array
}

type Place = {
  readonly map: DungeonMap
  readonly look: Look
  readonly left: number
  readonly top: number
  readonly props: PropPlacement[]
  readonly lights: DungeonLight[]
}

const SIZE = plan.cellSize
const BACK = 1
const LOW = 2
const ALONG_X = '_1_0'
const ALONG_Y = '_0_0'
const SALT = { floor: 11, wall: 23, torch: 37, prop: 41, pick: 53, lava: 67, rock: 79 } as const
const ARRIVAL_CLEAR = 2

const colorOf = (hex: string): number => Number.parseInt(hex.slice(1), 16)

const chance = (cell: number, salt: number): number => {
  let hash = Math.imul(cell + 1, 0x9e_37_79_b1) ^ Math.imul(salt, 0x85_eb_ca_6b)
  hash = Math.imul(hash ^ (hash >>> 15), 0x2c_1b_3c_6d)
  hash ^= hash >>> 13

  return (hash >>> 0) / 4_294_967_296
}

const pick = (names: readonly string[], cell: number, salt: number): string =>
  names[Math.floor(chance(cell, salt) * names.length)]!

const open = (map: DungeonMap, x: number, y: number): boolean => {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
    return false
  }

  const kind = map.cells[y * map.width + x]!

  return walkable(kind) || kind === CELL.lava
}

const place = (at: Place, name: string, cx: number, cy: number, tint: number): void => {
  at.props.push({ name, x: at.left + cx * SIZE, y: at.top + cy * SIZE, tint })
}

const findEdges = (map: DungeonMap): Edges => {
  const along = new Uint8Array((map.width + 1) * (map.height + 1))
  const down = new Uint8Array((map.width + 1) * (map.height + 1))
  const stride = map.width + 1

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (open(map, x, y)) {
        along[y * stride + x] = open(map, x, y - 1) ? along[y * stride + x]! : BACK
        down[y * stride + x] = open(map, x - 1, y) ? down[y * stride + x]! : BACK
        along[(y + 1) * stride + x] = open(map, x, y + 1) ? along[(y + 1) * stride + x]! : LOW
        down[y * stride + x + 1] = open(map, x + 1, y) ? down[y * stride + x + 1]! : LOW
      }
    }
  }

  return { along, down }
}

const wallName = (at: Place, kind: number, cell: number): string =>
  kind === BACK ? pick(at.look.walls, cell, SALT.wall) : 'd_wall_low'

const torchAt = (at: Place, x: number, y: number, name: string, cell: number): void => {
  if (at.look.torchChance > 0 && chance(cell, SALT.torch) < at.look.torchChance) {
    place(at, name, x, y, colorOf(at.look.wallTint))
    at.lights.push({ x: at.left + x * SIZE, y: at.top + y * SIZE, kind: 'torch' })
  }
}

const placeEdgeWalls = (at: Place, edges: Edges): void => {
  const { map } = at
  const stride = map.width + 1
  const tint = colorOf(at.look.wallTint)

  for (let y = 0; y <= map.height; y++) {
    for (let x = 0; x <= map.width; x++) {
      const cell = y * stride + x
      const along = edges.along[cell]!
      const down = edges.down[cell]!

      if (along !== 0) {
        place(at, wallName(at, along, cell) + ALONG_X, x + 0.5, y, tint)
      }

      if (down !== 0) {
        place(at, wallName(at, down, cell) + ALONG_Y, x, y + 0.5, tint)
      }

      if (along === BACK) {
        torchAt(at, x + 0.5, y, at.look.torchAlongX, cell)
      }

      if (down === BACK) {
        torchAt(at, x, y + 0.5, at.look.torchAlongY, cell + map.cells.length)
      }
    }
  }
}

const postKind = (edges: Edges, stride: number, x: number, y: number): number => {
  const cell = y * stride + x
  const horizontal = [x > 0 ? edges.along[cell - 1]! : 0, edges.along[cell]!]
  const vertical = [y > 0 ? edges.down[cell - stride]! : 0, edges.down[cell]!]
  const incident = [...horizontal, ...vertical].filter((kind) => kind !== 0)
  const turns = horizontal.some((kind) => kind !== 0) && vertical.some((kind) => kind !== 0)

  if (!turns && incident.length !== 1) {
    return 0
  }

  return incident.includes(BACK) ? BACK : LOW
}

const placePosts = (at: Place, edges: Edges): void => {
  const { map } = at
  const stride = map.width + 1
  const tint = colorOf(at.look.wallTint)

  for (let y = 0; y <= map.height; y++) {
    for (let x = 0; x <= map.width; x++) {
      const kind = postKind(edges, stride, x, y)

      if (kind !== 0) {
        place(at, kind === BACK ? 'd_post' : 'd_post_low', x, y, tint)
      }
    }
  }
}

const placeRocks = (at: Place): void => {
  const { map, look } = at
  const tint = colorOf(look.wallTint)

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const cell = y * map.width + x

      if (map.cells[cell] === CELL.wall) {
        const back = open(map, x + 1, y) || open(map, x, y + 1)
        const name = back ? pick(look.walls, cell, SALT.rock) : 'd_boulder'
        place(at, name, x + 0.5, y + 0.5, tint)
      }
    }
  }
}

const nearWall = (map: DungeonMap, x: number, y: number): boolean =>
  !open(map, x - 1, y) || !open(map, x + 1, y) || !open(map, x, y - 1) || !open(map, x, y + 1)

const clearOfArrival = (map: DungeonMap, x: number, y: number): boolean =>
  Math.abs(x - (map.arrival % map.width)) > ARRIVAL_CLEAR ||
  Math.abs(y - Math.floor(map.arrival / map.width)) > ARRIVAL_CLEAR

const placeProps = (at: Place): void => {
  const { map, look } = at
  const tint = colorOf(look.propTint)

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const cell = y * map.width + x
      const free = map.cells[cell] === CELL.floor && nearWall(map, x, y)

      if (free && clearOfArrival(map, x, y) && chance(cell, SALT.prop) < look.propChance) {
        const name = pick(look.props, cell, SALT.pick)
        place(at, name, x + 0.5, y + 0.5, tint)

        if (look.glowing.includes(name)) {
          at.lights.push({
            x: at.left + (x + 0.5) * SIZE,
            y: at.top + (y + 0.5) * SIZE,
            kind: 'lantern',
          })
        }
      }
    }
  }
}

const placeStairs = (at: Place): void => {
  for (const cell of [at.map.up, at.map.down]) {
    if (cell >= 0) {
      place(
        at,
        'd_stairs',
        (cell % at.map.width) + 0.5,
        Math.floor(cell / at.map.width) + 0.5,
        0xff_ff_ff,
      )
    }
  }
}

const floorTiles = (map: DungeonMap, look: Look, left: number, top: number): FloorTile[] => {
  const tiles: FloorTile[] = []
  const tint = colorOf(look.floorTint)

  for (let cell = 0; cell < map.cells.length; cell++) {
    if (walkable(map.cells[cell]!)) {
      tiles.push({
        name: pick(look.floors, cell, SALT.floor),
        x: left + ((cell % map.width) + 0.5) * SIZE,
        y: top + (Math.floor(cell / map.width) + 0.5) * SIZE,
        tint,
      })
    }
  }

  return tiles
}

const lavaCells = (map: DungeonMap): number[] => {
  const cells: number[] = []

  for (let cell = 0; cell < map.cells.length; cell++) {
    if (map.cells[cell] === CELL.lava) {
      cells.push(cell)
    }
  }

  return cells
}

const lavaLights = (at: Place, lava: readonly number[]): void => {
  for (const cell of lava) {
    if (chance(cell, SALT.lava) < at.look.lavaLightChance) {
      at.lights.push({
        x: at.left + ((cell % at.map.width) + 0.5) * SIZE,
        y: at.top + (Math.floor(cell / at.map.width) + 0.5) * SIZE,
        kind: 'fire',
      })
    }
  }
}

export const dressTier = (map: DungeonMap, left: number, top: number): Dressing => {
  const look = plan.tiers[map.tier]!
  const at: Place = { map, look, left, top, props: [], lights: [] }

  if (look.wallStyle === 'rocks') {
    placeRocks(at)
  } else {
    const edges = findEdges(map)
    placeEdgeWalls(at, edges)
    placePosts(at, edges)
  }

  placeStairs(at)
  placeProps(at)
  const lava = lavaCells(map)
  lavaLights(at, lava)

  return { floors: floorTiles(map, look, left, top), lava, props: at.props, lights: at.lights }
}
