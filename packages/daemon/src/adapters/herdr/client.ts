import { connect, type Socket } from 'node:net'
import { decodeTrusted } from '@tokenfall/protocol/json'

export type HerdrStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown'

export type HerdrSession = { readonly agent?: string; readonly value: string }

export type HerdrAgent = {
  readonly pane_id: string
  readonly workspace_id: string
  readonly agent?: string | null
  readonly agent_status: HerdrStatus
  readonly agent_session?: HerdrSession | null
  readonly name?: string | null
  readonly cwd?: string | null
  readonly terminal_title_stripped?: string | null
  readonly tokens?: Readonly<Record<string, string>>
}

export type HerdrPane = Omit<HerdrAgent, 'name'>

export type HerdrData = {
  readonly pane_id?: string
  readonly previous_pane_id?: string
  readonly agent_status?: HerdrStatus
  readonly agent?: string | null
  readonly released?: boolean
  readonly pane?: HerdrPane
}

export type HerdrMessage = {
  readonly id?: string
  readonly event?: string
  readonly type?: string
  readonly data?: HerdrData
  readonly result?: { readonly agents?: readonly HerdrAgent[] }
  readonly error?: { readonly code?: string; readonly message?: string }
}

export type HerdrSubscription = { readonly type: string; readonly pane_id?: string }

export type HerdrParams = {
  readonly subscriptions?: readonly HerdrSubscription[]
  readonly pane_id?: string
  readonly source?: string
  readonly format?: string
  readonly lines?: number
}

export type Line = (raw: string, message: HerdrMessage) => void

export type Subscription = {
  readonly ready: Promise<HerdrMessage>
  readonly close: () => void
}

export type SubscribeOptions = {
  readonly onClose?: () => void
}

export const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  'events.subscribe',
  'agent.list',
  'pane.read',
  'pane.get',
  'pane.list',
])

const ALIASES = new Map([
  ['pane_closed', 'pane.closed'],
  ['pane_exited', 'pane.exited'],
  ['pane_created', 'pane.created'],
  ['pane_updated', 'pane.updated'],
  ['pane_moved', 'pane.moved'],
  ['pane_agent_detected', 'pane.agent_detected'],
  ['pane_agent_status_changed', 'pane.agent_status_changed'],
  ['workspace_focused', 'workspace.focused'],
  ['tab_focused', 'tab.focused'],
  ['pane_focused', 'pane.focused'],
])

const REQUEST_TIMEOUT_MS = 5000

const ids = { next: 0 }

const nextId = (): string => {
  ids.next += 1

  return `tokenfall-${ids.next}`
}

export const herdrSocketPath = (): string =>
  process.env['HERDR_SOCKET_PATH'] ?? `${process.env['HOME'] ?? ''}/.config/herdr/herdr.sock`

export const assertAllowed = (method: string): void => {
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error(`herdr method ${method} is not on the read-only allowlist`)
  }
}

const open = (onLine: Line): Socket => {
  const socket = connect(herdrSocketPath())
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

const send = (socket: Socket, id: string, method: string, params: HerdrParams): void => {
  assertAllowed(method)
  socket.write(`${JSON.stringify({ id, method, params })}\n`)
}

export const request = (method: string, params: HerdrParams): Promise<HerdrMessage> => {
  assertAllowed(method)

  return new Promise((resolve, reject) => {
    const id = nextId()
    const socket = open((_raw, message) => {
      if (message.id === id) {
        clearTimeout(timer)
        socket.destroy()
        resolve(message)
      }
    })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`herdr ${method} timed out`))
    }, REQUEST_TIMEOUT_MS)
    socket.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    send(socket, id, method, params)
  })
}

export const subscribe = (
  subscriptions: readonly HerdrSubscription[],
  onLine: Line,
  options: SubscribeOptions = {},
): Subscription => {
  const id = nextId()
  const state = { closing: false }
  let socket: Socket | undefined = undefined
  const ready = new Promise<HerdrMessage>((resolve, reject) => {
    socket = open((raw, message) => {
      if (message.id !== id) {
        onLine(raw, message)
      } else if (message.error === undefined) {
        resolve(message)
      } else {
        reject(new Error(message.error.message ?? 'herdr refused the subscription'))
      }
    })
    socket.on('error', reject)
    socket.on('close', () => {
      reject(new Error('herdr closed the subscription'))

      if (!state.closing) {
        options.onClose?.()
      }
    })
    send(socket, id, 'events.subscribe', { subscriptions })
  })
  ready.catch(() => undefined)

  return {
    ready,
    close: () => {
      state.closing = true
      socket?.destroy()
    },
  }
}

export const eventName = (message: HerdrMessage): string => {
  const name = message.event ?? message.type ?? ''

  return ALIASES.get(name) ?? name
}
