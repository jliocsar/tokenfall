import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UnixSocketListener } from 'bun'
import { decodeTrusted } from '@tokenfall/protocol/json'
import type { ClientMessage, Control, Frame } from '@tokenfall/protocol/terminal'
import { ALLOWED_METHODS, assertAllowed } from '../src/adapters/herdr/client.ts'
import { HERDR_ENV } from '../src/adapters/herdr/stream.ts'
import { migrate, openDatabase } from '../src/store/db.ts'
import { MIGRATIONS } from '../src/store/migrations/index.ts'
import { createTerminals, type Peer } from '../src/terminal.ts'
import { createWorld, observe, type World } from '../src/world.ts'

type Sent = Frame | Control

type Watched = {
  readonly world: World
  readonly peer: FakeSocket
  readonly stop: () => void
  readonly send: (message: ClientMessage) => void
}

type FakeSocket = {
  readonly sent: Sent[]
  closed: number | undefined
  readonly socket: Peer
}

type Listening = { listener: UnixSocketListener<undefined> | undefined }

type Herdr = {
  readonly methods: string[]
  cols: number
  rows: number
  inner: number | undefined
}

type Call = {
  readonly id?: string
  readonly method?: string
  readonly params?: { readonly pane_id?: string }
}

type Spawned = { readonly args: readonly string[]; readonly pid: number }

const PLOTS = 8
const TUNING = { layoutMs: 60, restartMs: 60, lingerMs: 300, retryMs: 30, scrollbarCols: 0 }
const SETTLE_MS = 400
const HELLO = Buffer.from('hello').toString('base64')

const herdr: Herdr = { methods: [], cols: 90, rows: 30, inner: undefined }
const folder = mkdtempSync(join(tmpdir(), 'tokenfall-terminal-'))
const path = join(folder, 'herdr.sock')
const fake = join(folder, 'herdr')
const log = join(folder, 'spawned.log')
const typed = join(folder, 'stdin.log')
const busyFlag = join(folder, 'busy')
const previous = { socket: process.env['HERDR_SOCKET_PATH'], herdr: process.env[HERDR_ENV] }
const server: Listening = { listener: undefined }

const FAKE_HERDR = `#!${process.execPath}
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, pid: process.pid }) + '\\n')
const at = (flag) => Number(args[args.indexOf(flag) + 1])
if (args[2] === 'control' && fs.existsSync(${JSON.stringify(busyFlag)})) {
  console.log(JSON.stringify({ type: 'terminal.closed', reason: 'terminal attach failed: terminal t already has an attached client; retry with --takeover' }))
  process.exit(0)
}
if (args[2] === 'control') {
  process.stdin.on('end', () => process.exit(0))
  process.stdin.on('data', (chunk) => {
    fs.appendFileSync(${JSON.stringify(typed)}, chunk)
    if (String(chunk).includes('terminal.release')) {
      console.log(JSON.stringify({ type: 'terminal.closed', reason: 'detached' }))
      process.exit(0)
    }
  })
}
console.log(JSON.stringify({ type: 'terminal.frame', seq: 1, encoding: 'ansi', width: at('--cols'), height: at('--rows'), full: true, bytes: ${JSON.stringify(HELLO)} }))
setInterval(() => undefined, 1000)
`

const reply = (call: Call): string => {
  const pane = call.params?.pane_id ?? ''

  return JSON.stringify({
    id: call.id,
    result: {
      layout: { panes: [{ pane_id: pane, rect: { width: herdr.cols, height: herdr.rows } }] },
      pane: { scroll: { viewport_rows: herdr.inner ?? herdr.rows } },
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
        peer.sent.push(decodeTrusted<Sent>(raw))

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

const lingered = (): Promise<void> => Bun.sleep(TUNING.lingerMs + SETTLE_MS)

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
  for (const run of spawned()) {
    if (alive(run.pid)) {
      process.kill(run.pid)
    }
  }

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
    const terminals = createTerminals(world, TUNING)
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
    const terminals = createTerminals(world, TUNING)
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
    const terminals = createTerminals(world, TUNING)
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
    const terminals = createTerminals(world, TUNING)
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
    const terminals = createTerminals(world, TUNING)
    const garbage = fakeSocket()
    const tooLong = fakeSocket()
    terminals.receive(garbage.socket, 'not json')
    terminals.receive(tooLong.socket, JSON.stringify({ kind: 'watch', hero: 'x'.repeat(500) }))

    expect(garbage.closed).toBe(1008)
    expect(tooLong.closed).toBe(1008)
  })

  test('only read methods reach the herdr socket, and the CLI never takes over', async () => {
    rmSync(log, { force: true })
    const world = freshWorld()
    const terminals = createTerminals(world, TUNING)
    terminals.receive(fakeSocket().socket, JSON.stringify({ kind: 'watch', hero: heroOf(world) }))
    await settle()
    terminals.stop()

    expect(herdr.methods.every((method) => ALLOWED_METHODS.has(method))).toBe(true)
    expect(herdr.methods).toContain('pane.layout')
    expect(spawned().every((run) => run.args[2] === 'observe' || run.args[2] === 'control')).toBe(
      true,
    )
    expect(spawned().some((run) => run.args.includes('--takeover'))).toBe(false)
  })
})

