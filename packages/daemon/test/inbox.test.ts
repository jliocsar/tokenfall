import { describe, expect, test } from 'bun:test'
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyMessage,
  applyQuestion,
  createProjectInbox,
  openItems,
  type InboxItem,
  type ProjectInbox,
} from '../src/adapters/inbox/parse.ts'
import { createInboxFeed, startInbox, urlOf } from '../src/adapters/inbox/tracker.ts'
import { syncRavens } from '../src/ravens.ts'
import { migrate, openDatabase } from '../src/store/db.ts'
import { MIGRATIONS } from '../src/store/migrations/index.ts'
import { createWorld, observe, paneGone, type World } from '../src/world.ts'

type Value = string | number | boolean | null | readonly Value[] | Fields

type Fields = { readonly [key: string]: Value }

const ROOT = 'msg_root'
const SESSION = 's1'
const SECRET = 'never-leaves'
const TUNING = { pollMs: 60_000, scanMs: 60_000 }

const line = (seq: number, kind: string, id: string, record: Fields): string =>
  JSON.stringify({ v: 1, seq, at: new Date(seq * 1000).toISOString(), kind, id, record })

const message = (seq: number, id: string, fields: Fields = {}): string =>
  line(seq, 'message', id, {
    id,
    thread_id: ROOT,
    author: { kind: 'agent', host: 'claude-code', session: SESSION },
    body: SECRET,
    resolved_at: null,
    ...fields,
  })

const question = (seq: number, fields: Fields = {}): string =>
  line(seq, 'question', `${ROOT}/q-1`, {
    id: `${ROOT}/q-1`,
    message_id: ROOT,
    kind: 'single',
    prompt: SECRET,
    asked_by_agent_id: SESSION,
    answer: null,
    revision: 0,
    sent_revision: 0,
    sent_reply_id: null,
    ...fields,
  })

const project = (questions: readonly string[], messages: readonly string[]): ProjectInbox => {
  const inbox = createProjectInbox('demo')

  for (const raw of questions) {
    applyQuestion(inbox, raw)
  }

  for (const raw of messages) {
    applyMessage(inbox, raw)
  }

  return inbox
}

const open = (questions: readonly string[], messages: readonly string[]): number =>
  openItems([project(questions, messages)]).length

const answered = { answer: { selected: ['a'] }, revision: 1, sent_revision: 1 }

const freshWorld = (db = openDatabase(':memory:')): World => {
  migrate(db, MIGRATIONS, undefined)

  return createWorld(db, 8)
}

const item = (seq: number, session: string | null, thread = ROOT): InboxItem => ({
  id: `${thread}/q-${seq}`,
  message: thread,
  thread,
  session,
  host: 'claude-code',
  project: 'demo',
  since: seq * 1000,
  seq,
})

const liveHero = (world: World, session: string): void => {
  observe(
    world,
    {
      pane: `w1:${session}`,
      workspace: 'w1',
      session,
      guild: '/repo/a',
      title: '',
      quest: '',
      status: 'working',
    },
    1,
  )
  world.outbox.length = 0
}

const feedWith = (world: World, items: readonly InboxItem[]): void => {
  world.inbox.up = true
  world.inbox.items = items
  world.inbox.maxSeq = Math.max(0, ...items.map((entry) => entry.seq))
}

describe('inbox questions', () => {
  const root = message(1, ROOT)

  test('an unanswered question waits on the person', () => {
    expect(open([question(2)], [root])).toBe(1)
  })

  test('a sent answer clears it, and a re-pick after sending opens it again', () => {
    const reply = message(4, 'msg_reply')

    expect(
      open([question(2), question(3, { ...answered, sent_reply_id: 'msg_reply' })], [root, reply]),
    ).toBe(0)
    expect(
      open(
        [question(2), question(3, { ...answered, revision: 2, sent_reply_id: 'msg_reply' })],
        [root, reply],
      ),
    ).toBe(1)
  })

  test('a send whose reply never landed still waits', () => {
    expect(open([question(2, { ...answered, sent_reply_id: 'msg_lost' })], [root])).toBe(1)
  })

  test('a picked answer that is not sent yet still waits', () => {
    expect(open([question(2, { answer: { selected: ['a'] }, revision: 1 })], [root])).toBe(1)
  })

  test('skipped, set aside and superseded questions are done', () => {
    const reply = message(4, 'msg_reply')
    const skipped = {
      answer: { skipped: true },
      revision: 1,
      sent_revision: 1,
      sent_reply_id: 'msg_reply',
    }

    expect(open([question(2, skipped)], [root, reply])).toBe(0)
    expect(open([question(2, { set_aside: { at: 'x' } })], [root])).toBe(0)
    expect(open([question(2, { superseded_by: { message_id: 'm', key: 'k' } })], [root])).toBe(0)
  })

  test('archiving the thread closes earlier questions but not later ones', () => {
    const archived = message(5, ROOT, { resolved_at: '2026-11-08T00:00:00Z' })
    const later = line(6, 'question', 'msg_late/q-1', {
      message_id: 'msg_late',
      kind: 'single',
      asked_by_agent_id: SESSION,
      revision: 0,
      sent_revision: 0,
    })

    expect(open([question(2)], [root, archived])).toBe(0)
    expect(open([question(2), later], [root, archived, message(6, 'msg_late')])).toBe(1)
  })

  test('an action item waits until it has a result, and the agent can close it', () => {
    const action = (fields: Fields) => question(2, { kind: 'action', ...fields })

    expect(open([action({})], [root])).toBe(1)
    expect(open([action({ action_result: { by: 'agent' } })], [root])).toBe(0)
    expect(open([action({ action_result: { by: 'person' }, revision: 1 })], [root])).toBe(1)
  })

  test('reports, broken lines and missing messages raise nothing', () => {
    expect(open([], [root, message(2, 'msg_report')])).toBe(0)
    expect(open(['{"seq":', 'null', question(2)], [])).toBe(0)
  })

  test('an item carries ids and times, never text', () => {
    const [found] = openItems([project([question(2)], [root])])

    expect(found).toEqual({
      id: `${ROOT}/q-1`,
      message: ROOT,
      thread: ROOT,
      session: SESSION,
      host: 'claude-code',
      project: 'demo',
      since: 2000,
      seq: 2,
    })
    expect(JSON.stringify(found)).not.toContain(SECRET)
  })
})

