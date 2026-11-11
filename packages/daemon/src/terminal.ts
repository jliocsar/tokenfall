import { decodeTrusted } from '@tokenfall/protocol/json'
import {
  MAX_GRID,
  MAX_HERO_ID,
  MAX_INPUT,
  MAX_SCROLL,
  type ClientMessage,
  type ControlState,
  type Frame,
  type Grid,
} from '@tokenfall/protocol/terminal'
import { request } from './adapters/herdr/client.ts'
import { openStream, type Stream, type StreamMode } from './adapters/herdr/stream.ts'
import type { DaemonTuning } from './config.ts'
import type { World } from './world.ts'

export type Peer = {
  readonly send: (text: string) => number
  readonly close: (code: number, reason: string) => void
}

export type Terminals = {
  readonly receive: (socket: Peer, raw: string | Buffer) => void
  readonly drop: (socket: Peer) => void
  readonly stop: () => void
}

type Wire = {
  readonly kind?: string
  readonly hero?: string
  readonly bytes?: string
  readonly direction?: string
  readonly lines?: number
  readonly cols?: number
  readonly rows?: number
}

type Watching = {
  readonly socket: Peer
  readonly hero: string
  pane: string
  cols: number
  rows: number
  stream: Stream | undefined
  timer: ReturnType<typeof setInterval> | undefined
  busy: boolean
  fallen: boolean
  restartAt: number
}

type Context = {
  readonly world: World
  readonly tuning: DaemonTuning['terminal']
  readonly watching: Map<Peer, Watching>
}

const POLICY_VIOLATION = 1008
const TAKEN = 'already has an attached client'

const decodeScroll = (wire: Wire): ClientMessage | undefined =>
  (wire.direction === 'up' || wire.direction === 'down') &&
  wire.lines !== undefined &&
  Number.isSafeInteger(wire.lines) &&
  wire.lines > 0 &&
  wire.lines <= MAX_SCROLL
    ? { kind: 'scroll', direction: wire.direction, lines: wire.lines }
    : undefined

const inGrid = (value: number | undefined): value is number =>
  value !== undefined && Number.isSafeInteger(value) && value > 0 && value <= MAX_GRID

const decodeGrid = (wire: Wire, kind: 'focus' | 'resize'): ClientMessage | undefined =>
  inGrid(wire.cols) && inGrid(wire.rows) ? { kind, cols: wire.cols, rows: wire.rows } : undefined

const decodeWire = (wire: Wire): ClientMessage | undefined => {
  if (wire.kind === 'unwatch' || wire.kind === 'blur') {
    return { kind: wire.kind }
  }

  if (wire.kind === 'focus' || wire.kind === 'resize') {
    return decodeGrid(wire, wire.kind)
  }

  if (wire.kind === 'input') {
    return wire.bytes !== undefined && wire.bytes.length > 0 && wire.bytes.length <= MAX_INPUT
      ? { kind: 'input', bytes: wire.bytes }
      : undefined
  }

  if (wire.kind === 'scroll') {
    return decodeScroll(wire)
  }

  const hero = wire.hero

  return wire.kind === 'watch' && hero !== undefined && hero.length <= MAX_HERO_ID
    ? { kind: 'watch', hero }
    : undefined
}

const decode = (raw: string): ClientMessage | undefined => {
  try {
    const wire = decodeTrusted<Wire | null>(raw)

    return wire === null ? undefined : decodeWire(wire)
  } catch {
    return undefined
  }
}

const send = (socket: Peer, message: Frame): void => {
  socket.send(JSON.stringify(message))
}

const tell = (socket: Peer, state: ControlState): void => {
  socket.send(JSON.stringify({ kind: 'control', state }))
}

const readLayout = async (pane: string): Promise<Grid | undefined> => {
  const reply = await request('pane.layout', { pane_id: pane })
  const rect = reply.result?.layout?.panes?.find((entry) => entry.pane_id === pane)?.rect

  return rect === undefined || rect.width < 1 || rect.height < 1
    ? undefined
    : { cols: rect.width, rows: rect.height }
}

const controlling = (watch: Watching): boolean => watch.stream?.mode === 'control'

const typingGrid = (watch: Watching, asked: Grid): Grid => ({
  cols: Math.min(asked.cols, watch.cols),
  rows: Math.min(asked.rows, watch.rows),
})

const stopStream = (watch: Watching): void => {
  watch.stream?.stop()
  watch.stream = undefined
}

const fall = (watch: Watching): void => {
  stopStream(watch)

  if (!watch.fallen) {
    watch.fallen = true
    send(watch.socket, {
      kind: 'frame',
      hero: watch.hero,
      alive: false,
      cols: 0,
      rows: 0,
      full: true,
      bytes: '',
    })
  }
}

