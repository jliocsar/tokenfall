import { Application, WebGLRenderer } from 'pixi.js'
import { arenaBytes } from '../core/store.ts'
import {
  functionCosts,
  startTrace,
  stopTrace,
  toChromeTrace,
  traceBegin,
  traceCounter,
  traceEnd,
  traceId,
  traceNextFrame,
} from '../core/trace.ts'
import { attachCamera, fitCamera, updateCamera, type Camera } from '../render/camera.ts'
import { loadAtlas, type View } from '../render/heroes.ts'
import { createGpuTimer, type GpuTimer } from './gpu-timer.ts'
import { createSession, destroySession, heroBounds, stepSession, type Session } from './session.ts'
import { createSeries, record, summarize, type Series } from './stats.ts'

type Scenario = { readonly label: string; readonly heroes: number; readonly storm: number }

type Measure = {
  readonly interval: Series
  readonly sim: Series
  readonly render: Series
  readonly gpu: Series
  readonly heap: Series
  readonly visible: Series
  readonly particles: Series
}

type BenchState = {
  session: Session
  run: Run | undefined
  last: number
  nextHud: number
  traceFramesLeft: number
  tabHidden: boolean
}

type Run = {
  readonly scenarios: readonly Scenario[]
  readonly results: unknown[]
  index: number
  measuring: boolean
  phaseEnds: number
  measure: Measure
}

const WARMUP_MS = 2500
const MEASURE_MS = 6000
const SERIES_CAPACITY = 6000
const HUD_EVERY_MS = 250
const SIZES = [100, 250, 500, 1000]
const STORMS = [100, 250, 400, 512]
const TRACE_FRAMES = 120
const TRACE_DELAY_MS = 3000
const TOP_COSTS = 25
const SPAN_FRAME = traceId('frame')
const SPAN_CAMERA = traceId('camera')
const SPAN_STEP = traceId('session.step')
const SPAN_RENDER = traceId('pixi.render')
const SPAN_GPU_POLL = traceId('gpu.poll')
const SPAN_HUD = traceId('hud')
const COUNTER_GPU = traceId('gpu ms')

const SCENARIOS: readonly Scenario[] = SIZES.flatMap((heroes, i) => [
  { label: `${heroes} heroes`, heroes, storm: 0 },
  { label: `${heroes} heroes + ${STORMS[i]!} rings`, heroes, storm: STORMS[i]! },
])

const createMeasure = (): Measure => ({
  interval: createSeries(SERIES_CAPACITY),
  sim: createSeries(SERIES_CAPACITY),
  render: createSeries(SERIES_CAPACITY),
  gpu: createSeries(SERIES_CAPACITY),
  heap: createSeries(SERIES_CAPACITY),
  visible: createSeries(SERIES_CAPACITY),
  particles: createSeries(SERIES_CAPACITY),
})

const element = (id: string): HTMLElement => {
  const found = document.getElementById(id)

  if (found === null) {
    throw new Error(`bench.html is missing #${id}`)
  }

  return found
}

const app = new Application()
await app.init({
  preference: 'webgl',
  resizeTo: window,
  background: '#0d0b14',
  antialias: false,
  autoStart: false,
  powerPreference: 'high-performance',
})
document.body.prepend(app.canvas)

if (!(app.renderer instanceof WebGLRenderer)) {
  throw new Error('the benchmark needs the WebGL renderer')
}

const { gl } = app.renderer
const gpuTimer: GpuTimer = createGpuTimer(gl)
const { atlas, source } = await loadAtlas('/sprites/heroes-atlas')
const camera: Camera = { x: 0, y: 0, zoom: 0.3, keys: new Set() }
const view: View = { left: 0, top: 0, right: 0, bottom: 0 }
const bounds: View = { left: 0, top: 0, right: 0, bottom: 0 }
const hud = element('hud')
const gpuSamples: number[] = []
const state: BenchState = {
  session: createSession(app, atlas, source, 500, 0),
  run: undefined,
  last: performance.now(),
  nextHud: 0,
  traceFramesLeft: 0,
  tabHidden: false,
}
attachCamera(app.canvas, camera)

const rendererName = (): string => {
  const info = gl.getExtension('WEBGL_debug_renderer_info')

  return info === null ? 'unknown' : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
}

const environment = () => ({
  renderer: rendererName(),
  userAgent: navigator.userAgent,
  devicePixelRatio: window.devicePixelRatio,
  canvas: [app.canvas.width, app.canvas.height],
  crossOriginIsolated: window.crossOriginIsolated,
  gpuTimer: gpuTimer.supported,
  heapApi: performance.memory !== undefined,
})

