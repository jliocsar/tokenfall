import world from '@tokenfall/data/world.json'
import { Particle, ParticleContainer, type Container, type Texture } from 'pixi.js'
import { backOffset } from '../../core/combat.ts'
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
  readonly hitClip: number
  readonly stateMs: Float64Array
  readonly frameCounts: readonly number[]
  readonly directionToSheet: Uint8Array
  readonly kindSheet: Uint8Array
  readonly tints: Uint32Array
}

const STATE_CLIPS = [
  'Idle_Combat',
  'Spawn_Ground_Skeletons',
  'Idle_Combat',
  'Attack',
  'Death_C_Skeletons',
] as const

const HIT_CLIP = 'Hit_A'
const SHEET_PREFIX = 'skeleton_'
const IDLE_FPS = 6
const ALPHA = 255 << 24
const HIT = 0x80_80_ff + ALPHA
const CRIT = 0x40_d0_ff + ALPHA
const BACK = new Float64Array(2)

const container = (texture: Texture): ParticleContainer =>
  new ParticleContainer({
    dynamicProperties: { position: true, vertex: true, uvs: true, color: true, rotation: false },
    texture,
  })

const packed = ([red, green, blue]: readonly number[]): number =>
  ((blue! << 16) | (green! << 8) | red!) + ALPHA

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
    hitClip: clipIndices(atlas, [HIT_CLIP])[0]!,
    stateMs,
    frameCounts: atlas.animations.map((animation) => animation.frames),
    directionToSheet: new Uint8Array(
      world.directions.map((name) => atlas.directions.indexOf(name)),
    ),
    kindSheet: new Uint8Array(
      combat.monsters.map((kind) => Math.max(0, atlas.sheets.indexOf(SHEET_PREFIX + kind.name))),
    ),
    tints: new Uint32Array(combat.tints.map(packed)),
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

const hurt = (sim: Sim, slot: number, now: number): boolean =>
  sim.combat.monsters.state[slot] === MONSTER_IDLE &&
  now - sim.combat.monsters.hitAt[slot]! < sim.config.combat.monsterHitMs

const clipOf = (layer: MonsterLayer, sim: Sim, slot: number, now: number): number =>
  hurt(sim, slot, now) ? layer.hitClip : layer.stateClips[sim.combat.monsters.state[slot]!]!

const frameOf = (
  layer: MonsterLayer,
  sim: Sim,
  slot: number,
  clip: number,
  now: number,
): number => {
  const { monsters } = sim.combat
  const state = monsters.state[slot]!
  const frames = layer.frameCounts[clip]!

  if (clip === layer.hitClip) {
    const elapsed = now - monsters.hitAt[slot]!

    return Math.min(frames - 1, Math.floor((elapsed / sim.config.combat.monsterHitMs) * frames))
  }

  if (state === MONSTER_IDLE) {
    return Math.floor((now * IDLE_FPS) / 1000 + slot * 0.37) % frames
  }

  const elapsed = now - monsters.since[slot]!

  return Math.min(frames - 1, Math.floor((elapsed / layer.stateMs[state]!) * frames))
}

const colorOf = (layer: MonsterLayer, sim: Sim, slot: number, now: number): number => {
  const { monsters, rooms } = sim.combat

  if (now - monsters.hitAt[slot]! >= sim.config.combat.hitFlashMs) {
    return layer.tints[Math.max(0, Math.min(layer.tints.length - 1, rooms.tier))]!
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
    if (monsters.state[slot] === MONSTER_FREE) {
      continue
    }

    const clip = clipOf(layer, sim, slot, now)
    const particle = layer.particles[slot]!
    backOffset(sim, slot, now, BACK)
    const x = monsters.x[slot]! + BACK[0]!
    const y = monsters.y[slot]! + BACK[1]!
    particle.texture =
      layer.textures[
        textureIndex(
          layer.clips,
          layer.kindSheet[monsters.kind[slot]!]!,
          clip,
          layer.directionToSheet[monsters.dir[slot]!]!,
          frameOf(layer, sim, slot, clip, now),
        )
      ]!
    particle.x = screenX(x, y)
    particle.y = screenY(x, y)
    particle.color = colorOf(layer, sim, slot, now)

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
