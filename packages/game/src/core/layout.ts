import type { Sim } from './sim.ts'

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const CAMP_SPACING = 7
const DUNGEON_OFFSET_X = 70
const TIER_WIDTH = 22
const TIER_LEVELS = 25

export const campSpot = (guild: number, out: Float64Array): void => {
  const radius = CAMP_SPACING * Math.sqrt(guild + 1)
  const angle = guild * GOLDEN_ANGLE
  out[0] = Math.cos(angle) * radius
  out[1] = Math.sin(angle) * radius
}

export const entranceSpot = (guild: number, out: Float64Array): void => {
  campSpot(guild, out)
  out[0] = out[0]! + 3
  out[1] = out[1]! - 3
}

export const dungeonSpot = (sim: Sim, guild: number, level: number, out: Float64Array): void => {
  const tier = Math.min(3, Math.floor((level - 1) / TIER_LEVELS))
  out[0] = DUNGEON_OFFSET_X + tier * TIER_WIDTH + sim.random() * (TIER_WIDTH - 4)
  out[1] = -40 + (guild % 16) * 5 + sim.random() * 4
}

export const jitter = (sim: Sim, radius: number, out: Float64Array): void => {
  const angle = sim.random() * Math.PI * 2
  const distance = Math.sqrt(sim.random()) * radius
  out[0] = out[0]! + Math.cos(angle) * distance
  out[1] = out[1]! + Math.sin(angle) * distance
}