const selectedHeroes = (): string => {
  const select = element('heroes')

  return select instanceof HTMLSelectElement ? select.value : '500'
}

const replaceSession = (heroes: number, storm: number): void => {
  destroySession(state.session)
  state.session = createSession(app, atlas, source, heroes, storm)
}

const fit = (): void => {
  heroBounds(state.session, bounds)

  if (Number.isFinite(bounds.left)) {
    fitCamera(camera, bounds, app.screen.width, app.screen.height)
  }
}

const finishScenario = (run: Run): void => {
  const scenario = run.scenarios[run.index]!
  const { sim, profile } = state.session
  const heap = summarize(run.measure.heap)
  run.results.push({
    scenario: scenario.label,
    heroes: scenario.heroes,
    storm: scenario.storm,
    fps: Math.round((run.measure.interval.count / MEASURE_MS) * 1000 * 10) / 10,
    frameIntervalMs: summarize(run.measure.interval),
    simMs: summarize(run.measure.sim),
    renderSubmitMs: summarize(run.measure.render),
    gpuMs: summarize(run.measure.gpu),
    heapMb: {
      min:
        heap.p50 === 0 ? 0 : Math.min(...run.measure.heap.values.slice(0, run.measure.heap.count)),
      max: heap.max,
    },
    visibleHeroes: summarize(run.measure.visible).p50,
    particles: summarize(run.measure.particles),
    systemsMsPerFrame: Object.fromEntries(
      profile.names.map((name, i) => [
        name,
        Math.round((profile.totalMs[i]! / Math.max(1, profile.frames)) * 1e4) / 1e4,
      ]),
    ),
    storeBytes: arenaBytes(sim.arena),
    tabHiddenWhileMeasuring: state.tabHidden,
    counters: {
      ...sim.counters,
      droppedEvents: sim.inbound.dropped,
      droppedTimers: sim.timers.dropped,
    },
  })
}

const startScenario = (run: Run, now: number): void => {
  const scenario = run.scenarios[run.index]!
  replaceSession(scenario.heroes, scenario.storm)
  run.measuring = false
  run.phaseEnds = now + WARMUP_MS
  run.measure = createMeasure()
}

const showResults = (results: readonly unknown[], savedTo: string): void => {
  const panel = element('results')
  const rows = results.map((result) => JSON.stringify(result))
  panel.style.display = 'block'
  panel.textContent = `saved to ${savedTo}\n\n${rows.join('\n')}`
}

const finishRun = async (run: Run): Promise<void> => {
  const payload = JSON.stringify(
    { at: new Date().toISOString(), environment: environment(), results: run.results },
    null,
    2,
  )
  const response = await fetch('/__bench', { method: 'POST', body: payload })
  showResults(run.results, await response.text())
}

const advanceRun = (run: Run, now: number): void => {
  if (now < run.phaseEnds) {
    return
  }

  if (!run.measuring) {
    fit()
    state.session.profile.totalMs.fill(0)
    state.session.profile.frames = 0
    run.measuring = true
    state.tabHidden = document.hidden
    run.phaseEnds = now + MEASURE_MS

    return
  }

  finishScenario(run)
  run.index += 1

  if (run.index >= run.scenarios.length) {
    state.run = undefined
    void finishRun(run)

    return
  }

  startScenario(run, now)
}

const measureFrame = (run: Run, interval: number, simMs: number, renderMs: number): void => {
  if (!run.measuring) {
    return
  }

  record(run.measure.interval, interval)
  record(run.measure.sim, simMs)
  record(run.measure.render, renderMs)
  record(run.measure.visible, state.session.visible)
  record(run.measure.particles, state.session.particles)

  if (performance.memory !== undefined) {
    record(run.measure.heap, performance.memory.usedJSHeapSize / 1_048_576)
  }

  for (const sample of gpuSamples) {
    record(run.measure.gpu, sample)
  }
}

const gpuLabel = (): string => {
  if (!gpuTimer.supported) {
    return 'n/a'
  }

  return gpuSamples.length > 0 ? `${gpuSamples[gpuSamples.length - 1]!.toFixed(2)} ms` : '…'
}

