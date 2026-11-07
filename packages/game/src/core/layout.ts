import { mulberry32, type Random } from './random.ts'
import type { Sim } from './sim.ts'

export type TownTuning = {
  readonly plots: number
  readonly squareRadius: number
  readonly graveyard: readonly number[]
  readonly entranceReach: number
  readonly plotJitter: number
  readonly road: {
    readonly cell: number
    readonly roadHalf: number
    readonly sideStreet: number
    readonly depth: number
    readonly depthCost: number
    readonly orderJitter: number
  }
  readonly party: {
    readonly ring: number
    readonly ringStep: number
    readonly perRing: number
    readonly radius: number
  }
}

export type Town = {
  readonly seed: number
  readonly plotX: Float32Array
  readonly plotY: Float32Array
  readonly entranceX: Float32Array
  readonly entranceY: Float32Array
  readonly pathX: Float32Array
  readonly pathY: Float32Array
  readonly guildOfPlot: Int16Array
  readonly plotOfGuild: Int16Array
  readonly square: Float32Array
  readonly graveyard: Float32Array
  readonly streets: Float32Array
  streetCount: number
  revision: number
}

type Candidate = { readonly column: number; readonly side: number; readonly depth: number }

export const NO_PLOT = -1

const createTown = (seed: number, plots: number, guilds: number): Town => ({
  seed,
  plotX: new Float32Array(plots),
  plotY: new Float32Array(plots),
  entranceX: new Float32Array(plots),
  entranceY: new Float32Array(plots),
  pathX: new Float32Array(plots),
  pathY: new Float32Array(plots),
  guildOfPlot: new Int16Array(plots).fill(NO_PLOT),
  plotOfGuild: new Int16Array(guilds).fill(NO_PLOT),
  square: new Float32Array(3),
  graveyard: new Float32Array(4),
  streets: new Float32Array(plots * 4),
  streetCount: 0,
  revision: 1,
})

const shake = (random: Random, amount: number): number => (random() * 2 - 1) * amount

const roadCandidates = (town: Town, tuning: TownTuning, random: Random): Candidate[] => {
  const { road } = tuning
  const columns = Math.ceil(town.plotX.length / (road.depth * 2)) + 1
  const scored: { readonly candidate: Candidate; readonly score: number }[] = []

  for (let column = 0; column < columns; column++) {
    for (const side of [-1, 1]) {
      for (let depth = 0; depth < road.depth; depth++) {
        scored.push({
          candidate: { column, side, depth },
          score: column + depth * road.depthCost + random() * road.orderJitter,
        })
      }
    }
  }

  return scored.toSorted((a, b) => a.score - b.score).map((entry) => entry.candidate)
}

const streetX = (tuning: TownTuning, pair: number): number => {
  const { road } = tuning

  return pair * (road.cell * 2 + road.sideStreet) + road.sideStreet / 2
}

const buildRoad = (town: Town, tuning: TownTuning, random: Random): void => {
  const { road } = tuning
  const reach = road.roadHalf + road.cell / 2 + (road.depth - 1) * road.cell + road.cell / 2
  const candidates = roadCandidates(town, tuning, random)
  town.square.set([-tuning.squareRadius - 2, 0, tuning.squareRadius])
  town.graveyard.set([
    -tuning.squareRadius * 2 - tuning.graveyard[0]! - 2,
    -(road.roadHalf + tuning.graveyard[1]! + 1),
    tuning.graveyard[0]!,
    tuning.graveyard[1]!,
  ])

  for (let plot = 0; plot < town.plotX.length; plot++) {
    const { column, side, depth } = candidates[plot]!
    const pair = Math.floor(column / 2)
    const within = column % 2
    const x = streetX(tuning, pair) + road.sideStreet / 2 + within * road.cell + road.cell / 2
    const y = side * (road.roadHalf + road.cell / 2 + depth * road.cell)
    town.plotX[plot] = x + shake(random, tuning.plotJitter)
    town.plotY[plot] = y + shake(random, tuning.plotJitter)
    town.entranceX[plot] = x
    town.entranceY[plot] = y + side * tuning.entranceReach
    town.pathX[plot] = streetX(tuning, pair + within)
    town.pathY[plot] = y
  }

  const pairs = Math.ceil(candidates.length / (road.depth * 4)) + 1

  for (let pair = 0; pair <= pairs; pair++) {
    town.streets.set([streetX(tuning, pair), -reach, streetX(tuning, pair), reach], pair * 4)
  }

  town.streetCount = pairs + 1
}

export const buildTown = (seed: number, tuning: TownTuning, guilds: number): Town => {
  const town = createTown(seed, tuning.plots, guilds)
  buildRoad(town, tuning, mulberry32(seed))

  return town
}

export const claimPlot = (town: Town, guild: number): number => {
  const known = town.plotOfGuild[guild]!

  if (known !== NO_PLOT) {
    return known
  }

  for (let plot = 0; plot < town.guildOfPlot.length; plot++) {
    if (town.guildOfPlot[plot] === NO_PLOT) {
      town.guildOfPlot[plot] = guild
      town.plotOfGuild[guild] = plot
      town.revision += 1

      return plot
    }
  }

  return guild % town.guildOfPlot.length
}

export const releasePlot = (town: Town, guild: number): void => {
  const plot = town.plotOfGuild[guild]!

  if (plot === NO_PLOT) {
    return
  }

  town.guildOfPlot[plot] = NO_PLOT
  town.plotOfGuild[guild] = NO_PLOT
  town.revision += 1
}

export const campSpot = (sim: Sim, guild: number, out: Float64Array): void => {
  const plot = claimPlot(sim.town, guild)
  out[0] = sim.town.plotX[plot]!
  out[1] = sim.town.plotY[plot]!
}

export const partySpot = (sim: Sim, party: number, out: Float64Array): void => {
  const { party: tuning } = sim.config.town
  const guild = sim.groups.partyGuild[party]!
  const slot = sim.groups.partySlot[party]!
  const ring = Math.floor(slot / tuning.perRing)
  const angle = ((slot % tuning.perRing) / tuning.perRing) * Math.PI * 2 + ring * 0.5
  const radius = tuning.ring + ring * tuning.ringStep
  campSpot(sim, guild, out)
  out[0] = out[0]! + Math.cos(angle) * radius
  out[1] = out[1]! + Math.sin(angle) * radius
}

export const entranceSpot = (sim: Sim, guild: number, out: Float64Array): void => {
  const plot = claimPlot(sim.town, guild)
  out[0] = sim.town.entranceX[plot]!
  out[1] = sim.town.entranceY[plot]!
}

export const dungeonSpot = (sim: Sim, guild: number, out: Float64Array): void => {
  entranceSpot(sim, guild, out)
}

export const jitter = (sim: Sim, radius: number, out: Float64Array): void => {
  const angle = sim.random() * Math.PI * 2
  const distance = Math.sqrt(sim.random()) * radius
  out[0] = out[0]! + Math.cos(angle) * distance
  out[1] = out[1]! + Math.sin(angle) * distance
}
