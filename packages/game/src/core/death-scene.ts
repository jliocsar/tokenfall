export type SceneTuning = {
  readonly riseMs: number
  readonly attackMs: number
  readonly hits: number
  readonly fallMs: number
  readonly crumbleMs: number
  readonly fadeMs: number
  readonly base: number
  readonly perLevels: number
  readonly max: number
  readonly ring: number
  readonly arriveMs: number
}

export type Pose = { clip: number; progress: number; alpha: number }

export const HERO_IDLE = 0
export const HERO_HIT = 1
export const HERO_FALL = 2
export const SKELETON_RISE = 0
export const SKELETON_IDLE = 1
export const SKELETON_CHOP = 2
export const SKELETON_CRUMBLE = 3
export const SKELETON_GONE = 4

export const sceneLength = (scene: SceneTuning): number =>
  scene.riseMs + scene.attackMs * scene.hits + scene.fallMs + scene.crumbleMs + scene.fadeMs

export const hordeSize = (scene: SceneTuning, level: number): number =>
  Math.min(scene.max, scene.base + Math.floor(level / scene.perLevels))

const fadeAlpha = (scene: SceneTuning, elapsed: number): number => {
  const fadeFrom = sceneLength(scene) - scene.fadeMs

  return elapsed < fadeFrom ? 1 : Math.max(0, 1 - (elapsed - fadeFrom) / scene.fadeMs)
}

export const heroPose = (scene: SceneTuning, elapsed: number, out: Pose): void => {
  const attacks = scene.riseMs + scene.attackMs * scene.hits
  out.alpha = fadeAlpha(scene, elapsed)

  if (elapsed < scene.riseMs) {
    out.clip = HERO_IDLE
    out.progress = elapsed / scene.riseMs
  } else if (elapsed < attacks) {
    out.clip = HERO_HIT
    out.progress = ((elapsed - scene.riseMs) % scene.attackMs) / scene.attackMs
  } else {
    out.clip = HERO_FALL
    out.progress = Math.min(1, (elapsed - attacks) / scene.fallMs)
  }
}

export const skeletonPose = (scene: SceneTuning, elapsed: number, out: Pose): void => {
  const attacks = scene.riseMs + scene.attackMs * scene.hits
  const crumble = attacks + scene.fallMs
  out.alpha = 1

  if (elapsed < scene.riseMs) {
    out.clip = SKELETON_RISE
    out.progress = elapsed / scene.riseMs
  } else if (elapsed < attacks) {
    out.clip = SKELETON_CHOP
    out.progress = ((elapsed - scene.riseMs) % scene.attackMs) / scene.attackMs
  } else if (elapsed < crumble) {
    out.clip = SKELETON_IDLE
    out.progress = (elapsed - attacks) / scene.fallMs
  } else if (elapsed < crumble + scene.crumbleMs) {
    out.clip = SKELETON_CRUMBLE
    out.progress = (elapsed - crumble) / scene.crumbleMs
  } else {
    out.clip = SKELETON_GONE
    out.progress = 1
  }
}
