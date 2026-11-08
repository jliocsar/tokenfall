import type { HeroEvent } from '@tokenfall/protocol/events'
import { decodeTrusted } from '@tokenfall/protocol/json'
import type { ServerMessage } from '@tokenfall/protocol/wire'
import { createSynthetic } from '@tokenfall/replay/synthetic'

export type Source = {
  readonly label: string
  readonly ready: Promise<number>
  readonly poll: (now: number, out: HeroEvent[]) => void
  readonly close: () => void
}

type DaemonState = {
  connected: boolean
  closed: boolean
  socket: WebSocket | undefined
}

export type SyntheticSettings = {
  readonly heroes: number
  readonly seed: number
  readonly tempo: number
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

export const daemonSource = (url: string): Source => {
  const pending: HeroEvent[] = []
  const state: DaemonState = { connected: false, closed: false, socket: undefined }
  const seed = Promise.withResolvers<number>()

  const open = (): void => {
    const socket = new WebSocket(url)
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      const message = decodeTrusted<ServerMessage>(event.data)

      if (message.kind === 'snapshot' && state.connected) {
        window.location.reload()

        return
      }

      if (message.kind === 'snapshot') {
        state.connected = true
        seed.resolve(message.townSeed)
      }

      receive(pending, message)
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
