import { decodeTrusted } from '@tokenfall/protocol/json'
import { MAX_HERO_ID, type ClientMessage, type Screen } from '@tokenfall/protocol/terminal'
import { request } from './adapters/herdr/client.ts'
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

type Wire = { readonly kind?: string; readonly hero?: string }

type Watching = {
  readonly hero: string
  timer: ReturnType<typeof setInterval> | undefined
  busy: boolean
  hash: bigint | number
  cols: number
  rows: number
  nextLayout: number
  fallen: boolean
}

type Context = {
  readonly world: World
  readonly tuning: DaemonTuning['terminal']
  readonly watching: Map<Peer, Watching>
}

const POLICY_VIOLATION = 1008
const NEWLINE = '\n'

const decode = (raw: string): ClientMessage | undefined => {
  try {
    const wire = decodeTrusted<Wire | null>(raw)

    if (wire?.kind === 'unwatch') {
      return { kind: 'unwatch' }
    }

    const hero = wire?.hero

    return wire?.kind === 'watch' && hero !== undefined && hero.length <= MAX_HERO_ID
      ? { kind: 'watch', hero }
      : undefined
  } catch {
    return undefined
  }
}

const send = (socket: Peer, screen: Screen): void => {
  socket.send(JSON.stringify(screen))
}

const rowsOf = (text: string): number => {
  let rows = 1

  for (let at = text.indexOf(NEWLINE); at !== -1; at = text.indexOf(NEWLINE, at + 1)) {
    rows += 1
  }

  return rows
}

const readLayout = async (watch: Watching, pane: string): Promise<void> => {
  const reply = await request('pane.layout', { pane_id: pane })
  const rect = reply.result?.layout?.panes?.find((entry) => entry.pane_id === pane)?.rect

  if (rect !== undefined) {
    watch.cols = rect.width
    watch.rows = Math.max(watch.rows, rect.height)
  }
}

const fall = (socket: Peer, watch: Watching): void => {
  if (!watch.fallen) {
    watch.fallen = true
    send(socket, { kind: 'screen', hero: watch.hero, alive: false, cols: 0, rows: 0, text: '' })
  }
}

const poll = async (context: Context, socket: Peer, watch: Watching): Promise<void> => {
  const record = context.world.live.get(watch.hero)

  if (record === undefined || record.pane === '') {
    fall(socket, watch)

    return
  }

  watch.fallen = false

  if (Date.now() >= watch.nextLayout) {
    watch.nextLayout = Date.now() + context.tuning.layoutMs
    await readLayout(watch, record.pane)
  }

  const reply = await request('pane.read', {
    pane_id: record.pane,
    source: 'visible',
    format: 'ansi',
  })
  const text = reply.result?.read?.text ?? ''
  const lines = rowsOf(text)
  const rows = watch.rows === 0 ? lines : Math.min(watch.rows, lines)
  const hash = Bun.hash(`${watch.cols}x${rows}:${text}`)

  if (hash !== watch.hash && context.watching.get(socket) === watch) {
    watch.hash = hash
    send(socket, { kind: 'screen', hero: watch.hero, alive: true, cols: watch.cols, rows, text })
  }
}

const drop = (context: Context, socket: Peer): void => {
  const watch = context.watching.get(socket)

  if (watch !== undefined) {
    clearInterval(watch.timer)
    context.watching.delete(socket)
  }
}

const watch = (context: Context, socket: Peer, hero: string): void => {
  drop(context, socket)
  const state: Watching = {
    hero,
    timer: undefined,
    busy: false,
    hash: 0,
    cols: 0,
    rows: 0,
    nextLayout: 0,
    fallen: false,
  }

  const tick = (): void => {
    if (state.busy) {
      return
    }

    state.busy = true
    poll(context, socket, state)
      .catch(() => undefined)
      .finally(() => {
        state.busy = false
      })
  }

  state.timer = setInterval(tick, context.tuning.pollMs)
  context.watching.set(socket, state)
  tick()
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
