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
import { openStream, type Stream } from './adapters/herdr/stream.ts'
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
  observer: Stream | undefined
  controller: Stream | undefined
  grid: Grid
  held: boolean
  accepting: boolean
  retried: boolean
  linger: ReturnType<typeof setTimeout> | undefined
  timer: ReturnType<typeof setInterval> | undefined
  polling: boolean
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
const RETRY = 'retry'

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

const readGrid = async (pane: string, scrollbarCols: number): Promise<Grid | undefined> => {
  const [layout, info] = await Promise.all([
    request('pane.layout', { pane_id: pane }),
    request('pane.get', { pane_id: pane }),
  ])
  const rect = layout.result?.layout?.panes?.find((entry) => entry.pane_id === pane)?.rect
  const rows = info.result?.pane?.scroll?.viewport_rows ?? rect?.height

  if (rect === undefined || rows === undefined) {
    return undefined
  }

  const cols = rect.width - (rect.height - rows) - scrollbarCols

  return cols < 1 || rows < 1 ? undefined : { cols, rows }
}

const live = (context: Context, watch: Watching): boolean =>
  context.watching.get(watch.socket) === watch

const capped = (watch: Watching, asked: Grid): Grid => ({
  cols: Math.min(asked.cols, watch.cols),
  rows: Math.min(asked.rows, watch.rows),
})

const stopObserver = (watch: Watching): void => {
  watch.observer?.stop()
  watch.observer = undefined
}

const stopLinger = (watch: Watching): void => {
  clearTimeout(watch.linger)
  watch.linger = undefined
}

const fall = (watch: Watching): void => {
  stopObserver(watch)

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

const observe = (context: Context, watch: Watching): void => {
  stopObserver(watch)
  const stream = openStream(
    'observe',
    watch.pane,
    { cols: watch.cols, rows: watch.rows },
    {
      frame: (frame) => {
        if (watch.controller === undefined) {
          send(watch.socket, { kind: 'frame', hero: watch.hero, alive: true, ...frame })
        }
      },
      closed: () => {
        if (watch.observer === stream) {
          watch.observer = undefined
          watch.restartAt = Date.now() + context.tuning.restartMs
        }
      },
    },
  )
  watch.observer = stream
}

const controlClosed = (context: Context, watch: Watching, reason: string): void => {
  const held = watch.held
  watch.controller = undefined
  watch.held = false
  stopLinger(watch)

  if (!live(context, watch)) {
    return
  }

  if (!held && reason.includes(RETRY) && !reason.includes(TAKEN) && !watch.retried) {
    watch.retried = true
    setTimeout(() => {
      if (live(context, watch) && watch.accepting && watch.controller === undefined) {
        control(context, watch)
      }
    }, context.tuning.retryMs)

    return
  }

  watch.accepting = false
  tell(watch.socket, !held && reason.includes(TAKEN) ? 'busy' : 'released')
  observe(context, watch)
}

const control = (context: Context, watch: Watching): void => {
  const stream = openStream('control', watch.pane, watch.grid, {
    frame: (frame) => {
      if (watch.controller !== stream) {
        return
      }

      if (!watch.held) {
        watch.held = true
        watch.retried = false
        stopObserver(watch)

        if (watch.accepting) {
          tell(watch.socket, 'held')
        }
      }

      send(watch.socket, { kind: 'frame', hero: watch.hero, alive: true, ...frame })
    },
    closed: (reason) => {
      if (watch.controller === stream) {
        controlClosed(context, watch, reason)
      }
    },
  })
  watch.controller = stream
}

const release = (watch: Watching): void => {
  stopLinger(watch)
  watch.accepting = false
  watch.controller?.stop()
}

const refresh = async (context: Context, watch: Watching): Promise<void> => {
  const record = context.world.live.get(watch.hero)

  if (record === undefined || record.pane === '') {
    release(watch)
    fall(watch)

    return
  }

  watch.fallen = false

  if (watch.controller !== undefined) {
    return
  }

  const grid = await readGrid(record.pane, context.tuning.scrollbarCols)

  if (grid === undefined || !live(context, watch) || watch.controller !== undefined) {
    return
  }

  const moved = record.pane !== watch.pane || grid.cols !== watch.cols || grid.rows !== watch.rows

  if (moved || (watch.observer === undefined && Date.now() >= watch.restartAt)) {
    watch.pane = record.pane
    watch.cols = grid.cols
    watch.rows = grid.rows
    observe(context, watch)
  }
}

const drop = (context: Context, socket: Peer): void => {
  const watch = context.watching.get(socket)

  if (watch !== undefined) {
    context.watching.delete(socket)
    clearInterval(watch.timer)
    release(watch)
    stopObserver(watch)
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
    observer: undefined,
    controller: undefined,
    grid: { cols: 0, rows: 0 },
    held: false,
    accepting: false,
    retried: false,
    linger: undefined,
    timer: undefined,
    polling: false,
    fallen: false,
    restartAt: 0,
  }

  const tick = (): void => {
    if (state.polling) {
      return
    }

    state.polling = true
    refresh(context, state)
      .catch(() => undefined)
      .finally(() => {
        state.polling = false
      })
  }

  state.timer = setInterval(tick, context.tuning.layoutMs)
  context.watching.set(socket, state)
  tick()
}

const resize = (watching: Watching, asked: Grid): void => {
  const grid = capped(watching, asked)

  if (grid.cols !== watching.grid.cols || grid.rows !== watching.grid.rows) {
    watching.grid = grid
    watching.controller?.write({ type: 'terminal.resize', ...grid })
  }
}

const focus = (context: Context, watching: Watching, asked: Grid): void => {
  if (watching.pane === '' || watching.fallen || watching.cols === 0) {
    return
  }

  stopLinger(watching)
  watching.accepting = true

  if (watching.controller === undefined) {
    watching.grid = capped(watching, asked)
    watching.retried = false
    control(context, watching)

    return
  }

  resize(watching, asked)

  if (watching.held) {
    tell(watching.socket, 'held')
  }
}

const blur = (context: Context, watching: Watching): void => {
  watching.accepting = false

  if (watching.controller !== undefined && watching.linger === undefined) {
    watching.linger = setTimeout(() => {
      watching.linger = undefined

      if (!watching.accepting) {
        release(watching)
      }
    }, context.tuning.lingerMs)
  }
}

const steer = (context: Context, socket: Peer, message: ClientMessage): void => {
  const watching = context.watching.get(socket)

  if (watching === undefined) {
    return
  }

  const typing = watching.accepting && watching.held

  if (message.kind === 'focus') {
    focus(context, watching, message)
  } else if (message.kind === 'blur') {
    blur(context, watching)
  } else if (message.kind === 'resize') {
    resize(watching, message)
  } else if (message.kind === 'input' && typing) {
    watching.controller?.write({ type: 'terminal.input', bytes: message.bytes })
  } else if (message.kind === 'scroll' && typing) {
    watching.controller?.write({
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
