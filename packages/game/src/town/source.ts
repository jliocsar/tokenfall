import type { HeroEvent } from '@tokenfall/protocol/events'
import { decodeTrusted } from '@tokenfall/protocol/json'
import type { ServerMessage } from '@tokenfall/protocol/wire'
import { createSynthetic } from '@tokenfall/replay/synthetic'

export type Source = {
  readonly label: string
  readonly poll: (now: number, out: HeroEvent[]) => void
  readonly close: () => void
}

export type SyntheticSettings = {
  readonly heroes: number
  readonly seed: number
  readonly tempo: number
}

const FEED_EVERY_MS = 100
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

export const replaySource = (url: string): Source => {
  const pending: HeroEvent[] = []
  const socket = new WebSocket(url)
  socket.addEventListener('message', (event: MessageEvent<string>) => {
    receive(pending, decodeTrusted<ServerMessage>(event.data))
  })

  return {
    label: `replay ${url}`,
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
