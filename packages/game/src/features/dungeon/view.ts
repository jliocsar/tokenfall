import { Container, Graphics } from 'pixi.js'
import plan from '@tokenfall/data/dungeon.json'
import { CELL, type DungeonMap } from '../../core/dungeon-gen.ts'
import { cellAt, cellWorld, dungeonBounds, settleTier, stairsAt } from '../../core/dungeon.ts'
import { groundX, groundY, screenX, screenY } from '../../core/iso.ts'
import type { Sim } from '../../core/sim.ts'

export type OpenDungeon = { readonly guild: number; readonly tier: number }

export type DungeonView = {
  readonly container: Container
  readonly tiles: Graphics
  open: OpenDungeon | undefined
  map: DungeonMap | undefined
}

export type Corners = { left: number; right: number; top: number; bottom: number }

const WALL_HEIGHT = 20
const SIDE_SHADE = 0.72
const FRONT_SHADE = 0.55
const STAIRS_COLOR = 0xd9_c0_7a
const PORTAL_COLOR = 0x5a_a8_ff
const SIZE = plan.cellSize
const STAIRS_REACH = 1.2 * SIZE
const PORTAL_RADIUS = [44 * SIZE, 22 * SIZE] as const

const shade = (color: number, amount: number): number => {
  const red = ((color >> 16) & 0xff) * amount
  const green = ((color >> 8) & 0xff) * amount
  const blue = (color & 0xff) * amount

  return (Math.round(red) << 16) | (Math.round(green) << 8) | Math.round(blue)
}

const colorOf = (hex: string): number => Number.parseInt(hex.slice(1), 16)

const diamond = (x: number, y: number, lift: number): number[] => [
  screenX(x, y),
  screenY(x, y) - lift,
  screenX(x + SIZE, y),
  screenY(x + SIZE, y) - lift,
  screenX(x + SIZE, y + SIZE),
  screenY(x + SIZE, y + SIZE) - lift,
  screenX(x, y + SIZE),
  screenY(x, y + SIZE) - lift,
]

const drawWall = (tiles: Graphics, x: number, y: number, color: number): void => {
  tiles
    .poly([
      screenX(x, y + SIZE),
      screenY(x, y + SIZE),
      screenX(x + SIZE, y + SIZE),
      screenY(x + SIZE, y + SIZE),
      screenX(x + SIZE, y + SIZE),
      screenY(x + SIZE, y + SIZE) - WALL_HEIGHT,
      screenX(x, y + SIZE),
      screenY(x, y + SIZE) - WALL_HEIGHT,
    ])
    .fill(shade(color, FRONT_SHADE))
  tiles
    .poly([
      screenX(x + SIZE, y),
      screenY(x + SIZE, y),
      screenX(x + SIZE, y + SIZE),
      screenY(x + SIZE, y + SIZE),
      screenX(x + SIZE, y + SIZE),
      screenY(x + SIZE, y + SIZE) - WALL_HEIGHT,
      screenX(x + SIZE, y),
      screenY(x + SIZE, y) - WALL_HEIGHT,
    ])
    .fill(shade(color, SIDE_SHADE))
  tiles.poly(diamond(x, y, WALL_HEIGHT)).fill(color)
}

const drawCell = (
  tiles: Graphics,
  kind: number,
  x: number,
  y: number,
  tier: (typeof plan.tiers)[number],
): void => {
  if (kind === CELL.wall) {
    drawWall(tiles, x, y, colorOf(tier.wall))

    return
  }

  if (kind === CELL.lava) {
    tiles.poly(diamond(x, y, 0)).fill(colorOf(plan.lava))

    return
  }

  const floor = kind === CELL.up || kind === CELL.down ? STAIRS_COLOR : colorOf(tier.floor)
  tiles
    .poly(diamond(x, y, 0))
    .fill(floor)
    .stroke({ color: shade(floor, SIDE_SHADE), width: 1 })
}

const drawMap = (view: DungeonView, sim: Sim, map: DungeonMap, guild: number): void => {
  const { tiles } = view
  const tier = plan.tiers[map.tier]!
  const bounds = dungeonBounds(sim, guild, map.tier)
  tiles.clear()

  for (let depth = 0; depth < map.width + map.height; depth++) {
    for (let cx = Math.max(0, depth - map.height + 1); cx <= Math.min(depth, map.width - 1); cx++) {
      const cell = (depth - cx) * map.width + cx
      const kind = map.cells[cell]!

      if (kind !== CELL.rock) {
        drawCell(tiles, kind, bounds.minX + cx * SIZE, bounds.minY + (depth - cx) * SIZE, tier)
      }
    }
  }

  cellWorld(sim, map, guild, map.arrival, sim.scratch)
  tiles
    .ellipse(
      screenX(sim.scratch[0]!, sim.scratch[1]!),
      screenY(sim.scratch[0]!, sim.scratch[1]!),
      PORTAL_RADIUS[0],
      PORTAL_RADIUS[1],
    )
    .stroke({ color: PORTAL_COLOR, width: 4 })
}

export const createDungeonView = (): DungeonView => {
  const container = new Container({ label: 'dungeon', isRenderGroup: true })
  const tiles = new Graphics()
  container.addChild(tiles)
  container.visible = false

  return { container, tiles, open: undefined, map: undefined }
}

export const showTier = (view: DungeonView, sim: Sim, guild: number, tier: number): DungeonMap => {
  const map = settleTier(sim, guild, tier)
  view.open = { guild, tier }
  view.map = map
  drawMap(view, sim, map, guild)
  view.container.visible = true

  return map
}

export const hideDungeon = (view: DungeonView): void => {
  view.open = undefined
  view.map = undefined
  view.tiles.clear()
  view.container.visible = false
}

export const tierCorners = (sim: Sim, guild: number, tier: number): Corners => {
  const bounds = dungeonBounds(sim, guild, tier)
  const xs = [
    screenX(bounds.minX, bounds.minY),
    screenX(bounds.maxX, bounds.minY),
    screenX(bounds.maxX, bounds.maxY),
    screenX(bounds.minX, bounds.maxY),
  ]
  const ys = [
    screenY(bounds.minX, bounds.minY),
    screenY(bounds.maxX, bounds.minY),
    screenY(bounds.maxX, bounds.maxY),
    screenY(bounds.minX, bounds.maxY),
  ]

  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys) - WALL_HEIGHT,
    bottom: Math.max(...ys),
  }
}

export const stairsUnder = (
  view: DungeonView,
  sim: Sim,
  pixelX: number,
  pixelY: number,
): number => {
  const { map, open } = view

  if (map === undefined || open === undefined) {
    return 0
  }

  const worldX = groundX(pixelX, pixelY)
  const worldY = groundY(pixelX, pixelY)

  for (const target of [map.down, map.up]) {
    if (target >= 0) {
      cellWorld(sim, map, open.guild, target, sim.scratch)

      if (Math.hypot(sim.scratch[0]! - worldX, sim.scratch[1]! - worldY) <= STAIRS_REACH) {
        return stairsAt(map, cellAt(sim, map, open.guild, sim.scratch[0]!, sim.scratch[1]!))
      }
    }
  }

  return 0
}
