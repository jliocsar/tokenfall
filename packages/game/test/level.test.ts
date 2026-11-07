import { describe, expect, test } from 'bun:test'
import curve from '@tokenfall/data/level-curve.json'
import { levelFor, levelThresholds } from '../src/core/level.ts'

const thresholds = levelThresholds(curve)

describe('level curve', () => {
  test('lands within a level of each calibration target', () => {
    for (const target of curve.targets) {
      expect(Math.abs(levelFor(thresholds, target.experience) - target.level)).toBeLessThanOrEqual(
        1,
      )
    }
  })

  test('starts at 1 and stops at the cap', () => {
    expect(levelFor(thresholds, 0)).toBe(1)
    expect(levelFor(thresholds, 9e12)).toBe(curve.maxLevel)
  })

  test('each level costs more than the last', () => {
    for (let level = 3; level <= curve.maxLevel; level++) {
      expect(thresholds[level]! - thresholds[level - 1]!).toBeGreaterThan(
        thresholds[level - 1]! - thresholds[level - 2]!,
      )
    }
  })
})
