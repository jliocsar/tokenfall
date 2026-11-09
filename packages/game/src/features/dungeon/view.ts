import { Container, Graphics, Particle, ParticleContainer, type Texture } from 'pixi.js'
import plan from '@tokenfall/data/dungeon.json'
import type { DungeonMap } from '../../core/dungeon-gen.ts'
import { cellAt, cellWorld, dungeonBounds, settleTier, stairsAt } from '../../core/dungeon.ts'
import { groundX, groundY, screenX, screenY } from '../../core/iso.ts'
import type { Sim } from '../../core/sim.ts'
import { dressTier, type Dressing } from './dress.ts'

export type OpenDungeon = { readonly guild: number; readonly tier: number }

export type DungeonView = {
  readonly container: Container
  readonly floors: ParticleContainer
  readonly lava: Graphics
  readonly textures: ReadonlyMap<string, Texture>
  open: OpenDungeon | undefined
  map: DungeonMap | undefined
}

export type Corners = { left: number; right: number; top: number; bottom: number }

const SIZE = plan.cellSize
const WALL_RISE = 80
const PORTAL_COLOR = 0x5a_a8_ff
const STAIRS_REACH = 1.2 * SIZE
const PORTAL_RADIUS = [44 * SIZE, 22 * SIZE] as const
const LAVA_EDGE = 0xff_c0_60

const colorOf = (hex: string): number => Number.parseInt(hex.slice(1), 16)

const diamond = (x: number, y: number): number[] => [
  screenX(x, y),
  screenY(x, y),
  screenX(x + SIZE, y),
  screenY(x + SIZE, y),
  screenX(x + SIZE, y + SIZE),
  screenY(x + SIZE, y + SIZE),
  screenX(x, y + SIZE),
  screenY(x, y + SIZE),
]

const paintFloors = (view: DungeonView, dressing: Dressing): void => {
  const children = view.floors.particleChildren
  children.length = 0

  for (const tile of dressing.floors) {
    const texture = view.textures.get(tile.name)

    if (texture !== undefined) {
      children.push(
        new Particle({
          texture,
          anchorX: texture.defaultAnchor?.x ?? 0.5,
          anchorY: texture.defaultAnchor?.y ?? 0.5,
          x: screenX(tile.x, tile.y),
          y: screenY(tile.x, tile.y),
          tint: tile.tint,
        }),
      )
    }
  }

  view.floors.update()
}

const paintLava = (
  view: DungeonView,
  sim: Sim,
  map: DungeonMap,
  guild: number,
  dressing: Dressing,
): void => {
  const { lava } = view
  const bounds = dungeonBounds(sim, guild, map.tier)
  lava.clear()

  for (const cell of dressing.lava) {
    const x = bounds.minX + (cell % map.width) * SIZE
    const y = bounds.minY + Math.floor(cell / map.width) * SIZE
    lava
      .poly(diamond(x, y))
      .fill(colorOf(plan.lava))
      .stroke({ color: LAVA_EDGE, width: 1, alpha: 0.4 })
  }

  cellWorld(sim, map, guild, map.arrival, sim.scratch)
  lava
    .ellipse(
      screenX(sim.scratch[0]!, sim.scratch[1]!),
      screenY(sim.scratch[0]!, sim.scratch[1]!),
      PORTAL_RADIUS[0],
      PORTAL_RADIUS[1],
    )
    .stroke({ color: PORTAL_COLOR, width: 4 })
}

export const createDungeonView = (
  texture: Texture,
  textures: ReadonlyMap<string, Texture>,
): DungeonView => {
  const container = new Container({ label: 'dungeon', isRenderGroup: true })
  const floors = new ParticleContainer({
    texture,
    dynamicProperties: { position: false, color: false },
  })
  const lava = new Graphics()
  container.addChild(floors, lava)
  container.visible = false

  return { container, floors, lava, textures, open: undefined, map: undefined }
}

export const showTier = (view: DungeonView, sim: Sim, guild: number, tier: number): Dressing => {
  const map = settleTier(sim, guild, tier)
  const bounds = dungeonBounds(sim, guild, tier)
  const dressing = dressTier(map, bounds.minX, bounds.minY)
  view.open = { guild, tier }
  view.map = map
  paintFloors(view, dressing)
  paintLava(view, sim, map, guild, dressing)
  view.container.visible = true

  return dressing
}

export const hideDungeon = (view: DungeonView): void => {
  view.open = undefined
  view.map = undefined
  view.floors.particleChildren.length = 0
  view.floors.update()
  view.lava.clear()
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
    top: Math.min(...ys) - WALL_RISE,
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
