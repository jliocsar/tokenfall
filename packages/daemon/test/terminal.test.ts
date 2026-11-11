import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UnixSocketListener } from 'bun'
import { decodeTrusted } from '@tokenfall/protocol/json'
import type { Screen } from '@tokenfall/protocol/terminal'
import { ALLOWED_METHODS, assertAllowed } from '../src/adapters/herdr/client.ts'
import { migrate, openDatabase } from '../src/store/db.ts'
import { MIGRATIONS } from '../src/store/migrations/index.ts'
import { createTerminals, type Peer } from '../src/terminal.ts'
import { createWorld, observe, type World } from '../src/world.ts'

type FakeSocket = {
  readonly sent: Screen[]
  closed: number | undefined
  readonly socket: Peer
}

type Listening = { listener: UnixSocketListener<undefined> | undefined }

type Herdr = {
  readonly methods: string[]
  text: string
}

type Call = {
  readonly id?: string
  readonly method?: string
  readonly params?: { readonly pane_id?: string }
}

const PLOTS = 8
const TUNING = { pollMs: 20, layoutMs: 1000 }
const SETTLE_MS = 120
const COLS = 90
const ROWS = 30

const herdr: Herdr = { methods: [], text: 'hello\nworld' }
const folder = mkdtempSync(join(tmpdir(), 'tokenfall-terminal-'))
const path = join(folder, 'herdr.sock')
const previous = process.env['HERDR_SOCKET_PATH']
const server: Listening = { listener: undefined }

const reply = (call: Call): string => {
  const pane = call.params?.pane_id ?? ''

  if (call.method === 'pane.layout') {
    return JSON.stringify({
      id: call.id,
      result: { layout: { panes: [{ pane_id: pane, rect: { width: COLS, height: ROWS } }] } },
    })
  }

  return JSON.stringify({ id: call.id, result: { read: { text: herdr.text } } })
}

const freshWorld = (): World => {
  const db = openDatabase(':memory:')
  migrate(db, MIGRATIONS, undefined)
  const world = createWorld(db, PLOTS)
  observe(
    world,
    {
      pane: 'w1:p1',
      workspace: 'w1',
      session: 's1',
      guild: '/repo/a',
      title: '',
      quest: 'a quest',
      status: 'working',
    },
    1,
  )

  return world
}

const heroOf = (world: World): string => [...world.live.keys()][0] ?? ''

const fakeSocket = (): FakeSocket => {
  const fake: FakeSocket = {
    sent: [],
    closed: undefined,
    socket: {
      send: (raw: string) => {
        fake.sent.push(decodeTrusted<Screen>(raw))

        return 0
      },
      close: (code: number) => {
        fake.closed = code
      },
    },
  }

  return fake
}

const settle = (): Promise<void> => Bun.sleep(SETTLE_MS)

beforeAll(() => {
  process.env['HERDR_SOCKET_PATH'] = path
  server.listener = Bun.listen({
    unix: path,
    socket: {
      data: (socket, chunk) => {
        for (const line of chunk.toString().split('\n')) {
          if (line.trim() !== '') {
            const call = decodeTrusted<Call>(line)
            herdr.methods.push(call.method ?? '')
            socket.write(`${reply(call)}\n`)
          }
        }
      },
    },
  })
})

afterAll(() => {
  server.listener?.stop(true)
  rmSync(folder, { recursive: true, force: true })

  if (previous === undefined) {
    delete process.env['HERDR_SOCKET_PATH']
  } else {
    process.env['HERDR_SOCKET_PATH'] = previous
  }
})

describe('terminal view', () => {
  test('a watch sends the visible screen at the pane size, once per change', async () => {
    herdr.text = 'hello\nworld'
    const world = freshWorld()
    const terminals = createTerminals(world, TUNING, undefined)
    const fake = fakeSocket()
    const hero = heroOf(world)
    terminals.receive(fake.socket, JSON.stringify({ kind: 'watch', hero }))
    await settle()

    expect(fake.sent).toEqual([
      { kind: 'screen', hero, alive: true, cols: COLS, rows: 2, text: 'hello\nworld' },
    ])

    herdr.text = 'hello\nthere'
    await settle()

    expect(fake.sent.length).toBe(2)
    expect(fake.sent[1]?.text).toBe('hello\nthere')

    terminals.stop()
  })

  test('only the watching socket gets the screen', async () => {
    const world = freshWorld()
    const terminals = createTerminals(world, TUNING, undefined)
    const watcher = fakeSocket()
    const bystander = fakeSocket()
    terminals.receive(watcher.socket, JSON.stringify({ kind: 'watch', hero: heroOf(world) }))
    await settle()

    expect(watcher.sent.length).toBe(1)
    expect(bystander.sent.length).toBe(0)

    terminals.stop()
  })

  test('unwatch and close stop the polling', async () => {
    const world = freshWorld()
    const terminals = createTerminals(world, TUNING, undefined)
    const first = fakeSocket()
    const second = fakeSocket()
    terminals.receive(first.socket, JSON.stringify({ kind: 'watch', hero: heroOf(world) }))
    terminals.receive(second.socket, JSON.stringify({ kind: 'watch', hero: heroOf(world) }))
    await settle()
    terminals.receive(first.socket, JSON.stringify({ kind: 'unwatch' }))
    terminals.drop(second.socket)
    await settle()
    const calls = herdr.methods.length
    herdr.text = 'changed after the close'
    await settle()

    expect(herdr.methods.length).toBe(calls)
    expect(first.sent.length).toBe(1)
    expect(second.sent.length).toBe(1)
  })

  test('a missing Hero gets one fallen screen', async () => {
    const world = freshWorld()
    const terminals = createTerminals(world, TUNING, undefined)
    const fake = fakeSocket()
    terminals.receive(fake.socket, JSON.stringify({ kind: 'watch', hero: 'nobody' }))
    await settle()

    expect(fake.sent).toEqual([
      { kind: 'screen', hero: 'nobody', alive: false, cols: 0, rows: 0, text: '' },
    ])

    terminals.stop()
  })

  test('a bad message closes the socket', () => {
    const world = freshWorld()
    const terminals = createTerminals(world, TUNING, undefined)
    const garbage = fakeSocket()
    const tooLong = fakeSocket()
    terminals.receive(garbage.socket, 'not json')
    terminals.receive(tooLong.socket, JSON.stringify({ kind: 'watch', hero: 'x'.repeat(500) }))

    expect(garbage.closed).toBe(1008)
    expect(tooLong.closed).toBe(1008)
  })

  test('only read methods reach herdr', async () => {
    const world = freshWorld()
    const terminals = createTerminals(world, TUNING, undefined)
    terminals.receive(fakeSocket().socket, JSON.stringify({ kind: 'watch', hero: heroOf(world) }))
    await settle()
    terminals.stop()

    expect(herdr.methods.every((method) => ALLOWED_METHODS.has(method))).toBe(true)
    expect(herdr.methods).toContain('pane.layout')
  })
})

describe('herdr allowlist for the terminal view', () => {
  test('pane.layout passes; writes and focus are refused', () => {
    expect(() => {
      assertAllowed('pane.layout')
    }).not.toThrow()

    for (const method of [
      'pane.send_keys',
      'pane.send_text',
      'pane.focus',
      'tab.focus',
      'agent.prompt',
    ]) {
      expect(() => {
        assertAllowed(method)
      }).toThrow('read-only allowlist')
    }
  })
})