const drawHud = (now: number, interval: number, simMs: number, renderMs: number): void => {
  if (now < state.nextHud) {
    return
  }

  state.nextHud = now + HUD_EVERY_MS
  const { session, run } = state
  const scenario =
    run === undefined
      ? 'explore'
      : `${run.scenarios[run.index]?.label ?? ''} (${run.measuring ? 'measuring' : 'warming up'}) ${run.index + 1}/${run.scenarios.length}`
  hud.textContent = [
    scenario,
    `fps ${(1000 / interval).toFixed(0)}  frame ${interval.toFixed(2)} ms`,
    `sim ${simMs.toFixed(3)} ms  render submit ${renderMs.toFixed(2)} ms`,
    `gpu ${gpuLabel()}`,
    `heroes ${session.heroes.count}/${session.heroCount} visible ${session.visible}`,
    `effect particles ${session.particles}  rings ${session.sim.effects[0]!.active}`,
    `heap ${performance.memory === undefined ? 'n/a' : `${(performance.memory.usedJSHeapSize / 1_048_576).toFixed(1)} MB`}`,
    `level ups ${session.sim.counters.levelUps}  deaths ${session.sim.counters.died}`,
    `drag or WASD to pan, wheel or +/- to zoom`,
  ].join('\n')
}

const showCosts = (savedTo: string): void => {
  const panel = element('results')
  const rows = functionCosts()
    .slice(0, TOP_COSTS)
    .map(
      (cost) =>
        `${cost.selfMsPerFrame.toFixed(4).padStart(9)}  ${cost.totalMsPerFrame.toFixed(4).padStart(9)}  ${String(cost.calls).padStart(8)}  ${cost.name}`,
    )
  panel.style.display = 'block'
  panel.textContent = [
    `trace saved to ${savedTo}`,
    'open it at https://ui.perfetto.dev (drag the file in) for the waterfall',
    '',
    ' self ms/f  total ms/f     calls  span',
    ...rows,
  ].join('\n')
}

const saveTrace = async (): Promise<void> => {
  const response = await fetch('/__trace', {
    method: 'POST',
    body: JSON.stringify({ ...toChromeTrace(), environment: environment() }),
  })
  showCosts(await response.text())
}

const advanceTrace = (): void => {
  if (state.traceFramesLeft === 0) {
    return
  }

  traceNextFrame()
  state.traceFramesLeft -= 1

  if (state.traceFramesLeft === 0) {
    stopTrace()
    void saveTrace()
  }
}

const captureTrace = (): void => {
  startTrace()
  state.traceFramesLeft = TRACE_FRAMES
}

const frame = (now: number): void => {
  const interval = now - state.last
  state.last = now
  const dt = Math.min(interval, 100)
  traceBegin(SPAN_FRAME)
  traceBegin(SPAN_CAMERA)
  updateCamera(camera, state.session.world, app.screen.width, app.screen.height, dt, view)
  traceEnd()
  const simStart = performance.now()
  traceBegin(SPAN_STEP)
  stepSession(state.session, atlas, view, now, dt)
  traceEnd()
  const simMs = performance.now() - simStart
  const renderStart = performance.now()
  traceBegin(SPAN_RENDER)
  gpuTimer.begin()
  app.render()
  gpuTimer.end()
  traceEnd()
  const renderMs = performance.now() - renderStart
  traceBegin(SPAN_GPU_POLL)
  gpuSamples.length = 0
  gpuTimer.poll(gpuSamples)

  for (const sample of gpuSamples) {
    traceCounter(COUNTER_GPU, sample)
  }

  traceEnd()

  if (state.run !== undefined) {
    measureFrame(state.run, interval, simMs, renderMs)
    advanceRun(state.run, now)
  }

  traceBegin(SPAN_HUD)
  drawHud(now, interval, simMs, renderMs)
  traceEnd()
  traceEnd()
  advanceTrace()
  requestAnimationFrame(frame)
}

const startRun = (): void => {
  const run: Run = {
    scenarios: SCENARIOS,
    results: [],
    index: 0,
    measuring: false,
    phaseEnds: 0,
    measure: createMeasure(),
  }
  state.run = run
  element('results').style.display = 'none'
  startScenario(run, performance.now())
}

element('run').addEventListener('click', startRun)
element('trace').addEventListener('click', captureTrace)
element('explore').addEventListener('click', () => {
  state.run = undefined
  replaceSession(Number(selectedHeroes()), 0)
  setTimeout(fit, 1500)
})
element('storm').addEventListener('click', () => {
  state.session.storm = state.session.storm > 0 ? 0 : 300
})

setTimeout(fit, 1500)

if (new URLSearchParams(location.search).has('auto')) {
  startRun()
}

if (new URLSearchParams(location.search).has('trace')) {
  setTimeout(captureTrace, TRACE_DELAY_MS)
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    state.tabHidden = true
  }
})

requestAnimationFrame(frame)
