import { connect } from 'node:net'
import { decodeTrusted } from '@tokenfall/protocol/json'

export type HerdrAgent = {
  readonly pane_id: string
  readonly workspace_id: string
  readonly agent?: string | null
  readonly agent_status: 'idle' | 'working' | 'blocked' | 'done' | 'unknown'
  readonly agent_session?: { readonly value: string } | null
  readonly name?: string | null
  readonly cwd?: string | null
  readonly terminal_title_stripped?: string | null
  readonly tokens?: Readonly<Record<string, string>>
}

export type HerdrData = {
  readonly pane_id?: string
  readonly agent_status?: HerdrAgent['agent_status']
  readonly agent?: string | null
  readonly released?: boolean
}

export type HerdrMessage = {
  readonly id?: string
  readonly event?: string
  readonly type?: string
  readonly data?: HerdrData
  readonly result?: { readonly agents?: readonly HerdrAgent[] }
  readonly error?: { readonly code?: string; readonly message?: string }
}

export type Line = (raw: string, message: HerdrMessage) => void

const ALIASES = new Map([
  ['pane_closed', 'pane.closed'],
  ['pane_exited', 'pane.exited'],
  ['pane_created', 'pane.created'],
  ['pane_agent_detected', 'pane.agent_detected'],
  ['pane_agent_status_changed', 'pane.agent_status_changed'],
])

const ids = { next: 0 }

const socketPath = (): string =>
  process.env['HERDR_SOCKET_PATH'] ?? `${process.env['HOME'] ?? ''}/.config/herdr/herdr.sock`

const open = (onLine: Line) => {
  const socket = connect(socketPath())
  let buffer = ''
  socket.on('data', (chunk) => {
    buffer += chunk.toString()
    let newline = buffer.indexOf('\n')

    while (newline !== -1) {
      const raw = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)

      if (raw.trim() !== '') {
        onLine(raw, decodeTrusted<HerdrMessage>(raw))
      }

      newline = buffer.indexOf('\n')
    }
  })

  return socket
}

export const request = (
  method: string,
  params: Readonly<Record<string, string>>,
): Promise<HerdrMessage> =>
  new Promise((resolve) => {
    const id = `tokenfall-${ids.next}`
    ids.next += 1
    const socket = open((_raw, message) => {
      if (message.id === id) {
        resolve(message)
        socket.destroy()
      }
    })
    socket.write(`${JSON.stringify({ id, method, params })}\n`)
  })

export const subscribe = (
  subscriptions: readonly Readonly<Record<string, string>>[],
  onLine: Line,
): Promise<HerdrMessage> =>
  new Promise((resolve) => {
    const id = `tokenfall-${ids.next}`
    ids.next += 1
    const socket = open((raw, message) => {
      if (message.id === id) {
        resolve(message)
      } else {
        onLine(raw, message)
      }
    })
    socket.write(
      `${JSON.stringify({ id, method: 'events.subscribe', params: { subscriptions } })}\n`,
    )
  })

export const eventName = (message: HerdrMessage): string => {
  const name = message.event ?? message.type ?? ''

  return ALIASES.get(name) ?? name
}
