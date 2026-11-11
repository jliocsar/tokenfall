import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UnixSocketListener } from 'bun'
import { decodeTrusted } from '@tokenfall/protocol/json'
import type { Frame } from '@tokenfall/protocol/terminal'
import { ALLOWED_METHODS, assertAllowed } from '../src/adapters/herdr/client.ts'
import { HERDR_ENV } from '../src/adapters/herdr/stream.ts'
import { migrate, openDatabase } from '../src/store/db.ts'
import { MIGRATIONS } from '../src/store/migrations/index.ts'
import { createTerminals, type Peer } from '../src/terminal.ts'
import { createWorld, observe, type World } from '../src/world.ts'

type FakeSocket = {
  readonly sent: Frame[]
  closed: number | undefined
  readonly socket: Peer
}

type Listening = { listener: UnixSocketListener<undefined> | undefined }

type Herdr = {
  readonly methods: string[]
  cols: number
  rows: number
}

type Call = {
  readonly id?: string
  readonly method?: string
  readonly params?: { readonly pane_id?: string }
}

type Spawned = { readonly args: readonly string[]; readonly pid: number }

const PLOTS = 8
const TUNING = { layoutMs: 60, restartMs: 60 }
const SETTLE_MS = 400
const HELLO = Buffer.from('hello').toString('base64')

const herdr: Herdr = { methods: [], cols: 90, rows: 30 }
const folder = mkdtempSync(join(tmpdir(), 'tokenfall-terminal-'))
const path = join(folder, 'herdr.sock')
const fake = join(folder, 'herdr')
const log = join(folder, 'spawned.log')
const previous = { socket: process.env['HERDR_SOCKET_PATH'], herdr: process.env[HERDR_ENV] }
const server: Listening = { listener: undefined }

const FAKE_HERDR = `#!${process.execPath}
const args = process.argv.slice(2)
require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, pid: process.pid }) + '\\n')
const at = (flag) => Number(args[args.indexOf(flag) + 1])
console.log(JSON.stringify({ type: 'terminal.frame', seq: 1, encoding: 'ansi', width: at('--cols'), height: at('--rows'), full: true, bytes: ${JSON.stringify(HELLO)} }))
setInterval(() => undefined, 1000)
`

const reply = (call: Call): string => {
  const pane = call.params?.pane_id ?? ''

  return JSON.stringify({
    id: call.id,
    result: {
      layout: { panes: [{ pane_id: pane, rect: { width: herdr.cols, height: herdr.rows } }] },
    },
  })
}

const spawned = (): Spawned[] => {
  try {
    return readFileSync(log, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => decodeTrusted<Spawned>(line))
  } catch {
    return []
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
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
  const peer: FakeSocket = {
    sent: [],
    closed: undefined,
    socket: {
      send: (raw: string) => {
        peer.sent.push(decodeTrusted<Frame>(raw))

        return 0
      },
      close: (code: number) => {
        peer.closed = code
      },
    },
  }

  return peer
}

const settle = (): Promise<void> => Bun.sleep(SETTLE_MS)

beforeAll(() => {
  process.env['HERDR_SOCKET_PATH'] = path
  process.env[HERDR_ENV] = fake
  writeFileSync(fake, FAKE_HERDR)
  chmodSync(fake, 0o755)
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

  for (const [key, value] of [
    ['HERDR_SOCKET_PATH', previous.socket],
    [HERDR_ENV, previous.herdr],
  ] as const) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('terminal view', () => {
  test('a watch observes the pane at its own size and forwards the frames', async () => {
    rmSync(log, { force: true })
    herdr.cols = 90
    herdr.rows = 30
    const world = freshWorld()
    const terminals = createTerminals(world, TUNING, undefined)
    const peer = fakeSocket()
    const hero = heroOf(world)
    terminals.receive(peer.socket, JSON.stringify({ kind: 'watch', hero }))
    await settle()
    terminals.stop()

    expect(spawned()[0]?.args).toEqual([
      'terminal',
      'session',
      'observe',
      'w1:p1',
      '--cols',
      '90',
      '--rows',
      '30',
    ])
    expect(peer.sent[0]).toEqual({
      kind: 'frame',
      hero,
      alive: true,
      cols: 90,
      rows: 30,
      full: true,
      bytes: HELLO,
    })
  })

  test('a resized pane restarts the observer at the new size', async () => {
    rmSync(log, { force: true })
    herdr.cols = 90
    herdr.rows = 30
    const world = freshWorld()
    const terminals = createTerminals(world, TUNING, undefined)
    terminals.receive(fakeSocket().socket, JSON.stringify({ kind: 'watch', hero: heroOf(world) }))
    await settle()
    herdr.cols = 120
    await settle()
    terminals.stop()
    const runs = spawned()

    expect(runs.length).toBe(2)
    expect(runs[1]?.args).toContain('120')
    expect(alive(runs[0]?.pid ?? 0)).toBe(false)
  })

  test('unwatch and close stop the observer', async () => {
    rmSync(log, { force: true })
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
    const runs = spawned()

    expect(runs.length).toBe(2)
    expect(runs.some((run) => alive(run.pid))).toBe(false)
  })

  test('a missing Hero gets one fallen frame', async () => {
    const world = freshWorld()
    const terminals = createTerminals(world, TUNING, undefined)
    const peer = fakeSocket()
    terminals.receive(peer.socket, JSON.stringify({ kind: 'watch', hero: 'nobody' }))
    await settle()
    terminals.stop()

    expect(peer.sent).toEqual([
      { kind: 'frame', hero: 'nobody', alive: false, cols: 0, rows: 0, full: true, bytes: '' },
    ])
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

  test('only read methods reach the herdr socket, and the CLI only observes', async () => {
    rmSync(log, { force: true })
    const world = freshWorld()
    const terminals = createTerminals(world, TUNING, undefined)
    terminals.receive(fakeSocket().socket, JSON.stringify({ kind: 'watch', hero: heroOf(world) }))
    await settle()
    terminals.stop()

    expect(herdr.methods.every((method) => ALLOWED_METHODS.has(method))).toBe(true)
    expect(herdr.methods).toContain('pane.layout')
    expect(spawned().every((run) => run.args[2] === 'observe')).toBe(true)
    expect(spawned().some((run) => run.args.includes('--takeover'))).toBe(false)
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
