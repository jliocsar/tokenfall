import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HeroEvent } from '@tokenfall/protocol/events'
import { handleHook, readHook, type Hook } from '../src/adapters/hooks/handle.ts'
import { startHooks } from '../src/adapters/hooks/server.ts'
import type { Config } from '../src/config.ts'
import { migrate, openDatabase } from '../src/store/db.ts'
import { MIGRATIONS } from '../src/store/migrations/index.ts'
import { createWorld, flushTools, observe, type Observed, type World } from '../src/world.ts'

const SEND = join(import.meta.dirname, '..', '..', '..', 'plugin', 'hooks', 'send.sh')

const freshWorld = (): World => {
  const db = openDatabase(':memory:')
  migrate(db, MIGRATIONS, undefined)

  return createWorld(db, 8)
}

const seen = (pane: string, session: string | null): Observed => ({
  pane,
  workspace: 'w1',
  session,
  guild: '/repo/a',
  title: '',
  quest: 'q',
  status: 'working',
})

const hook = (event: string, session: string, extra: Partial<Hook> = {}): Hook => ({
  event,
  session,
  tool: undefined,
  agent: undefined,
  source: undefined,
  reason: undefined,
  ...extra,
})

const drain = (world: World): HeroEvent[] => world.outbox.splice(0)

const kinds = (events: readonly HeroEvent[]): string[] => events.map((event) => event.kind)

describe('hook events', () => {
  test('SessionStart turns the Stranger in its pane into a Hero', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', null), 1)
    handleHook(world, hook('SessionStart', 's1', { source: 'startup' }), 'w1:p1', 2)

    expect(kinds(drain(world))).toEqual(['hero.joined', 'hero.linked'])
    expect(world.paneHero.get('w1:p1')).toBe('local/session/s1')
  })

  test('SessionStart before Herdr sees the pane names the Hero on first sight', () => {
    const world = freshWorld()
    handleHook(world, hook('SessionStart', 's1'), 'w1:p1', 1)
    observe(world, seen('w1:p1', null), 2)

    expect(world.live.has('local/session/s1')).toBe(true)
  })

  test('/clear kills the old Hero and a stale Herdr report does not bring it back', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    handleHook(world, hook('SessionEnd', 's1', { reason: 'clear' }), 'w1:p1', 2)
    observe(world, seen('w1:p1', 's1'), 3)
    handleHook(world, hook('SessionStart', 's2', { source: 'clear' }), 'w1:p1', 4)
    const events = drain(world)

    expect(events[1]).toMatchObject({ kind: 'hero.died', cause: 'cleared' })
    expect(world.live.has('local/session/s1')).toBe(false)
    expect(world.paneHero.get('w1:p1')).toBe('local/session/s2')
  })

  test('SessionEnd for a resume is not a Death', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    handleHook(world, hook('SessionEnd', 's1', { reason: 'resume' }), 'w1:p1', 2)

    expect(world.live.has('local/session/s1')).toBe(true)
  })

  test('tool names coalesce to the latest per Hero and skip Subagents', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    drain(world)
    handleHook(world, hook('PreToolUse', 's1', { tool: 'Read' }), 'w1:p1', 2)
    handleHook(world, hook('PreToolUse', 's1', { tool: 'Edit' }), 'w1:p1', 3)
    handleHook(world, hook('PreToolUse', 's1', { tool: 'Bash', agent: 'a1' }), 'w1:p1', 4)
    flushTools(world, 5)

    expect(drain(world)).toEqual([
      { kind: 'hero.tool', at: 5, hero: 'local/session/s1', tool: 'Edit' },
    ])
  })

  test('Subagents are counted as Minions', () => {
    const world = freshWorld()
    observe(world, seen('w1:p1', 's1'), 1)
    drain(world)
    handleHook(world, hook('SubagentStart', 's1', { agent: 'a1' }), 'w1:p1', 2)
    handleHook(world, hook('SubagentStart', 's1', { agent: 'a2' }), 'w1:p1', 3)
    handleHook(world, hook('SubagentStop', 's1', { agent: 'a1' }), 'w1:p1', 4)

    expect(
      drain(world).map((event) => (event.kind === 'hero.minions' ? event.minions : -1)),
    ).toEqual([1, 2, 1])
  })

  test('payloads keep only the fields we read', () => {
    const read = readHook(
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 's1',
        tool_name: 'Write',
        tool_input: { content: 'secret' },
      }),
    )

    expect(read).toEqual(hook('PreToolUse', 's1', { tool: 'Write' }))
    expect(readHook('not json')).toBeUndefined()
  })
})

describe('hook socket', () => {
  test('the plugin script delivers to every daemon socket', async () => {
    const runtime = await mkdtemp(join(tmpdir(), 'tokenfall-hooks-'))
    const world = freshWorld()
    const config: Config = {
      dev: true,
      port: 0,
      stateDir: runtime,
      runtimeDir: join(runtime, 'tokenfall'),
      instance: 'dev',
      distDir: runtime,
      origins: [],
      claudeDirs: [],
    }
    const hooks = startHooks(world, config)
    const child = Bun.spawn(['sh', SEND], {
      env: { ...process.env, XDG_RUNTIME_DIR: runtime, HERDR_PANE_ID: 'w1:p1' },
      stdin: new Blob([JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's9' })]),
    })

    expect(await child.exited).toBe(0)
    expect(world.hookSessions.get('w1:p1')).toBe('s9')

    hooks.stop()
  })

  test('the plugin script exits cleanly with no daemon', async () => {
    const runtime = await mkdtemp(join(tmpdir(), 'tokenfall-hooks-'))
    const child = Bun.spawn(['sh', SEND], {
      env: { ...process.env, XDG_RUNTIME_DIR: runtime },
      stdin: new Blob(['{}']),
    })

    expect(await child.exited).toBe(0)
  })
})
