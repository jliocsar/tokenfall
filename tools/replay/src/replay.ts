import { parseArgs } from 'node:util'
import type { HeroEvent } from '@tokenfall/protocol/events'
import { PROTOCOL_VERSION, type Delta, type Snapshot } from '@tokenfall/protocol/wire'
import type { ServerWebSocket } from 'bun'
import { parseRecording } from './recording.ts'
import { applyEvent, type HeroTable } from './state.ts'

const TICK_MS = 100

const emptyTable = (): HeroTable => new Map()

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    port: { type: 'string', default: '47330' },
    speed: { type: 'string', default: '1' },
    loop: { type: 'boolean', default: false },
    seed: { type: 'string', default: '7' },
  },
})

if (values.file === undefined) {
  console.error(
    'usage: bun tools/replay/src/replay.ts --file recordings/x.jsonl [--speed 4] [--loop]',
  )
  process.exit(2)
}

const recording = parseRecording(await Bun.file(values.file).text())
const speed = Number(values.speed)
const clients = new Set<ServerWebSocket>()
const first = recording.events[0]?.at ?? 0
const state = {
  table: emptyTable(),
  cursor: 0,
  seq: 0,
  clock: first,
}

const snapshot = (): Snapshot => ({
  kind: 'snapshot',
  version: PROTOCOL_VERSION,
  seq: state.seq,
  at: state.clock,
  townSeed: Number(values.seed),
  heroes: [...state.table.values()],
})

setInterval(() => {
  state.clock += TICK_MS * speed
  const events: HeroEvent[] = []

  while (
    state.cursor < recording.events.length &&
    recording.events[state.cursor]!.at <= state.clock
  ) {
    const event = recording.events[state.cursor]!
    applyEvent(state.table, event)
    events.push(event)
    state.cursor += 1
  }

  if (state.cursor >= recording.events.length && values.loop) {
    state.table = emptyTable()
    state.cursor = 0
    state.clock = first
  }

  if (events.length === 0) {
    return
  }

  state.seq += 1
  const delta: Delta = { kind: 'delta', seq: state.seq, at: state.clock, events }
  const message = JSON.stringify(delta)

  for (const client of clients) {
    client.send(message)
  }
}, TICK_MS)

Bun.serve({
  hostname: '127.0.0.1',
  port: Number(values.port),
  fetch: (request, server) =>
    server.upgrade(request) ? undefined : new Response('websocket only', { status: 426 }),
  websocket: {
    open: (socket) => {
      clients.add(socket)
      socket.send(JSON.stringify(snapshot()))
    },
    message: () => undefined,
    close: (socket) => {
      clients.delete(socket)
    },
  },
})

console.log(
  `replaying ${recording.events.length} events from ${values.file} at ${speed}x on ws://127.0.0.1:${values.port}`,
)
