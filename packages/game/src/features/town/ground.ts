import { Container, Graphics, Text } from 'pixi.js'
import town from '@tokenfall/data/town.json'
import world from '@tokenfall/data/world.json'
import { guildLabel } from '../../core/groups.ts'
import { screenX, screenY } from '../../core/iso.ts'
import { NO_PLOT, type Town } from '../../core/layout.ts'
import { hashString } from '../../core/random.ts'
import type { Sim } from '../../core/sim.ts'

export type TownLayer = {
  readonly container: Container
  readonly ground: Graphics
  readonly marks: Graphics
  readonly labels: Container
  drawn: Town | undefined
  revision: number
}

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

const { palette, draw } = town

const CIRCLE_POINTS = 28
const HUE_DEGREES = 360

export const createTownLayer = (): TownLayer => {
  const container = new Container({ label: 'town' })
  const ground = new Graphics()
  const marks = new Graphics()
  const labels = new Container({ label: 'town-labels' })
  container.addChild(ground, marks)

  return { container, ground, marks, labels, drawn: undefined, revision: 0 }
}

const polygon = (points: readonly number[]): number[] => {
  const out: number[] = []

  for (let i = 0; i < points.length; i += 2) {
    out.push(screenX(points[i]!, points[i + 1]!), screenY(points[i]!, points[i + 1]!))
  }

  return out
}

const circle = (x: number, y: number, radius: number): number[] => {
  const points: number[] = []

  for (let i = 0; i < CIRCLE_POINTS; i++) {
    const angle = (i / CIRCLE_POINTS) * Math.PI * 2
    points.push(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)
  }

  return polygon(points)
}

const rect = (x: number, y: number, halfX: number, halfY: number): number[] =>
  polygon([x - halfX, y - halfY, x + halfX, y - halfY, x + halfX, y + halfY, x - halfX, y + halfY])

const strip = (x0: number, y0: number, x1: number, y1: number, width: number): number[] => {
  const length = Math.hypot(x1 - x0, y1 - y0) || 1
  const nx = (-(y1 - y0) / length) * (width / 2)
  const ny = ((x1 - x0) / length) * (width / 2)

  return polygon([x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny])
}

const hueColor = (hue: number): number => {
  const saturation = 0.55
  const lightness = 0.5
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const sector = hue / 60
  const second = chroma * (1 - Math.abs((sector % 2) - 1))
  const table = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ]
  const [red, green, blue] = table[Math.floor(sector) % 6]!
  const offset = lightness - chroma / 2
  const channel = (value: number): number => Math.round((value + offset) * 255)

  return (channel(red!) << 16) | (channel(green!) << 8) | channel(blue!)
}

export const guildColor = (key: string): number => hueColor(hashString(key) % HUE_DEGREES)

const claimedBounds = (shape: Town): Bounds => {
  const [squareX, squareY, squareRadius] = shape.square
  const [graveX, graveY, graveHalfX, graveHalfY] = shape.graveyard
  const bounds: Bounds = {
    minX: Math.min(squareX! - squareRadius!, graveX! - graveHalfX!),
    maxX: Math.max(squareX! + squareRadius!, graveX! + graveHalfX!),
    minY: Math.min(squareY! - squareRadius!, graveY! - graveHalfY!),
    maxY: Math.max(squareY! + squareRadius!, graveY! + graveHalfY!),
  }

  for (let plot = 0; plot < shape.guildOfPlot.length; plot++) {
    if (shape.guildOfPlot[plot] !== NO_PLOT) {
      bounds.minX = Math.min(bounds.minX, shape.plotX[plot]! - draw.plotRadius)
      bounds.maxX = Math.max(bounds.maxX, shape.plotX[plot]! + draw.plotRadius)
      bounds.minY = Math.min(bounds.minY, shape.plotY[plot]! - draw.plotRadius)
      bounds.maxY = Math.max(bounds.maxY, shape.plotY[plot]! + draw.plotRadius)
    }
  }

  return bounds
}

const drawStreets = (ground: Graphics, shape: Town, bounds: Bounds): void => {
  const roadHalf = town.road.roadHalf
  ground.poly(strip(shape.square[0]!, 0, bounds.maxX, 0, roadHalf * 2)).fill(palette.road)

  for (let street = 0; street < shape.streetCount; street++) {
    const x = shape.streets[street * 4]!

    if (x <= bounds.maxX) {
      ground.poly(strip(x, bounds.minY, x, bounds.maxY, town.road.sideStreet)).fill(palette.road)
    }
  }
}

const drawGraveyard = (ground: Graphics, shape: Town): void => {
  const [x, y, halfX, halfY] = shape.graveyard
  ground.poly(rect(x!, y!, halfX!, halfY!)).fill(palette.graveyard)
}

const drawPlot = (ground: Graphics, shape: Town, plot: number): void => {
  const x = shape.plotX[plot]!
  const y = shape.plotY[plot]!
  ground
    .poly(strip(shape.pathX[plot]!, shape.pathY[plot]!, x, y, draw.pathWidth))
    .fill(palette.path)
  ground
    .poly(strip(x, y, shape.entranceX[plot]!, shape.entranceY[plot]!, draw.pathWidth))
    .fill(palette.path)
  ground.poly(circle(x, y, draw.plotRadius)).fill(palette.plot)
}

const label = (text: string, x: number, y: number): Text => {
  const node = new Text({
    text,
    style: {
      fontFamily: world.fonts.pixel,
      fontSize: draw.labelSize,
      fill: palette.label,
      stroke: { color: palette.labelStroke, width: 6 },
    },
  })
  node.anchor.set(0.5, 1)
  node.position.set(screenX(x - 1, y - 1), screenY(x - 1, y - 1) - draw.bannerHeight - 8)

  return node
}

const redraw = (layer: TownLayer, sim: Sim): void => {
  const shape = sim.town
  const { ground, marks, labels } = layer
  ground.clear()
  marks.clear()

  for (const child of labels.removeChildren()) {
    child.destroy()
  }

  const bounds = claimedBounds(shape)
  const margin = draw.fieldMargin
  ground
    .poly(
      polygon([
        bounds.minX - margin,
        bounds.minY - margin,
        bounds.maxX + margin,
        bounds.minY - margin,
        bounds.maxX + margin,
        bounds.maxY + margin,
        bounds.minX - margin,
        bounds.maxY + margin,
      ]),
    )
    .fill(palette.field)
  drawStreets(ground, shape, bounds)
  const [squareX, squareY, squareRadius] = shape.square
  ground.poly(circle(squareX!, squareY!, squareRadius!)).fill(palette.square)
  drawGraveyard(ground, shape)

  for (let plot = 0; plot < shape.guildOfPlot.length; plot++) {
    const guild = shape.guildOfPlot[plot]!

    if (guild !== NO_PLOT) {
      const key = sim.groups.guildKeys[guild] ?? ''
      drawPlot(ground, shape, plot)
      labels.addChild(label(guildLabel(key), shape.plotX[plot]!, shape.plotY[plot]!))
    }
  }
}

export const syncTown = (layer: TownLayer, sim: Sim): boolean => {
  if (layer.drawn === sim.town && layer.revision === sim.town.revision) {
    return false
  }

  redraw(layer, sim)
  layer.drawn = sim.town
  layer.revision = sim.town.revision

  return true
}

export const townBounds = (sim: Sim): Bounds => claimedBounds(sim.town)
