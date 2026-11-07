import type { Sim } from './sim.ts'
import { traceBegin, traceEnd, traceIds } from './trace.ts'

export type System = {
  readonly name: string
  readonly complexity: string
  readonly run: (sim: Sim, now: number, dt: number) => void
}

export type Profile = {
  readonly names: readonly string[]
  readonly totalMs: Float64Array
  readonly lastMs: Float64Array
  readonly firstSpan: number
  frames: number
}

export const createProfile = (systems: readonly System[]): Profile => ({
  names: systems.map((system) => system.name),
  totalMs: new Float64Array(systems.length),
  lastMs: new Float64Array(systems.length),
  firstSpan: traceIds(systems.map((system) => `system.${system.name}`)),
  frames: 0,
})

export const runSystems = (
  systems: readonly System[],
  profile: Profile,
  sim: Sim,
  now: number,
  dt: number,
): void => {
  for (let i = 0; i < systems.length; i++) {
    const start = performance.now()
    traceBegin(profile.firstSpan + i)
    systems[i]!.run(sim, now, dt)
    traceEnd()
    const spent = performance.now() - start
    profile.lastMs[i] = spent
    profile.totalMs[i] = profile.totalMs[i]! + spent
  }

  profile.frames += 1
}

export const resetProfile = (profile: Profile): void => {
  profile.totalMs.fill(0)
  profile.lastMs.fill(0)
  profile.frames = 0
}