const startStream = (context: Context, watch: Watching, mode: StreamMode, grid: Grid): void => {
  const held = { told: false }
  watch.stream = openStream(mode, watch.pane, grid, {
    frame: (frame) => {
      if (mode === 'control' && !held.told) {
        held.told = true
        tell(watch.socket, 'held')
      }

      send(watch.socket, { kind: 'frame', hero: watch.hero, alive: true, ...frame })
    },
    closed: (reason) => {
      watch.stream = undefined
      watch.restartAt = Date.now() + context.tuning.restartMs

      if (mode === 'control') {
        tell(watch.socket, reason.includes(TAKEN) ? 'busy' : 'released')
        observeAgain(context, watch)
      }
    },
  })
}

const observeAgain = (context: Context, watch: Watching): void => {
  startStream(context, watch, 'observe', { cols: watch.cols, rows: watch.rows })
}

const refresh = async (context: Context, watch: Watching): Promise<void> => {
  const record = context.world.live.get(watch.hero)

  if (record === undefined || record.pane === '') {
    fall(watch)

    return
  }

  watch.fallen = false

  if (controlling(watch)) {
    return
  }

  const size = await readLayout(record.pane)

  if (size === undefined || context.watching.get(watch.socket) !== watch || controlling(watch)) {
    return
  }

  const moved = record.pane !== watch.pane || size.cols !== watch.cols || size.rows !== watch.rows

  if (moved || (watch.stream === undefined && Date.now() >= watch.restartAt)) {
    stopStream(watch)
    watch.pane = record.pane
    watch.cols = size.cols
    watch.rows = size.rows
    observeAgain(context, watch)
  }
}

const drop = (context: Context, socket: Peer): void => {
  const watch = context.watching.get(socket)

  if (watch !== undefined) {
    clearInterval(watch.timer)
    stopStream(watch)
    context.watching.delete(socket)
  }
}

const watch = (context: Context, socket: Peer, hero: string): void => {
  drop(context, socket)
  const state: Watching = {
    socket,
    hero,
    pane: '',
    cols: 0,
    rows: 0,
    stream: undefined,
    timer: undefined,
    busy: false,
    fallen: false,
    restartAt: 0,
  }

  const tick = (): void => {
    if (state.busy) {
      return
    }

    state.busy = true
    refresh(context, state)
      .catch(() => undefined)
      .finally(() => {
        state.busy = false
      })
  }

  state.timer = setInterval(tick, context.tuning.layoutMs)
  context.watching.set(socket, state)
  tick()
}

const focus = (context: Context, watching: Watching, asked: Grid): void => {
  if (controlling(watching) || watching.pane === '' || watching.fallen) {
    return
  }

  stopStream(watching)
  startStream(context, watching, 'control', typingGrid(watching, asked))
}

const blur = (context: Context, watching: Watching): void => {
  if (!controlling(watching)) {
    return
  }

  stopStream(watching)
  tell(watching.socket, 'released')
  observeAgain(context, watching)
}

const steer = (context: Context, socket: Peer, message: ClientMessage): void => {
  const watching = context.watching.get(socket)

  if (watching === undefined) {
    return
  }

  if (message.kind === 'focus') {
    focus(context, watching, message)
  } else if (message.kind === 'resize') {
    watching.stream?.write({ type: 'terminal.resize', ...typingGrid(watching, message) })
  } else if (message.kind === 'blur') {
    blur(context, watching)
  } else if (message.kind === 'input') {
    watching.stream?.write({ type: 'terminal.input', bytes: message.bytes })
  } else if (message.kind === 'scroll') {
    watching.stream?.write({
      type: 'terminal.scroll',
      direction: message.direction,
      lines: message.lines,
      source: 'wheel',
    })
  }
}

export const createTerminals = (world: World, tuning: DaemonTuning['terminal']): Terminals => {
  const context: Context = { world, tuning, watching: new Map() }

  return {
    receive: (socket, raw) => {
      const message = decode(String(raw))

      if (message === undefined) {
        drop(context, socket)
        socket.close(POLICY_VIOLATION, 'bad message')
      } else if (message.kind === 'unwatch') {
        drop(context, socket)
      } else if (message.kind === 'watch') {
        watch(context, socket, message.hero)
      } else {
        steer(context, socket, message)
      }
    },
    drop: (socket) => {
      drop(context, socket)
    },
    stop: () => {
      for (const socket of [...context.watching.keys()]) {
        drop(context, socket)
      }
    },
  }
}
