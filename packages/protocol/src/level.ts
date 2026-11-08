export type LevelCurve = {
  readonly maxLevel: number
  readonly scale: number
  readonly growth: number
}

export const levelThresholds = (curve: LevelCurve): Float64Array => {
  const thresholds = new Float64Array(curve.maxLevel + 1)

  for (let level = 1; level <= curve.maxLevel; level++) {
    thresholds[level] = Math.round(curve.scale * Math.expm1(curve.growth * (level - 1)))
  }

  return thresholds
}

export const levelFor = (thresholds: Float64Array, experience: number): number => {
  let low = 1
  let high = thresholds.length - 1

  while (low < high) {
    const middle = (low + high + 1) >> 1

    if (thresholds[middle]! <= experience) {
      low = middle
    } else {
      high = middle - 1
    }
  }

  return low
}