describe('inbox files', () => {
  const setup = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tokenfall-inbox-'))
    const folder = join(dir, 'projects', 'demo-abc123')
    await mkdir(folder, { recursive: true })
    await writeFile(
      join(folder, 'project.json'),
      `${line(1, 'project', 'prj', { name: 'demo' })}\n`,
    )
    await writeFile(join(folder, 'messages.jsonl'), `${message(2, ROOT)}\n`)
    await writeFile(join(folder, 'questions.jsonl'), `${question(3)}\n`)
    const feed = createInboxFeed()

    return { dir, folder, feed, inbox: startInbox(feed, dir, TUNING) }
  }

  test('a tail picks up the answer appended later', async () => {
    const { folder, feed, inbox } = await setup()
    await inbox.poll()

    expect(feed.up).toBe(true)
    expect(feed.items.map((entry) => entry.project)).toEqual(['demo'])

    await appendFile(
      join(folder, 'questions.jsonl'),
      `${question(4, { ...answered, sent_reply_id: 'msg_reply' })}\n`,
    )
    await appendFile(join(folder, 'messages.jsonl'), `${message(5, 'msg_reply')}\n`)
    await inbox.poll()

    expect(feed.items).toEqual([])

    inbox.stop()
  })

  test('a rewritten file is read again from the start, and a deleted project drops out', async () => {
    const { folder, feed, inbox } = await setup()
    await inbox.poll()
    await writeFile(join(folder, 'questions.jsonl'), '')
    await inbox.poll()

    expect(feed.items).toEqual([])

    await writeFile(join(folder, 'questions.jsonl'), `${question(3)}\n`)
    await inbox.poll()

    expect(feed.items).toHaveLength(1)

    await rm(folder, { recursive: true })
    await inbox.poll()

    expect(feed.items).toEqual([])

    inbox.stop()
  })

  test('only the url leaves inbox.json, and only a loopback one', async () => {
    const { dir, feed, inbox } = await setup()
    await writeFile(
      join(dir, 'inbox.json'),
      JSON.stringify({ url: 'http://localhost:38407/', token: SECRET }),
    )
    await inbox.poll()

    expect(feed.url).toBe('http://localhost:38407/')
    expect(JSON.stringify(feed)).not.toContain(SECRET)
    expect(urlOf(JSON.stringify({ url: 'https://evil.example/' }))).toBeNull()
    expect(urlOf('{')).toBeNull()

    inbox.stop()
  })

  test('a missing inbox folder marks the source down', async () => {
    const feed = createInboxFeed()
    const inbox = startInbox(feed, join(tmpdir(), 'tokenfall-no-such-inbox'), TUNING)
    await inbox.poll()

    expect(feed.up).toBe(false)

    inbox.stop()
  })
})

describe('ravens', () => {
  test('open items land on their living Hero, the rest on the Notice Board', () => {
    const world = freshWorld()
    liveHero(world, SESSION)
    feedWith(world, [
      item(10, SESSION),
      item(11, SESSION, 'msg_other'),
      item(12, 'gone'),
      item(13, null),
    ])
    syncRavens(world, 20)

    expect(world.outbox).toEqual([
      {
        kind: 'hero.ravens',
        at: 20,
        hero: `local/session/${SESSION}`,
        ravens: 2,
        thread: ROOT,
        since: 10_000,
      },
    ])
    expect(world.inboxState.notices.map((notice) => notice.count)).toEqual([2])
    expect(world.inboxChanged).toBe(true)
  })

  test('a Hero that dies hands its Ravens to the board', () => {
    const world = freshWorld()
    liveHero(world, SESSION)
    feedWith(world, [item(10, SESSION)])
    syncRavens(world, 20)
    paneGone(world, `w1:${SESSION}`, 'exited', 30)
    syncRavens(world, 40)

    expect(world.inboxState.notices).toHaveLength(1)
  })

  test('a Chronicle line is written once per new message, never for old ones', () => {
    const db = openDatabase(':memory:')
    const world = freshWorld(db)
    liveHero(world, SESSION)
    feedWith(world, [item(10, SESSION)])
    syncRavens(world, 20)

    expect(world.chronicle).toEqual([])

    feedWith(world, [item(10, SESSION), item(11, SESSION, 'msg_new')])
    syncRavens(world, 30)

    expect(world.chronicle.map((entry) => entry.kind)).toEqual(['raven'])

    const again = createWorld(db, 8)
    liveHero(again, SESSION)
    feedWith(again, [item(10, SESSION), item(11, SESSION, 'msg_new')])
    syncRavens(again, 40)

    expect(again.chronicle).toEqual([])
  })
})
