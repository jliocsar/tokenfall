import { addMember } from './dense-set.ts'
import { spawnEffectAt } from '../effects/emitters.ts'
import { DUST_KIND } from '../effects/systems.ts'
import { heroOfEntity } from './hero-index.ts'
import { hashString } from './random.ts'
import type { Sim } from './sim.ts'

export type GraveTuning = {
  readonly rows: number
  readonly columns: number
  readonly hours: number
  readonly props: readonly string[]
  readonly bigProp: string
  readonly bigLevel: number
  readonly bigScale: number
  readonly topMargin: number
}

export type Graves = {
  readonly occupant: Int32Array
  readonly diedAt: Float64Array
  readonly slotOf: Int32Array
  readonly prop: Uint8Array
  readonly lifeMs: number
  count: number
  nextExpiry: number
}

const HOUR_MS = 3_600_000

export const NO_GRAVE = -1

export const createGraves = (tuning: GraveTuning, entities: number): Graves => ({
  occupant: new Int32Array(tuning.rows * tuning.columns).fill(NO_GRAVE),
  diedAt: new Float64Array(tuning.rows * tuning.columns),
  slotOf: new Int32Array(entities).fill(NO_GRAVE),
  prop: new Uint8Array(entities),
  lifeMs: tuning.hours * HOUR_MS,
  count: 0,
  nextExpiry: Number.POSITIVE_INFINITY,
})

const refreshExpiry = (graves: Graves): void => {
  let next = Number.POSITIVE_INFINITY

  for (let slot = 0; slot < graves.occupant.length; slot++) {
    if (graves.occupant[slot] !== NO_GRAVE) {
      next = Math.min(next, graves.diedAt[slot]! + graves.lifeMs)
    }
  }

  graves.nextExpiry = next
}

const oldestSlot = (graves: Graves): number => {
  let oldest = NO_GRAVE

  for (let slot = 0; slot < graves.occupant.length; slot++) {
    if (
      graves.occupant[slot] !== NO_GRAVE &&
      (oldest === NO_GRAVE || graves.diedAt[slot]! < graves.diedAt[oldest]!)
    ) {
      oldest = slot
    }
  }

  return oldest
}

export const freeGrave = (sim: Sim, eid: number): void => {
  const { graves } = sim
  const slot = graves.slotOf[eid]!

  if (slot === NO_GRAVE) {
    return
  }

  graves.occupant[slot] = NO_GRAVE
  graves.slotOf[eid] = NO_GRAVE
  graves.count -= 1
  refreshExpiry(graves)
}

export const crumbleGrave = (sim: Sim, eid: number, now: number): void => {
  spawnEffectAt(sim, DUST_KIND, sim.stores.position.x[eid]!, sim.stores.position.y[eid]!, now)
  freeGrave(sim, eid)
  addMember(sim.releasing, eid)
}

const graveProp = (sim: Sim, eid: number, id: string): number => {
  const tuning = sim.config.death.graves

  return sim.stores.hero.level[eid]! >= tuning.bigLevel
    ? tuning.props.length
    : hashString(id) % tuning.props.length
}

export const graveSpot = (sim: Sim, slot: number, out: Float64Array): void => {
  const { rows, columns, topMargin } = sim.config.death.graves
  const [x, y, halfX, halfY] = sim.town.graveyard
  const row = Math.floor(slot / columns)
  const column = slot % columns
  out[0] = x! - halfX! + ((column + 0.5) * halfX! * 2) / columns
  out[1] = y! - halfY! + topMargin + ((row + 0.5) * (halfY! * 2 - topMargin)) / rows
}

const older = (sim: Sim, eid: number, other: number): boolean => {
  const { diedAt } = sim.stores.hero

  if (diedAt[eid] !== diedAt[other]) {
    return diedAt[eid]! < diedAt[other]!
  }

  return heroOfEntity(sim.index, eid) < heroOfEntity(sim.index, other)
}

const settle = (sim: Sim, eid: number, slot: number): void => {
  const { graves } = sim
  graves.occupant[slot] = eid
  graves.diedAt[slot] = sim.stores.hero.diedAt[eid]!
  graves.slotOf[eid] = slot
  graveSpot(sim, slot, sim.scratch)
  sim.stores.position.x[eid] = sim.scratch[0]!
  sim.stores.position.y[eid] = sim.scratch[1]!
}

export const claimGrave = (sim: Sim, eid: number, now: number): number => {
  const { graves } = sim

  if (graves.slotOf[eid] !== NO_GRAVE) {
    return graves.slotOf[eid]!
  }

  if (graves.count >= graves.occupant.length) {
    crumbleGrave(sim, graves.occupant[oldestSlot(graves)]!, now)
  }

  const id = heroOfEntity(sim.index, eid)
  const slots = graves.occupant.length
  graves.prop[eid] = graveProp(sim, eid, id)
  graves.count += 1
  graves.nextExpiry = Math.min(graves.nextExpiry, sim.stores.hero.diedAt[eid]! + graves.lifeMs)
  let carried = eid
  let slot = hashString(id) % slots

  while (graves.occupant[slot] !== NO_GRAVE) {
    const other = graves.occupant[slot]!

    if (older(sim, carried, other)) {
      settle(sim, carried, slot)
      carried = other
    }

    slot = (slot + 1) % slots
  }

  settle(sim, carried, slot)

  return graves.slotOf[eid]
}

export const expireGraves = (sim: Sim, now: number): void => {
  const { graves } = sim
  const clock = now + sim.clockOffset

  while (clock >= graves.nextExpiry) {
    crumbleGrave(sim, graves.occupant[oldestSlot(graves)]!, now)
  }
}
