import { decodeTrusted } from '@tokenfall/protocol/json'
import { createGpuTimer, type GpuTimer } from '../bench/gpu-timer.ts'
import { createSeries, record, summarize, type Series } from '../bench/stats.ts'
import type { Profile } from '../core/system.ts'

export type MeasurePlan = {
  readonly heroes: number
  readonly off: ReadonlySet<string>
  readonly dungeon: boolean
  readonly deaths: boolean
  readonly label: string
  readonly rest: readonly string[]
}

export type MeasureExtra = { readonly guilds: number; readonly parties: number }

type MeasureResult = ReturnType<typeof result>

export type FrameCost = {
  interval: number
  sim: number
  sync: number
  render: number
  bubbles: number
}

export type TownMeasure = {
  readonly plan: MeasurePlan
  readonly gpu: GpuTimer
  readonly samples: number[]
  readonly series: Record<keyof FrameCost | 'cpu' | 'gpu' | 'heap' | 'roster', Series>
  readonly cost: FrameCost
  measuring: boolean
  done: boolean
  phaseEnds: number
  heapStart: number
}

const WARMUP_MS = 4000
const MEASURE_MS = 6000
const CAPACITY = 6000
const STORAGE_KEY = 'tokenfall.measure'
const CONTINUE = 'continue'
const MB = 1_048_576

const DEFAULT_PLAN =
  '500,1000,1000-light,1000-props,1000-overlay,1000-dungeon,1000-dungeon-light,1000-deaths'

const DUNGEON = 'dungeon'
const DEATHS = 'deaths'

export const readMeasurePlan = (params: URLSearchParams): MeasurePlan | undefined => {
  const value = params.get('measure')

  if (value === null) {
    return undefined
  }

  const entries = (value || DEFAULT_PLAN).split(',')
  const [heroes = '500', ...off] = (entries[0] ?? '500').split('-')

  if (!params.has(CONTINUE)) {
    sessionStorage.removeItem(STORAGE_KEY)
  }

  return {
    heroes: Number(heroes) || 500,
    off: new Set(off.filter((flag) => flag !== DUNGEON && flag !== DEATHS)),
    dungeon: off.includes(DUNGEON),
    deaths: off.includes(DEATHS),
    label: entries[0] ?? '500',
    rest: entries.slice(1),
  }
}

export const createTownMeasure = (
  gl: WebGL2RenderingContext,
  plan: MeasurePlan,
  now: number,
): TownMeasure => ({
  plan,
  gpu: createGpuTimer(gl),
  samples: [],
  series: {
    interval: createSeries(CAPACITY),
    sim: createSeries(CAPACITY),
    sync: createSeries(CAPACITY),
    render: createSeries(CAPACITY),
    roster: createSeries(CAPACITY),
    bubbles: createSeries(CAPACITY),
    cpu: createSeries(CAPACITY),
    gpu: createSeries(CAPACITY),
    heap: createSeries(CAPACITY),
  },
  cost: { interval: 0, sim: 0, sync: 0, render: 0, bubbles: 0 },
  measuring: false,
  done: false,
  phaseEnds: now + WARMUP_MS,
  heapStart: 0,
})

const heapMb = (): number =>
  performance.memory === undefined ? 0 : performance.memory.usedJSHeapSize / MB

const rendererName = (gl: WebGL2RenderingContext): string => {
  const info = gl.getExtension('WEBGL_debug_renderer_info')

  return info === null ? 'unknown' : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
}

const result = (measure: TownMeasure, profile: Profile, extra: MeasureExtra) => {
  const { series } = measure
  const heap = series.heap.values.slice(0, series.heap.count)

  return {
    scenario: `town ${measure.plan.label}`,
    heroes: measure.plan.heroes,
    off: [...measure.plan.off],
    fps: Math.round((series.interval.count / MEASURE_MS) * 10_000) / 10,
    frameIntervalMs: summarize(series.interval),
    cpuMs: summarize(series.cpu),
    simMs: summarize(series.sim),
    syncMs: summarize(series.sync),
    renderSubmitMs: summarize(series.render),
    rosterMs: summarize(series.roster),
    gpuMs: summarize(series.gpu),
    bubbles: summarize(series.bubbles).p50,
    heapMb: {
      start: Math.round(measure.heapStart * 10) / 10,
      end: Math.round((heap[heap.length - 1] ?? 0) * 10) / 10,
      min: Math.round(Math.min(...heap) * 10) / 10,
      max: Math.round(Math.max(...heap) * 10) / 10,
    },
    systemsMsPerFrame: Object.fromEntries(
      profile.names.map((name, i) => [
        name,
        Math.round((profile.totalMs[i]! / Math.max(1, profile.frames)) * 1e4) / 1e4,
      ]),
    ),
    tabHidden: document.hidden,
    ...extra,
  }
}

const finish = async (
  measure: TownMeasure,
  gl: WebGL2RenderingContext,
  profile: Profile,
  extra: MeasureExtra,
  report: (text: string) => void,
): Promise<void> => {
  const stored = sessionStorage.getItem(STORAGE_KEY)
  const results: MeasureResult[] = stored === null ? [] : decodeTrusted<MeasureResult[]>(stored)
  results.push(result(measure, profile, extra))
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(results))

  if (measure.plan.rest.length > 0) {
    const params = new URLSearchParams(window.location.search)
    params.set('measure', measure.plan.rest.join(','))
    params.set(CONTINUE, '')
    window.location.search = params.toString()

    return
  }

  sessionStorage.removeItem(STORAGE_KEY)
  const environment = {
    renderer: rendererName(gl),
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    canvas: [gl.canvas.width, gl.canvas.height],
    gpuTimer: measure.gpu.supported,
    heapApi: performance.memory !== undefined,
  }
  const response = await fetch('/__bench', {
    method: 'POST',
    body: JSON.stringify({ at: new Date().toISOString(), environment, results }, null, 2),
  })
  report(
    `saved to ${await response.text()}\n\n${results.map((row) => JSON.stringify(row)).join('\n')}`,
  )
}

export const measureFrame = (
  measure: TownMeasure,
  gl: WebGL2RenderingContext,
  profile: Profile,
  now: number,
  extra: () => MeasureExtra,
  report: (text: string) => void,
): void => {
  const { series, cost, samples } = measure
  samples.length = 0
  measure.gpu.poll(samples)

  if (measure.done) {
    return
  }

  if (!measure.measuring) {
    if (now >= measure.phaseEnds) {
      measure.measuring = true
      measure.phaseEnds = now + MEASURE_MS
      measure.heapStart = heapMb()
      profile.totalMs.fill(0)
      profile.frames = 0
    }

    return
  }

  record(series.interval, cost.interval)
  record(series.sim, cost.sim)
  record(series.sync, cost.sync)
  record(series.render, cost.render)
  record(series.bubbles, cost.bubbles)
  record(series.cpu, cost.sim + cost.sync + cost.render)
  record(series.heap, heapMb())

  for (const sample of samples) {
    record(series.gpu, sample)
  }

  if (now >= measure.phaseEnds) {
    measure.done = true
    void finish(measure, gl, profile, extra(), report)
  }
}

export const recordRoster = (measure: TownMeasure, ms: number): void => {
  if (measure.measuring && !measure.done) {
    record(measure.series.roster, ms)
  }
}

export const measureLabel = (measure: TownMeasure): string => {
  if (measure.done) {
    return 'measure: done'
  }

  return `measure: ${measure.measuring ? 'measuring' : 'warming up'} ${measure.plan.label}, then ${measure.plan.rest.join(', ') || 'save'}`
}