const watched = async (): Promise<Watched> => {
  const world = freshWorld()
  const terminals = createTerminals(world, TUNING)
  const peer = fakeSocket()
  terminals.receive(peer.socket, JSON.stringify({ kind: 'watch', hero: heroOf(world) }))
  await settle()

  return {
    world,
    peer,
    stop: terminals.stop,
    send: (message: ClientMessage) => {
      terminals.receive(peer.socket, JSON.stringify(message))
    },
  }
}

const states = (peer: FakeSocket): string[] =>
  peer.sent.flatMap((message) => (message.kind === 'control' ? [message.state] : []))

describe('typing into the terminal', () => {
  test('focus takes control no larger than the pane, input and scroll reach Herdr, blur releases after the linger', async () => {
    rmSync(log, { force: true })
    rmSync(typed, { force: true })
    herdr.cols = 90
    herdr.rows = 30
    const run = await watched()
    run.send({ kind: 'focus', cols: 200, rows: 100 })
    await settle()
    run.send({ kind: 'input', bytes: Buffer.from('hi\r').toString('base64') })
    run.send({ kind: 'scroll', direction: 'up', lines: 3 })
    await settle()
    run.send({ kind: 'blur' })
    await lingered()
    run.stop()
    const runs = spawned()
    const commands = readFileSync(typed, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => decodeTrusted<{ type: string }>(line))

    expect(runs.map((entry) => entry.args[2])).toEqual(['observe', 'control', 'observe'])
    expect(runs[1]?.args.slice(4)).toEqual(['--cols', '90', '--rows', '30'])
    expect(commands.map((command) => command.type)).toEqual([
      'terminal.input',
      'terminal.scroll',
      'terminal.release',
    ])
    expect(states(run.peer)).toEqual(['held', 'released'])
  })

  test('a pane another client controls stays watched and reports busy', async () => {
    rmSync(log, { force: true })
    writeFileSync(busyFlag, '')
    const run = await watched()
    run.send({ kind: 'focus', cols: 200, rows: 100 })
    await settle()
    run.stop()
    rmSync(busyFlag, { force: true })

    expect(states(run.peer)).toEqual(['busy'])
    expect(spawned().map((entry) => entry.args[2])).toEqual(['observe', 'control', 'observe'])
  })

  test('input is ignored unless the terminal has focus, and is never saved', async () => {
    rmSync(typed, { force: true })
    const secret = 'steer toward the parser'
    const run = await watched()
    run.send({ kind: 'input', bytes: Buffer.from(secret).toString('base64') })
    await settle()
    run.send({ kind: 'focus', cols: 200, rows: 100 })
    await settle()
    run.send({ kind: 'input', bytes: Buffer.from(secret).toString('base64') })
    await settle()
    run.stop()
    const tables = run.world.db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
    const saved = tables
      .flatMap((table) => run.world.db.query(`SELECT * FROM "${table.name}"`).all())
      .map((row) => JSON.stringify(row))
      .join('\n')

    expect(readFileSync(typed, 'utf8').split('terminal.input').length).toBe(2)
    expect(saved).not.toContain(secret)
    expect(saved).not.toContain(Buffer.from(secret).toString('base64'))
  })

  test('bad steering messages close the socket', () => {
    const world = freshWorld()
    const terminals = createTerminals(world, TUNING)
    const peers = [fakeSocket(), fakeSocket(), fakeSocket()]
    terminals.receive(peers[0]!.socket, JSON.stringify({ kind: 'input', bytes: '' }))
    terminals.receive(
      peers[1]!.socket,
      JSON.stringify({ kind: 'scroll', direction: 'sideways', lines: 1 }),
    )
    terminals.receive(
      peers[2]!.socket,
      JSON.stringify({ kind: 'scroll', direction: 'up', lines: 9999 }),
    )

    expect(peers.map((peer) => peer.closed)).toEqual([1008, 1008, 1008])
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

describe('resizing while typing', () => {
  test('focus shrinks the pane to the asked grid, resize follows, release observes at the pane size', async () => {
    rmSync(log, { force: true })
    rmSync(typed, { force: true })
    herdr.cols = 233
    herdr.rows = 53
    const run = await watched()
    run.send({ kind: 'focus', cols: 150, rows: 40 })
    await settle()
    run.send({ kind: 'resize', cols: 120, rows: 300 })
    await settle()
    run.send({ kind: 'blur' })
    await lingered()
    run.stop()
    const runs = spawned()
    const commands = readFileSync(typed, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => decodeTrusted<{ type: string; cols?: number; rows?: number }>(line))

    expect(runs.map((entry) => entry.args.slice(2))).toEqual([
      ['observe', 'w1:p1', '--cols', '233', '--rows', '53'],
      ['control', 'w1:p1', '--cols', '150', '--rows', '40'],
      ['observe', 'w1:p1', '--cols', '233', '--rows', '53'],
    ])
    expect(commands).toEqual([
      { type: 'terminal.resize', cols: 120, rows: 53 },
      { type: 'terminal.release' },
    ])
  })

  test('a grid out of range closes the socket', () => {
    const world = freshWorld()
    const terminals = createTerminals(world, TUNING)
    const peers = [fakeSocket(), fakeSocket(), fakeSocket()]
    terminals.receive(peers[0]!.socket, JSON.stringify({ kind: 'focus' }))
    terminals.receive(peers[1]!.socket, JSON.stringify({ kind: 'focus', cols: 0, rows: 10 }))
    terminals.receive(peers[2]!.socket, JSON.stringify({ kind: 'resize', cols: 80, rows: 5000 }))

    expect(peers.map((peer) => peer.closed)).toEqual([1008, 1008, 1008])
  })
})

describe('sticky control', () => {
  test('a quick blur and refocus keep the controller, and keys stop while blurred', async () => {
    rmSync(log, { force: true })
    rmSync(typed, { force: true })
    herdr.cols = 90
    herdr.rows = 30
    const run = await watched()
    run.send({ kind: 'focus', cols: 80, rows: 30 })
    await settle()
    run.send({ kind: 'blur' })
    run.send({ kind: 'input', bytes: Buffer.from('dropped').toString('base64') })
    run.send({ kind: 'focus', cols: 80, rows: 30 })
    await settle()
    run.send({ kind: 'input', bytes: Buffer.from('kept').toString('base64') })
    await settle()
    const runs = spawned()
    run.stop()
    const commands = readFileSync(typed, 'utf8')

    expect(runs.map((entry) => entry.args[2])).toEqual(['observe', 'control'])
    expect(states(run.peer)).toEqual(['held', 'held'])
    expect(commands).toContain(Buffer.from('kept').toString('base64'))
    expect(commands).not.toContain(Buffer.from('dropped').toString('base64'))
  })

  test('closing the sheet releases at once and starts nothing new', async () => {
    rmSync(log, { force: true })
    rmSync(typed, { force: true })
    const run = await watched()
    run.send({ kind: 'focus', cols: 80, rows: 30 })
    await settle()
    run.send({ kind: 'unwatch' })
    await settle()
    const runs = spawned()

    expect(runs.map((entry) => entry.args[2])).toEqual(['observe', 'control'])
    expect(readFileSync(typed, 'utf8')).toContain('terminal.release')
    expect(runs.some((entry) => alive(entry.pid))).toBe(false)
  })

  test('the pane grid leaves out Herdr borders and the scrollbar column', async () => {
    rmSync(log, { force: true })
    herdr.cols = 117
    herdr.rows = 53
    herdr.inner = 51
    const world = freshWorld()
    const terminals = createTerminals(world, { ...TUNING, scrollbarCols: 1 })
    terminals.receive(fakeSocket().socket, JSON.stringify({ kind: 'watch', hero: heroOf(world) }))
    await settle()
    terminals.stop()
    herdr.inner = undefined

    expect(spawned()[0]?.args.slice(4)).toEqual(['--cols', '114', '--rows', '51'])
  })
})
