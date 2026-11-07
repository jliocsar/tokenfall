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
  count: number
}

const MAX_FRAMES = 8
const DIRECTIONS = 8
const IDLE_FPS = 6
const WALK_FPS = 10
const CULL_MARGIN = 160
const UNKNOWN_STATUS = 4
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

  if (state === layer.states.dying || state === layer.states.dead) {
    particle.tint = 0x66_33_33
    particle.alpha = 0.55
  } else if (sim.stores.hero.status[eid] === UNKNOWN_STATUS) {
    particle.tint = 0x88_88_88
    particle.alpha = 1
  } else {
    particle.tint = 0xff_ff_ff
    particle.alpha = state === layer.states.warpIn ? 0.5 : 1
  }
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

  for (let i = 0; i < layer.count; i++) {
    const eid = layer.order[i]!

    if (layer.hidden[sim.stores.behavior.state[eid]!] === 1) {
      continue
    }

    const sx = screenX(x[eid]!, y[eid]!)
    const sy = screenY(x[eid]!, y[eid]!)

    if (
      sx < view.left - CULL_MARGIN ||
      sx > view.right + CULL_MARGIN ||
      sy < view.top - CULL_MARGIN ||
      sy > view.bottom + CULL_MARGIN
    ) {
      continue
    }

    const particle = layer.particles[eid]!
    particle.x = sx
    particle.y = sy
    paint(layer, sim, particle, eid, now)
    children[visible] = particle
    visible += 1
  }

  children.length = visible
  traceEnd()

  return visible
}
