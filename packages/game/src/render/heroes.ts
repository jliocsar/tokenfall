import { registerQuery } from 'bitecs'
import {
  Assets,
  Particle,
  ParticleContainer,
  Rectangle,
  Texture,
  type TextureSource,
} from 'pixi.js'
import world from '@tokenfall/data/world.json'
import { hasMember } from '../core/dense-set.ts'
import { stateFlags, stateId } from '../core/fsm.ts'
import { screenX, screenY } from '../core/iso.ts'
import type { Sim } from '../core/sim.ts'
import { traceBegin, traceEnd, traceId } from '../core/trace.ts'

export type Atlas = {
  readonly image: string
  readonly cell: readonly number[]
  readonly pivot: readonly number[]
  readonly sheets: readonly string[]
  readonly animations: readonly { readonly name: string; readonly frames: number }[]
  readonly directions: readonly string[]
  readonly cells: readonly (readonly (readonly (readonly (readonly number[])[])[])[])[]
  readonly props?: Readonly<Record<string, readonly number[]>>
}

export type PropPlacement = { readonly name: string; readonly x: number; readonly y: number }

export type PropSlots = {
  readonly particles: Particle[]
  readonly depth: number[]
  readonly sx: number[]
  readonly sy: number[]
}

export type View = { left: number; top: number; right: number; bottom: number }

export type HeroLayer = {
  readonly container: ParticleContainer
  readonly particles: (Particle | undefined)[]
  readonly order: Uint32Array
  readonly depth: Float32Array
  readonly known: Uint8Array
  readonly textures: Texture[]
  readonly directionToSheet: Uint8Array
  readonly frameCounts: readonly number[]
  readonly query: { readonly dense: ArrayLike<number> }
  readonly states: { readonly dying: number; readonly dead: number; readonly warpIn: number }
  readonly hidden: Uint8Array
  readonly propTextures: ReadonlyMap<string, Texture>
  props: PropSlots
  propCursor: number
  count: number
}

const MAX_FRAMES = 8
const DIRECTIONS = 8
const IDLE_FPS = 6
const WALK_FPS = 10
const CULL_MARGIN = 160
const UNKNOWN_STATUS = 4
const DEAD_TINT = 0x33_33_66
const DEAD_ALPHA = 0.55
const UNKNOWN_COLOR = 0x88_88_88 + (255 << 24)
const LIVE_COLOR = 0xff_ff_ff + (255 << 24)
const WARPING_COLOR = 0xff_ff_ff + (((0.5 * 255) | 0) << 24)
const SPAN_ADOPT = traceId('heroes.adopt')
const SPAN_SORT = traceId('heroes.sort')
const SPAN_CULL_PAINT = traceId('heroes.cull-paint')

const textureIndex = (sheet: number, animation: number, direction: number, frame: number): number =>
  ((sheet * 2 + animation) * DIRECTIONS + direction) * MAX_FRAMES + frame

export const loadAtlas = async (
  url: string,
): Promise<{ readonly atlas: Atlas; readonly source: TextureSource }> => {
  const atlas = await Assets.load<Atlas>(`${url}.json`)
  const texture = await Assets.load<Texture>(`${url}.png`)
  texture.source.scaleMode = 'nearest'

  return { atlas, source: texture.source }
}

const buildTextures = (atlas: Atlas, source: TextureSource): Texture[] => {
  const [width, height] = atlas.cell
  const textures: Texture[] = []

  for (const [sheet, animations] of atlas.cells.entries()) {
    for (const [animation, directions] of animations.entries()) {
      for (const [direction, frames] of directions.entries()) {
        for (const [frame, cell] of frames.entries()) {
          textures[textureIndex(sheet, animation, direction, frame)] = new Texture({
            source,
            frame: new Rectangle(cell[0], cell[1], width, height),
          })
        }
      }
    }
  }

  return textures
}

const buildPropTextures = (atlas: Atlas, source: TextureSource): Map<string, Texture> =>
  new Map(
    Object.entries(atlas.props ?? {}).map(([name, [x, y, width, height, pivotX, pivotY]]) => [
      name,
      new Texture({
        source,
        frame: new Rectangle(x, y, width, height),
        defaultAnchor: { x: pivotX! / width!, y: pivotY! / height! },
      }),
    ]),
  )

export const setProps = (layer: HeroLayer, placements: readonly PropPlacement[]): void => {
  const sorted = placements
    .filter((placement) => layer.propTextures.has(placement.name))
    .toSorted((a, b) => a.x + a.y - (b.x + b.y))
  layer.props = {
    particles: sorted.map((placement) => {
      const texture = layer.propTextures.get(placement.name)!

      return new Particle({
        texture,
        anchorX: texture.defaultAnchor?.x ?? 0.5,
        anchorY: texture.defaultAnchor?.y ?? 1,
        x: screenX(placement.x, placement.y),
        y: screenY(placement.x, placement.y),
      })
    }),
    depth: sorted.map((placement) => placement.x + placement.y),
    sx: sorted.map((placement) => screenX(placement.x, placement.y)),
    sy: sorted.map((placement) => screenY(placement.x, placement.y)),
  }
}

const outside = (view: View, sx: number, sy: number): boolean =>
  sx < view.left - CULL_MARGIN ||
  sx > view.right + CULL_MARGIN ||
  sy < view.top - CULL_MARGIN ||
  sy > view.bottom + CULL_MARGIN

