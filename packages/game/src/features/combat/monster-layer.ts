import world from '@tokenfall/data/world.json'
import { Particle, ParticleContainer, type Container, type Texture } from 'pixi.js'
import { screenX, screenY } from '../../core/iso.ts'
import {
  MONSTER_ATTACK,
  MONSTER_CRUMBLE,
  MONSTER_FREE,
  MONSTER_IDLE,
  MONSTER_RISING,
  NO_TARGET,
} from '../../core/monsters.ts'
import type { Sim } from '../../core/sim.ts'
import {
  buildTextures,
  clipIndices,
  loadAtlas,
  textureIndex,
  type Atlas,
} from '../../render/heroes.ts'

export type MonsterLayer = {
  readonly back: ParticleContainer
  readonly front: ParticleContainer
  readonly particles: readonly Particle[]
  readonly textures: readonly Texture[]
  readonly clips: number
  readonly stateClips: Uint8Array
  readonly stateMs: Float64Array
  readonly frameCounts: readonly number[]
  readonly directionToSheet: Uint8Array
}

const STATE_CLIPS = [
  'Idle_Combat',
  'Spawn_Ground_Skeletons',
  'Idle_Combat',
  '1H_Melee_Attack_Chop',
  'Death_C_Skeletons',
] as const

const IDLE_FPS = 6
const ALPHA = 255 << 24
const BONE = 0xff_dc_d4 + ALPHA
const HIT = 0x80_80_ff + ALPHA
const CRIT = 0x40_d0_ff + ALPHA

const container = (texture: Texture): ParticleContainer =>
  new ParticleContainer({
    dynamicProperties: { position: true, vertex: true, uvs: true, color: true, rotation: false },
    texture,
  })

const build = (sim: Sim, atlas: Atlas, textures: Texture[]): MonsterLayer => {
  const combat = sim.config.combat
  const stateMs = new Float64Array(STATE_CLIPS.length)
  stateMs[MONSTER_RISING] = combat.riseMs
  stateMs[MONSTER_ATTACK] = combat.attackMs
  stateMs[MONSTER_CRUMBLE] = combat.crumbleMs

  return {
    back: container(textures[0]!),
    front: container(textures[0]!),
    particles: Array.from(
      { length: sim.config.budgets.monsters },
      () =>
        new Particle({
          texture: textures[0]!,
          anchorX: atlas.pivot[0]! / atlas.cell[0]!,
          anchorY: atlas.pivot[1]! / atlas.cell[1]!,
        }),
    ),
    textures,
    clips: atlas.animations.length,
    stateClips: clipIndices(atlas, STATE_CLIPS),
    stateMs,
    frameCounts: atlas.animations.map((animation) => animation.frames),
    directionToSheet: new Uint8Array(
      world.directions.map((name) => atlas.directions.indexOf(name)),
    ),
  }
}

export const loadMonsterLayer = async (sim: Sim, url: string): Promise<MonsterLayer> => {
  const { atlas, source } = await loadAtlas(url)

  return build(sim, atlas, buildTextures(atlas, source))
}

export const placeMonsters = (layer: MonsterLayer, parent: Container, heroes: Container): void => {
  parent.addChildAt(layer.back, parent.getChildIndex(heroes))
  parent.addChildAt(layer.front, parent.getChildIndex(heroes) + 1)
}

const frameOf = (layer: MonsterLayer, state: number, elapsed: number, now: number): number => {
  const frames = layer.frameCounts[layer.stateClips[state]!]!

  if (state === MONSTER_IDLE) {
    return Math.floor((now * IDLE_FPS) / 1000) % frames
  }

  return Math.min(frames - 1, Math.floor((elapsed / layer.stateMs[state]!) * frames))
}

const colorOf = (sim: Sim, slot: number, now: number): number => {
  const { monsters } = sim.combat

  if (now - monsters.hitAt[slot]! >= sim.config.combat.hitFlashMs) {
    return BONE
  }

  return monsters.hitCrit[slot] === 1 ? CRIT : HIT
}

const inFront = (sim: Sim, slot: number): boolean => {
  const { monsters } = sim.combat
  const eid = monsters.target[slot]!

  return (
    eid !== NO_TARGET &&
    monsters.x[slot]! + monsters.y[slot]! >
      sim.stores.position.x[eid]! + sim.stores.position.y[eid]!
  )
}

export const syncMonsters = (layer: MonsterLayer, sim: Sim, now: number): void => {
  const { monsters } = sim.combat
  const back = layer.back.particleChildren
  const front = layer.front.particleChildren
  let behind = 0
  let ahead = 0

  for (let slot = 0; slot < monsters.state.length && monsters.active > 0; slot++) {
    const state = monsters.state[slot]!

    if (state === MONSTER_FREE) {
      continue
    }

    const clip = layer.stateClips[state]!
    const particle = layer.particles[slot]!
    const x = monsters.x[slot]!
    const y = monsters.y[slot]!
    particle.texture =
      layer.textures[
        textureIndex(
          layer.clips,
          0,
          clip,
          layer.directionToSheet[monsters.dir[slot]!]!,
          frameOf(layer, state, now - monsters.since[slot]!, now),
        )
      ]!
    particle.x = screenX(x, y)
    particle.y = screenY(x, y)
    particle.color = colorOf(sim, slot, now)

    if (inFront(sim, slot)) {
      front[ahead] = particle
      ahead += 1
    } else {
      back[behind] = particle
      behind += 1
    }
  }

  back.length = behind
  front.length = ahead
}
