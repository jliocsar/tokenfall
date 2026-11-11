import type { ChronicleLine } from '@tokenfall/protocol/chronicle'
import type { HeroEvent } from '@tokenfall/protocol/events'
import type { InboxState } from '@tokenfall/protocol/inbox'
import type { ClientMessage, ControlState, Frame } from '@tokenfall/protocol/terminal'
import { decodeTrusted } from '@tokenfall/protocol/json'
import type { ServerMessage } from '@tokenfall/protocol/wire'
import { createSynthetic } from '@tokenfall/replay/synthetic'
import type { Steer } from '../features/sheet/model.ts'

export type Source = {
  readonly label: string
  readonly ready: Promise<number>
  readonly poll: (now: number, out: HeroEvent[]) => void
  readonly close: () => void
  readonly watch?: (hero: string | null) => void
  readonly steer?: Steer
}

type DaemonState = {
  connected: boolean
  closed: boolean
  socket: WebSocket | undefined
  watching: string | null
}

export type ChronicleSink = (lines: readonly ChronicleLine[]) => void

export type InboxSink = (state: InboxState) => void

export type FrameSink = (frame: Frame) => void

export type ControlSink = (state: ControlState) => void

export type Sinks = {
  readonly chronicle: ChronicleSink
  readonly inbox: InboxSink
  readonly frame: FrameSink
  readonly control: ControlSink
}

export type SyntheticSettings = {
  readonly heroes: number
  readonly seed: number
  readonly tempo: number
  readonly deaths: boolean
  readonly combat: boolean
}

const FEED_EVERY_MS = 100
const RETRY_MS = 2000
const TOKEN_META = 'tokenfall-token'
const HEROES_PER_GUILD = 12
const WORKSPACES_PER_GUILD = 3

export const syntheticSource = (settings: SyntheticSettings, now: number): Source => {
  const synthetic = createSynthetic({
    seed: settings.seed,
    heroes: settings.heroes,
    guilds: Math.max(1, Math.round(settings.heroes / HEROES_PER_GUILD)),
    workspacesPerGuild: WORKSPACES_PER_GUILD,
    tempo: settings.tempo,
    deaths: settings.deaths,
    combat: settings.combat,
    startAt: now,
  })
  const state = { joined: false, nextFeed: now }

  return {
    label: `synthetic ${settings.heroes}`,
    ready: Promise.resolve(settings.seed),
    poll: (at, out) => {
      if (!state.joined) {
        state.joined = true

        for (const hero of synthetic.heroes) {
          out.push({ kind: 'hero.joined', at, hero })
        }
      }

      if (at < state.nextFeed) {
        return
      }

      state.nextFeed = at + FEED_EVERY_MS
      synthetic.step(at, out)
    },
    close: () => undefined,
  }
}

const receive = (pending: HeroEvent[], message: ServerMessage): void => {
  if (message.kind === 'frame' || message.kind === 'control') {
    return
  }

  if (message.kind === 'snapshot') {
    for (const hero of message.heroes) {
      pending.push({ kind: 'hero.joined', at: message.at, hero })
    }

    return
  }

  pending.push(...message.events)
}

const drain = (pending: HeroEvent[], out: HeroEvent[]): void => {
  for (const event of pending) {
    out.push(event)
  }

  pending.length = 0
}

export const daemonUrl = (): string => {
  const token = document.querySelector<HTMLMetaElement>(`meta[name="${TOKEN_META}"]`)?.content ?? ''
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'

  return `${scheme}://${window.location.host}/ws?token=${encodeURIComponent(token)}`
}

const sendTo = (socket: WebSocket | undefined, message: ClientMessage): void => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message))
  }
}

const watchMessage = (hero: string | null): ClientMessage =>
  hero === null ? { kind: 'unwatch' } : { kind: 'watch', hero }

export const daemonSource = (url: string, sinks: Sinks): Source => {
  const pending: HeroEvent[] = []
  const state: DaemonState = {
    connected: false,
    closed: false,
    socket: undefined,
    watching: null,
  }
  const seed = Promise.withResolvers<number>()

  const open = (): void => {
    const socket = new WebSocket(url)
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      const message = decodeTrusted<ServerMessage>(event.data)

      if (message.kind === 'frame') {
        sinks.frame(message)

        return
      }

      if (message.kind === 'control') {
        sinks.control(message.state)

        return
      }

      if (message.kind === 'snapshot' && state.connected) {
        window.location.reload()

        return
      }

      if (message.kind === 'snapshot') {
        state.connected = true
        seed.resolve(message.townSeed)
      }

      receive(pending, message)
      sinks.chronicle(message.chronicle)

      if (message.inbox !== undefined) {
        sinks.inbox(message.inbox)
      }
    })
    socket.addEventListener('open', () => {
      if (state.watching !== null) {
        sendTo(socket, watchMessage(state.watching))
      }
    })
    socket.addEventListener('close', () => {
      if (!state.closed) {
        setTimeout(open, RETRY_MS)
      }
    })
    state.socket = socket
  }

  open()

  return {
    label: 'live',
    ready: seed.promise,
    poll: (_now, out) => {
      drain(pending, out)
    },
    close: () => {
      state.closed = true
      state.socket?.close()
    },
    watch: (hero) => {
      state.watching = hero
      sendTo(state.socket, watchMessage(hero))
    },
    steer: (message) => {
      sendTo(state.socket, message)
    },
  }
}

export const replaySource = (url: string): Source => {
  const pending: HeroEvent[] = []
  const seed = Promise.withResolvers<number>()
  const socket = new WebSocket(url)
  socket.addEventListener('message', (event: MessageEvent<string>) => {
    const message = decodeTrusted<ServerMessage>(event.data)

    if (message.kind === 'snapshot') {
      seed.resolve(message.townSeed)
    }

    receive(pending, message)
  })

  return {
    label: `replay ${url}`,
    ready: seed.promise,
    poll: (_now, out) => {
      for (const event of pending) {
        out.push(event)
      }

      pending.length = 0
    },
    close: () => {
      socket.close()
    },
  }
}