export const createHeroLayer = (
  sim: Sim,
  atlas: Atlas,
  source: TextureSource,
  hiddenStates: readonly string[] = [],
): HeroLayer => {
  const entities = sim.config.budgets.entities
  const textures = buildTextures(atlas, source)
  const directionToSheet = new Uint8Array(
    world.directions.map((name) => atlas.directions.indexOf(name)),
  )

  return {
    container: new ParticleContainer({
      dynamicProperties: { position: true, vertex: true, uvs: true, color: true, rotation: false },
      texture: textures[0]!,
    }),
    particles: Array.from<Particle | undefined>({ length: entities }),
    order: new Uint32Array(sim.config.budgets.heroes),
    depth: new Float32Array(sim.config.budgets.heroes),
    known: new Uint8Array(entities),
    textures,
    directionToSheet,
    frameCounts: atlas.animations.map((animation) => animation.frames),
    query: registerQuery(sim.world, [sim.heroTag]),
    states: {
      dying: stateId(sim.machine, 'dying'),
      dead: stateId(sim.machine, 'dead'),
      warpIn: stateId(sim.machine, 'warping-in'),
    },
    hidden: stateFlags(sim.machine, hiddenStates),
    propTextures: buildPropTextures(atlas, source),
    props: { particles: [], depth: [], sx: [], sy: [] },
    propCursor: 0,
    count: 0,
  }
}

const adopt = (
  layer: HeroLayer,
  pivot: readonly number[],
  cell: readonly number[],
  eid: number,
): void => {
  layer.known[eid] = 1
  layer.particles[eid] = new Particle({
    texture: layer.textures[0]!,
    anchorX: pivot[0]! / cell[0]!,
    anchorY: pivot[1]! / cell[1]!,
  })
  layer.order[layer.count] = eid
  layer.count += 1
}

const sortByDepth = (layer: HeroLayer, sim: Sim): void => {
  const { order, depth } = layer
  const { x, y } = sim.stores.position

  for (let i = 0; i < layer.count; i++) {
    depth[i] = x[order[i]!]! + y[order[i]!]!
  }

  for (let i = 1; i < layer.count; i++) {
    const eid = order[i]!
    const key = depth[i]!
    let j = i - 1

    while (j >= 0 && depth[j]! > key) {
      order[j + 1] = order[j]!
      depth[j + 1] = depth[j]!
      j -= 1
    }

    order[j + 1] = eid
    depth[j + 1] = key
  }
}

const paint = (layer: HeroLayer, sim: Sim, particle: Particle, eid: number, now: number): void => {
  const walking = hasMember(sim.moving, eid) ? 1 : 0
  const fps = walking === 1 ? WALK_FPS : IDLE_FPS
  const frames = layer.frameCounts[walking]!
  const frame = Math.floor((now * fps) / 1000 + eid * 0.37) % frames
  const direction = layer.directionToSheet[sim.stores.motion.dir[eid]!]!
  particle.texture =
    layer.textures[textureIndex(sim.stores.hero.sheet[eid]!, walking, direction, frame)]!
  const state = sim.stores.behavior.state[eid]!

  if (state === layer.states.dead) {
    particle.color = DEAD_TINT
  } else if (state === layer.states.dying) {
    const left = 1 - (now - sim.stores.behavior.since[eid]!) / sim.config.tuning.deathFadeMs
    particle.color = DEAD_TINT + (((Math.max(0, left) * DEAD_ALPHA * 255) | 0) << 24)
  } else if (sim.stores.hero.status[eid] === UNKNOWN_STATUS) {
    particle.color = UNKNOWN_COLOR
  } else {
    particle.color = state === layer.states.warpIn ? WARPING_COLOR : LIVE_COLOR
  }
}

const paintProps = (layer: HeroLayer, view: View, depth: number, visible: number): number => {
  const { props } = layer
  const children = layer.container.particleChildren
  let count = visible

  while (layer.propCursor < props.depth.length && props.depth[layer.propCursor]! <= depth) {
    const prop = layer.propCursor
    layer.propCursor += 1

    if (!outside(view, props.sx[prop]!, props.sy[prop]!)) {
      children[count] = props.particles[prop]!
      count += 1
    }
  }

  return count
}

export const syncHeroes = (
  layer: HeroLayer,
  sim: Sim,
  atlas: Atlas,
  view: View,
  now: number,
): number => {
  const { dense } = layer.query
  traceBegin(SPAN_ADOPT)

  for (let i = 0; i < dense.length; i++) {
    if (layer.known[dense[i]!] === 0) {
      adopt(layer, atlas.pivot, atlas.cell, dense[i]!)
    }
  }

  traceEnd()
  traceBegin(SPAN_SORT)
  sortByDepth(layer, sim)
  traceEnd()
  traceBegin(SPAN_CULL_PAINT)
  const children = layer.container.particleChildren
  const { x, y } = sim.stores.position
  let visible = 0
  layer.propCursor = 0

  for (let i = 0; i < layer.count; i++) {
    const eid = layer.order[i]!

    if (layer.hidden[sim.stores.behavior.state[eid]!] === 1) {
      continue
    }

    const sx = screenX(x[eid]!, y[eid]!)
    const sy = screenY(x[eid]!, y[eid]!)

    if (outside(view, sx, sy)) {
      continue
    }

    visible = paintProps(layer, view, x[eid]! + y[eid]!, visible)
    const particle = layer.particles[eid]!
    particle.x = sx
    particle.y = sy
    paint(layer, sim, particle, eid, now)
    children[visible] = particle
    visible += 1
  }

  visible = paintProps(layer, view, Number.POSITIVE_INFINITY, visible)
  children.length = visible
  traceEnd()

  return visible
}
