import { decodeTrusted } from '@tokenfall/protocol/json'
import { MAX_HERO_ID, type ClientMessage, type Frame } from '@tokenfall/protocol/terminal'
import type { Prompts } from './prompts.ts'
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
  readonly id?: number
  readonly text?: string
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
  readonly prompts: Prompts | undefined
}

type Size = { readonly cols: number; readonly rows: number }

const POLICY_VIOLATION = 1008

const decode = (raw: string): ClientMessage | undefined => {
  try {
    const wire = decodeTrusted<Wire | null>(raw)

    if (wire?.kind === 'unwatch') {
      return { kind: 'unwatch' }
    }

    const hero = wire?.hero

    if (hero === undefined || hero.length > MAX_HERO_ID) {
      return undefined
    }

    if (wire?.kind === 'prompt') {
      return wire.id !== undefined && Number.isSafeInteger(wire.id) && wire.text !== undefined
        ? { kind: 'prompt', hero, id: wire.id, text: wire.text }
        : undefined
    }

    return wire?.kind === 'watch' ? { kind: 'watch', hero } : undefined
  } catch {
    return undefined
  }
}

const send = (socket: Peer, frame: Frame): void => {
  socket.send(JSON.stringify(frame))
}

const readLayout = async (pane: string): Promise<Size | undefined> => {
  const reply = await request('pane.layout', { pane_id: pane })
  const rect = reply.result?.layout?.panes?.find((entry) => entry.pane_id === pane)?.rect

  return rect === undefined || rect.width < 1 || rect.height < 1
    ? undefined
    : { cols: rect.width, rows: rect.height }
}

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

const startStream = (context: Context, watch: Watching): void => {
  watch.stream = openStream(
    'observe',
    watch.pane,
    { cols: watch.cols, rows: watch.rows },
    {
      frame: (frame) => {
        send(watch.socket, { kind: 'frame', hero: watch.hero, alive: true, ...frame })
      },
      closed: () => {
        watch.stream = undefined
        watch.restartAt = Date.now() + context.tuning.restartMs
      },
    },
  )
}

const refresh = async (context: Context, watch: Watching): Promise<void> => {
  const record = context.world.live.get(watch.hero)

  if (record === undefined || record.pane === '') {
    fall(watch)

    return
  }

  watch.fallen = false
  const size = await readLayout(record.pane)

  if (size === undefined || context.watching.get(watch.socket) !== watch) {
    return
  }

  const moved = record.pane !== watch.pane || size.cols !== watch.cols || size.rows !== watch.rows

  if (moved || (watch.stream === undefined && Date.now() >= watch.restartAt)) {
    stopStream(watch)
    watch.pane = record.pane
    watch.cols = size.cols
    watch.rows = size.rows
    startStream(context, watch)
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

export const createTerminals = (
  world: World,
  tuning: DaemonTuning['terminal'],
  prompts: Prompts | undefined,
): Terminals => {
  const context: Context = { world, tuning, watching: new Map(), prompts }

  return {
    receive: (socket, raw) => {
      const message = decode(String(raw))

      if (message === undefined) {
        drop(context, socket)
        socket.close(POLICY_VIOLATION, 'bad message')
      } else if (message.kind === 'unwatch') {
        drop(context, socket)
      } else if (message.kind === 'prompt') {
        context.prompts?.submit(socket, message)
      } else {
        watch(context, socket, message.hero)
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
