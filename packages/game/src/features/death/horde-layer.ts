import world from '@tokenfall/data/world.json'
import { Particle, ParticleContainer, type Container, type Texture } from 'pixi.js'
import { skeletonPose, SKELETON_GONE, type Pose } from '../../core/death-scene.ts'
import { NO_VICTIM } from '../../core/horde.ts'
import { screenX, screenY } from '../../core/iso.ts'
import type { Sim } from '../../core/sim.ts'
import {
  buildTextures,
  clipIndices,
  loadAtlas,
  textureIndex,
  type Atlas,
} from '../../render/heroes.ts'

export type HordeLayer = {
  readonly back: ParticleContainer
  readonly front: ParticleContainer
  readonly particles: readonly Particle[]
  readonly textures: readonly Texture[]
  readonly clips: number
  readonly poseClips: Uint8Array
  readonly frameCounts: readonly number[]
  readonly directionToSheet: Uint8Array
}

const POSE_CLIPS = [
  'Spawn_Ground_Skeletons',
  'Idle_Combat',
  '1H_Melee_Attack_Chop',
  'Death_C_Skeletons',
] as const

const IDLE_FPS = 6
const BONE_TINT = 0xd4_dc_ff
const POSE: Pose = { clip: 0, progress: 0, alpha: 1 }

const container = (texture: Texture): ParticleContainer =>
  new ParticleContainer({
    dynamicProperties: { position: true, vertex: true, uvs: true, color: true, rotation: false },
    texture,
  })

const build = (sim: Sim, atlas: Atlas, textures: Texture[]): HordeLayer => ({
  back: container(textures[0]!),
  front: container(textures[0]!),
  particles: Array.from(
    { length: sim.config.budgets.horde },
    () =>
      new Particle({
        texture: textures[0]!,
        anchorX: atlas.pivot[0]! / atlas.cell[0]!,
        anchorY: atlas.pivot[1]! / atlas.cell[1]!,
        tint: BONE_TINT,
      }),
  ),
  textures,
  clips: atlas.animations.length,
  poseClips: clipIndices(atlas, POSE_CLIPS),
  frameCounts: atlas.animations.map((animation) => animation.frames),
  directionToSheet: new Uint8Array(world.directions.map((name) => atlas.directions.indexOf(name))),
})

export const loadHordeLayer = async (sim: Sim, url: string): Promise<HordeLayer> => {
  const { atlas, source } = await loadAtlas(url)

  return build(sim, atlas, buildTextures(atlas, source))
}

export const placeHorde = (layer: HordeLayer, parent: Container, heroes: Container): void => {
  parent.addChildAt(layer.back, parent.getChildIndex(heroes))
  parent.addChildAt(layer.front, parent.getChildIndex(heroes) + 1)
}

const frameOf = (layer: HordeLayer, clip: number, now: number): number => {
  const frames = layer.frameCounts[clip]!

  return POSE.clip === 1
    ? Math.floor((now * IDLE_FPS) / 1000) % frames
    : Math.min(frames - 1, Math.floor(POSE.progress * frames))
}

export const syncHorde = (layer: HordeLayer, sim: Sim, now: number): void => {
  const { horde } = sim
  const back = layer.back.particleChildren
  const front = layer.front.particleChildren
  let behind = 0
  let ahead = 0

  for (let slot = 0; slot < horde.victim.length && horde.active > 0; slot++) {
    const victim = horde.victim[slot]!

    if (victim === NO_VICTIM) {
      continue
    }

    skeletonPose(sim.config.death.scene, now - horde.start[slot]!, POSE)

    if (POSE.clip === SKELETON_GONE) {
      continue
    }

    const clip = layer.poseClips[POSE.clip]!
    const particle = layer.particles[slot]!
    const x = horde.x[slot]!
    const y = horde.y[slot]!
    particle.texture =
      layer.textures[
        textureIndex(
          layer.clips,
          0,
          clip,
          layer.directionToSheet[horde.dir[slot]!]!,
          frameOf(layer, clip, now),
        )
      ]!
    particle.x = screenX(x, y)
    particle.y = screenY(x, y)

    if (x + y < sim.stores.position.x[victim]! + sim.stores.position.y[victim]!) {
      back[behind] = particle
      behind += 1
    } else {
      front[ahead] = particle
      ahead += 1
    }
  }

  back.length = behind
  front.length = ahead
}
