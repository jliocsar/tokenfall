import town from '@tokenfall/data/town.json'
import { NO_PLOT, type Town } from '../../core/layout.ts'
import { hashString, mulberry32, type Random } from '../../core/random.ts'
import type { Sim } from '../../core/sim.ts'
import type { PropPlacement } from '../../render/heroes.ts'

export type Placement = PropPlacement

const FLAGS = ['flag_red', 'flag_blue', 'flag_green', 'flag_yellow'] as const
const CLUTTER = ['barrel', 'crates', 'sack', 'weaponrack'] as const
const TREES = ['tree', 'trees', 'dead_tree', 'tree', 'rock'] as const

const { props: layout } = town

const pick = <T>(random: Random, items: readonly T[]): T =>
  items[Math.floor(random() * items.length)]!

const near = (random: Random, out: Placement[], name: string, x: number, y: number): void => {
  out.push({ name, x: x + (random() - 0.5) * 0.6, y: y + (random() - 0.5) * 0.6 })
}

const placeSquare = (shape: Town, out: Placement[]): void => {
  const [x, y, radius] = shape.square
  out.push({ name: 'well', x: x!, y: y! })

  for (const { name, angle } of layout.square) {
    const turn = (angle / 180) * Math.PI
    out.push({
      name,
      x: x! + Math.cos(turn) * (radius! + layout.squareRing),
      y: y! + Math.sin(turn) * (radius! + layout.squareRing),
    })
  }
}

const placeGraveyard = (shape: Town, out: Placement[]): void => {
  const [x, y, halfX, halfY] = shape.graveyard

  out.push({ name: 'crypt', x: x! - halfX! + 1.5, y: y! - halfY! + 0.8 })
  out.push({ name: 'dead_tree', x: x! + halfX! - 0.5, y: y! - halfY! + 0.5 })
  out.push({ name: 'lantern', x: x! + halfX! + 0.6, y: y! + halfY! + 0.6 })

  for (let i = 0; i < Math.round((halfX! * 2) / layout.fenceStep); i++) {
    out.push({
      name: 'iron_fence_side',
      x: x! - halfX! + layout.fenceStep * (i + 0.5),
      y: y! + halfY! + 0.3,
    })
  }

  for (let i = 0; i < Math.round((halfY! * 2) / layout.fenceStep); i++) {
    out.push({
      name: 'iron_fence',
      x: x! + halfX! + 0.3,
      y: y! - halfY! + layout.fenceStep * (i + 0.5),
    })
  }
}

const placeCamp = (shape: Town, plot: number, key: string, out: Placement[]): void => {
  const random = mulberry32(hashString(key))
  const x = shape.plotX[plot]!
  const y = shape.plotY[plot]!
  out.push({ name: 'campfire', x, y })
  out.push({ name: FLAGS[hashString(key) % FLAGS.length]!, x: x - 1.2, y: y - 1.2 })

  for (let i = 0; i < layout.tents; i++) {
    const angle = Math.PI / 6 + (i * Math.PI * 2) / layout.tents
    const tx = x + Math.cos(angle) * layout.tentRadius
    const ty = y + Math.sin(angle) * layout.tentRadius
    out.push({ name: 'tent', x: tx, y: ty })
    near(random, out, pick(random, CLUTTER), tx + 0.9, ty + 0.4)
  }

  out.push({ name: 'mine', x: shape.entranceX[plot]!, y: shape.entranceY[plot]! })
}

const blocked = (shape: Town, x: number, y: number): boolean => {
  const [squareX, squareY, squareRadius] = shape.square
  const [graveX, graveY, graveHalfX, graveHalfY] = shape.graveyard

  if (
    Math.hypot(x - squareX!, y - squareY!) <
    squareRadius! + layout.squareRing + layout.treeClearance
  ) {
    return true
  }

  if (
    Math.abs(x - graveX!) < graveHalfX! + layout.treeClearance &&
    Math.abs(y - graveY!) < graveHalfY! + layout.treeClearance
  ) {
    return true
  }

  if (Math.abs(y) < town.road.roadHalf + layout.treeClearance) {
    return true
  }

  for (let plot = 0; plot < shape.guildOfPlot.length; plot++) {
    if (
      shape.guildOfPlot[plot] !== NO_PLOT &&
      Math.hypot(x - shape.plotX[plot]!, y - shape.plotY[plot]!) <
        town.draw.plotRadius + layout.treeClearance
    ) {
      return true
    }
  }

  for (let street = 0; street < shape.streetCount; street++) {
    if (
      Math.abs(x - shape.streets[street * 4]!) <
      town.road.sideStreet + layout.treeClearance - 1.5
    ) {
      return true
    }
  }

  return false
}

const placeTrees = (
  shape: Town,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  out: Placement[],
): void => {
  const random = mulberry32(shape.seed ^ 0x51_7c_c1_b7)
  const margin = town.draw.fieldMargin
  const width = bounds.maxX - bounds.minX + margin * 2
  const height = bounds.maxY - bounds.minY + margin * 2
  const count = Math.round((width * height) / layout.treeArea)

  for (let i = 0; i < count; i++) {
    const x = bounds.minX - margin + random() * width
    const y = bounds.minY - margin + random() * height

    if (!blocked(shape, x, y)) {
      out.push({ name: pick(random, TREES), x, y })
    }
  }
}

export const townProps = (
  sim: Sim,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): Placement[] => {
  const shape = sim.town
  const out: Placement[] = []
  placeSquare(shape, out)
  placeGraveyard(shape, out)

  for (let plot = 0; plot < shape.guildOfPlot.length; plot++) {
    const guild = shape.guildOfPlot[plot]!

    if (guild !== NO_PLOT) {
      placeCamp(shape, plot, sim.groups.guildKeys[guild] ?? '', out)
    }
  }

  placeTrees(shape, bounds, out)

  return out
}
