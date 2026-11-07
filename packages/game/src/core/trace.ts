export type Trace = {
  readonly names: string[]
  readonly ids: Map<string, number>
  readonly name: Uint16Array
  readonly start: Float64Array
  readonly end: Float64Array
  readonly depth: Uint8Array
  readonly frame: Uint32Array
  readonly stack: Uint32Array
  readonly counterName: Uint16Array
  readonly counterAt: Float64Array
  readonly counterValue: Float64Array
  readonly mask: number
  written: number
  counters: number
  top: number
  frameNumber: number
  enabled: boolean
}

export type ChromeTraceEvent = {
  readonly name: string
  readonly ph: 'X' | 'C' | 'M'
  readonly ts: number
  readonly dur?: number
  readonly pid: number
  readonly tid: number
  readonly cat?: string
  readonly args: Readonly<Record<string, number | string>>
}

export type ChromeTrace = { readonly traceEvents: ChromeTraceEvent[] }

export type FunctionCost = {
  readonly name: string
  readonly calls: number
  readonly totalMsPerFrame: number
  readonly selfMsPerFrame: number
}

const SPAN_CAPACITY = 1 << 20
const COUNTER_CAPACITY = 1 << 16
const MAX_DEPTH = 255
const MICROSECONDS = 1000

const createTrace = (capacity: number): Trace => ({
  names: [],
  ids: new Map(),
  name: new Uint16Array(capacity),
  start: new Float64Array(capacity),
  end: new Float64Array(capacity),
  depth: new Uint8Array(capacity),
  frame: new Uint32Array(capacity),
  stack: new Uint32Array(MAX_DEPTH),
  counterName: new Uint16Array(COUNTER_CAPACITY),
  counterAt: new Float64Array(COUNTER_CAPACITY),
  counterValue: new Float64Array(COUNTER_CAPACITY),
  mask: capacity - 1,
  written: 0,
  counters: 0,
  top: 0,
  frameNumber: 0,
  enabled: false,
})

export const TRACE = createTrace(SPAN_CAPACITY)

export const traceId = (name: string): number => {
  const known = TRACE.ids.get(name)

  if (known !== undefined) {
    return known
  }

  TRACE.ids.set(name, TRACE.names.length)
  TRACE.names.push(name)

  return TRACE.names.length - 1
}

export const traceIds = (names: readonly string[]): number => {
  const first = traceId(names[0] ?? '')

  for (const name of names.slice(1)) {
    traceId(name)
  }

  return first
}

export const traceBegin = (id: number): void => {
  if (!TRACE.enabled || TRACE.top >= MAX_DEPTH) {
    return
  }

  const slot = TRACE.written & TRACE.mask
  TRACE.name[slot] = id
  TRACE.start[slot] = performance.now()
  TRACE.end[slot] = -1
  TRACE.depth[slot] = TRACE.top
  TRACE.frame[slot] = TRACE.frameNumber
  TRACE.stack[TRACE.top] = slot
  TRACE.top += 1
  TRACE.written += 1
}

export const traceEnd = (): void => {
  if (!TRACE.enabled || TRACE.top === 0) {
    return
  }

  TRACE.top -= 1
  TRACE.end[TRACE.stack[TRACE.top]!] = performance.now()
}

export const traceCounter = (id: number, value: number): void => {
  if (!TRACE.enabled || TRACE.counters >= COUNTER_CAPACITY) {
    return
  }

  TRACE.counterName[TRACE.counters] = id
  TRACE.counterAt[TRACE.counters] = performance.now()
  TRACE.counterValue[TRACE.counters] = value
  TRACE.counters += 1
}

export const traceNextFrame = (): void => {
  TRACE.frameNumber += 1
}

export const startTrace = (): void => {
  TRACE.written = 0
  TRACE.counters = 0
  TRACE.top = 0
  TRACE.frameNumber = 0
  TRACE.enabled = true
}

export const stopTrace = (): void => {
  TRACE.enabled = false
  TRACE.top = 0
}

const firstSpan = (): number => Math.max(0, TRACE.written - TRACE.mask - 1)

export const toChromeTrace = (): ChromeTrace => {
  const traceEvents: ChromeTraceEvent[] = [
    { name: 'thread_name', ph: 'M', ts: 0, pid: 1, tid: 1, args: { name: 'main' } },
  ]

  for (let i = firstSpan(); i < TRACE.written; i++) {
    const slot = i & TRACE.mask

    if (TRACE.end[slot]! >= 0) {
      traceEvents.push({
        name: TRACE.names[TRACE.name[slot]!]!,
        cat: 'tokenfall',
        ph: 'X',
        ts: TRACE.start[slot]! * MICROSECONDS,
        dur: (TRACE.end[slot]! - TRACE.start[slot]!) * MICROSECONDS,
        pid: 1,
        tid: 1,
        args: { frame: TRACE.frame[slot]! },
      })
    }
  }

  for (let i = 0; i < TRACE.counters; i++) {
    traceEvents.push({
      name: TRACE.names[TRACE.counterName[i]!]!,
      ph: 'C',
      ts: TRACE.counterAt[i]! * MICROSECONDS,
      pid: 1,
      tid: 1,
      args: { ms: TRACE.counterValue[i]! },
    })
  }

  return { traceEvents }
}

export const functionCosts = (): FunctionCost[] => {
  const calls = new Float64Array(TRACE.names.length)
  const total = new Float64Array(TRACE.names.length)
  const self = new Float64Array(TRACE.names.length)
  const open: number[] = []

  for (let i = firstSpan(); i < TRACE.written; i++) {
    const slot = i & TRACE.mask

    if (TRACE.end[slot]! < 0) {
      continue
    }

    while (open.length > 0 && TRACE.end[open[open.length - 1]!]! <= TRACE.start[slot]!) {
      open.pop()
    }

    const duration = TRACE.end[slot]! - TRACE.start[slot]!
    const id = TRACE.name[slot]!
    calls[id] = calls[id]! + 1
    total[id] = total[id]! + duration
    self[id] = self[id]! + duration

    if (open.length > 0) {
      const parent = TRACE.name[open[open.length - 1]!]!
      self[parent] = self[parent]! - duration
    }

    open.push(slot)
  }

  const frames = Math.max(1, TRACE.frameNumber)

  return TRACE.names
    .map((name, id) => ({
      name,
      calls: calls[id]!,
      totalMsPerFrame: total[id]! / frames,
      selfMsPerFrame: self[id]! / frames,
    }))
    .filter((cost) => cost.calls > 0)
    .sort((a, b) => b.selfMsPerFrame - a.selfMsPerFrame)
}
