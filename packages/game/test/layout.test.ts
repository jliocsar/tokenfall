import { describe, expect, test } from 'bun:test'
import town from '@tokenfall/data/town.json'
import { buildTown, claimPlot, NO_PLOT, releasePlot } from '../src/core/layout.ts'

const GUILDS = 64
const MIN_GAP = 9

const closestPair = (xs: Float32Array, ys: Float32Array, count: number): number => {
  let closest = Number.POSITIVE_INFINITY

  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      closest = Math.min(closest, Math.hypot(xs[i]! - xs[j]!, ys[i]! - ys[j]!))
    }
  }

  return closest
}

describe('town layout', () => {
  test('keeps camps apart', () => {
    const shape = buildTown(7, town, GUILDS)

    expect(closestPair(shape.plotX, shape.plotY, GUILDS)).toBeGreaterThan(MIN_GAP)
  })

  test('the same seed builds the same town', () => {
    const first = buildTown(42, town, GUILDS)
    const second = buildTown(42, town, GUILDS)

    expect([...first.plotX]).toEqual([...second.plotX])
    expect([...first.plotY]).toEqual([...second.plotY])
  })

  test('guilds keep their plot, and an empty plot is reused', () => {
    const shape = buildTown(7, town, GUILDS)
    const first = claimPlot(shape, 0)
    const second = claimPlot(shape, 1)

    expect(claimPlot(shape, 0)).toBe(first)

    releasePlot(shape, 0)

    expect(shape.plotOfGuild[0]).toBe(NO_PLOT)
    expect(claimPlot(shape, 2)).toBe(first)
    expect(claimPlot(shape, 1)).toBe(second)
  })
})
