export type Series = { readonly values: Float64Array; count: number }

export type Summary = {
  readonly mean: number
  readonly p50: number
  readonly p95: number
  readonly p99: number
  readonly max: number
}

export const createSeries = (capacity: number): Series => ({
  values: new Float64Array(capacity),
  count: 0,
})

export const record = (series: Series, value: number): void => {
  if (series.count < series.values.length) {
    series.values[series.count] = value
    series.count += 1
  }
}

export const summarize = (series: Series): Summary => {
  if (series.count === 0) {
    return { mean: 0, p50: 0, p95: 0, p99: 0, max: 0 }
  }

  const sorted = series.values.slice(0, series.count).sort()
  const at = (quantile: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))]!
  const round = (value: number): number => Math.round(value * 1000) / 1000

  return {
    mean: round(sorted.reduce((total, value) => total + value, 0) / sorted.length),
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    p99: round(at(0.99)),
    max: round(sorted[sorted.length - 1]!),
  }
}
