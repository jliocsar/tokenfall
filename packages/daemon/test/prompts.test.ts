import { describe, expect, test } from 'bun:test'
import { decodeTrusted } from '@tokenfall/protocol/json'
import { MAX_PROMPT, type PromptResult } from '@tokenfall/protocol/terminal'
import {
  ALLOWED_METHODS,
  assertAllowed,
  PROMPT_METHOD,
  request,
  type HerdrMessage,
} from '../src/adapters/herdr/client.ts'
import { createPrompts, type PromptPeer } from '../src/prompts.ts'
import { migrate, openDatabase } from '../src/store/db.ts'
import { MIGRATIONS } from '../src/store/migrations/index.ts'
import { createWorld, observe, type World } from '../src/world.ts'
import type { HeroStatus } from '@tokenfall/protocol/hero'

type Sent = { readonly pane: string; readonly text: string }

type Harness = {
  readonly world: World
  readonly results: PromptResult[]
  readonly sent: Sent[]
  readonly submit: (hero: string, text: string) => void
}

const PLOTS = 8
const SECRET = 'steer toward the parser, not the lexer'

const harness = (status: HeroStatus, answer: () => Promise<HerdrMessage>): Harness => {
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
      status,
    },
    1,
  )
  const results: PromptResult[] = []
  const sent: Sent[] = []
  const peer: PromptPeer = {
    send: (raw) => {
      results.push(decodeTrusted<PromptResult>(raw))

      return 0
    },
  }
  const prompts = createPrompts(world, (pane, text) => {
    sent.push({ pane, text })

    return answer()
  })
  const counter = { next: 0 }

  return {
    world,
    results,
    sent,
    submit: (hero, text) => {
      counter.next += 1
      prompts.submit(peer, { kind: 'prompt', hero, id: counter.next, text })
    },
  }
}

const heroOf = (world: World): string => [...world.live.keys()][0] ?? ''

const ok = (): Promise<HerdrMessage> => Promise.resolve({ id: 'x', result: {} })

describe('prompt box', () => {
  test('a typed prompt goes to the Hero pane through agent.prompt and reports sent', async () => {
    const run = harness('working', ok)
    run.submit(heroOf(run.world), SECRET)
    await Bun.sleep(10)

    expect(run.sent).toEqual([{ pane: 'w1:p1', text: SECRET }])
    expect(run.results).toEqual([{ kind: 'prompt.result', id: 1, outcome: 'sent' }])
  })

  test('unknown Heroes, empty and oversized prompts are refused without a send', async () => {
    const run = harness('idle', ok)
    run.submit('nobody', 'hi')
    run.submit(heroOf(run.world), '   ')
    run.submit(heroOf(run.world), 'x'.repeat(MAX_PROMPT + 1))
    await Bun.sleep(10)

    expect(run.sent).toEqual([])
    expect(run.results.map((result) => result.outcome)).toEqual(['gone', 'refused', 'refused'])
  })

  test('a blocked Hero is not prompted', async () => {
    const run = harness('blocked', ok)
    run.submit(heroOf(run.world), 'go on')
    await Bun.sleep(10)

    expect(run.sent).toEqual([])
    expect(run.results[0]?.outcome).toBe('blocked')
  })

  test('Herdr errors map to outcomes', async () => {
    const blocked = harness('idle', () =>
      Promise.resolve({ id: 'x', error: { code: 'agent_blocked' } }),
    )
    blocked.submit(heroOf(blocked.world), 'a')
    const failing = harness('idle', () => Promise.reject(new Error('socket gone')))
    failing.submit(heroOf(failing.world), 'b')
    await Bun.sleep(10)

    expect(blocked.results[0]?.outcome).toBe('blocked')
    expect(failing.results[0]?.outcome).toBe('error')
  })

  test('the prompt text is never saved', async () => {
    const run = harness('working', ok)
    run.submit(heroOf(run.world), SECRET)
    await Bun.sleep(10)
    const tables = run.world.db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
    const saved = tables
      .flatMap((table) => run.world.db.query(`SELECT * FROM "${table.name}"`).all())
      .map((row) => JSON.stringify(row))
      .join('\n')

    expect(saved).not.toContain(SECRET)
  })
})

describe('the one write path', () => {
  test('agent.prompt stays off the read-only allowlist', () => {
    expect(ALLOWED_METHODS.has(PROMPT_METHOD)).toBe(false)
    expect(() => {
      assertAllowed(PROMPT_METHOD)
    }).toThrow()
    expect(() => request(PROMPT_METHOD, { target: 'w1:p1', text: 'x' })).toThrow()
  })
})
