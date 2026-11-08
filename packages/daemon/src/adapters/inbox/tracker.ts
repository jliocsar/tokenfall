import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeTrusted } from '@tokenfall/protocol/json'
import type { DaemonTuning } from '../../config.ts'
import { readLines } from '../transcripts/reader.ts'
import {
  applyMessage,
  applyQuestion,
  createProjectInbox,
  maxSeqOf,
  openItems,
  projectNameOf,
  type InboxItem,
  type ProjectInbox,
} from './parse.ts'

export type InboxFeed = {
  up: boolean
  url: string | null
  items: readonly InboxItem[]
  maxSeq: number
  version: number
}

export type Inbox = {
  readonly stop: () => void
  readonly poll: () => Promise<void>
}

type FileMark = { readonly inode: number; readonly offset: number }

type Tracked = {
  readonly dir: string
  readonly inbox: ProjectInbox
  readonly marks: Map<string, FileMark>
}

type Context = {
  readonly feed: InboxFeed
  readonly root: string
  readonly tuning: DaemonTuning['inbox']
  readonly projects: Map<string, Tracked>
  nextScan: number
  registryTime: number
}

type TickState = { running: Promise<void> | undefined; failed: boolean }

type Registry = { readonly url?: string | null }

const QUESTIONS = 'questions.jsonl'
const MESSAGES = 'messages.jsonl'
const PROJECT = 'project.json'
const REGISTRY = 'inbox.json'
const LOOPBACK = /^https?:\/\/(?:localhost|127\.0\.0\.1|[\w-]+\.localhost)(?::\d+)?\/?$/u

export const createInboxFeed = (): InboxFeed => ({
  up: false,
  url: null,
  items: [],
  maxSeq: 0,
  version: 0,
})

export const urlOf = (raw: string): string | null => {
  try {
    const url = decodeTrusted<Registry | null>(raw)?.url ?? null

    return url !== null && LOOPBACK.test(url) ? url : null
  } catch {
    return null
  }
}

const tail = async (
  tracked: Tracked,
  file: string,
  reset: () => void,
  onLine: (line: string) => void,
): Promise<boolean> => {
  const path = join(tracked.dir, file)
  const info = await stat(path).catch(() => undefined)
  const mark = tracked.marks.get(file)

  if (info === undefined) {
    tracked.marks.delete(file)

    if (mark !== undefined) {
      reset()
    }

    return mark !== undefined
  }

  const fresh = mark === undefined || mark.inode !== info.ino || info.size < mark.offset

  if (!fresh && info.size === mark.offset) {
    return false
  }

  if (fresh) {
    reset()
  }

  const offset = await readLines(path, fresh ? 0 : mark.offset, onLine)
  tracked.marks.set(file, { inode: info.ino, offset })

  return true
}

const readProject = async (tracked: Tracked): Promise<boolean> => {
  const { inbox } = tracked
  let changed = await tail(
    tracked,
    PROJECT,
    () => undefined,
    (line) => {
      inbox.name = projectNameOf(line) ?? inbox.name
    },
  )
  changed =
    (await tail(
      tracked,
      QUESTIONS,
      () => {
        inbox.questions.clear()
      },
      (line) => {
        applyQuestion(inbox, line)
      },
    )) || changed
  changed =
    (await tail(
      tracked,
      MESSAGES,
      () => {
        inbox.messages.clear()
      },
      (line) => {
        applyMessage(inbox, line)
      },
    )) || changed

  return changed
}

const scanProjects = async (context: Context): Promise<boolean> => {
  const dir = join(context.root, 'projects')
  const entries = await readdir(dir, { withFileTypes: true })
  const present = new Set<string>()
  let changed = false

  for (const entry of entries) {
    if (entry.isDirectory()) {
      present.add(entry.name)

      if (!context.projects.has(entry.name)) {
        context.projects.set(entry.name, {
          dir: join(dir, entry.name),
          inbox: createProjectInbox(entry.name),
          marks: new Map(),
        })
        changed = true
      }
    }
  }

  for (const key of context.projects.keys()) {
    if (!present.has(key)) {
      context.projects.delete(key)
      changed = true
    }
  }

  return changed
}

const readRegistry = async (context: Context): Promise<void> => {
  const path = join(context.root, REGISTRY)
  const info = await stat(path).catch(() => undefined)

  if (info === undefined) {
    context.registryTime = 0
    context.feed.url = null

    return
  }

  if (info.mtimeMs !== context.registryTime) {
    context.registryTime = info.mtimeMs
    context.feed.url = urlOf(await Bun.file(path).text())
  }
}

const poll = async (context: Context): Promise<void> => {
  const { feed } = context
  let changed = false

  if (Date.now() >= context.nextScan || !feed.up) {
    changed = await scanProjects(context)
    context.nextScan = Date.now() + context.tuning.scanMs
  }

  for (const tracked of context.projects.values()) {
    changed = (await readProject(tracked)) || changed
  }

  await readRegistry(context)

  if (changed || !feed.up) {
    const inboxes = [...context.projects.values()].map((tracked) => tracked.inbox)
    feed.items = openItems(inboxes)
    feed.maxSeq = maxSeqOf(inboxes)
    feed.version += 1
  }

  feed.up = true
}

export const startInbox = (feed: InboxFeed, root: string, tuning: DaemonTuning['inbox']): Inbox => {
  const context: Context = {
    feed,
    root,
    tuning,
    projects: new Map(),
    nextScan: 0,
    registryTime: 0,
  }
  const state: TickState = {
    running: undefined,
    failed: false,
  }

  const run = async (): Promise<void> => {
    try {
      await poll(context)
      state.failed = false
    } catch (error) {
      if (!state.failed) {
        console.error('inbox: unavailable', error)
      }

      state.failed = true
      feed.up = false
      feed.items = []
      feed.version += 1
      context.projects.clear()
    }
  }

  const tick = (): Promise<void> => {
    state.running ??= run().finally(() => {
      state.running = undefined
    })

    return state.running
  }

  const timer = setInterval(() => void tick(), tuning.pollMs)
  void tick()

  return {
    poll: tick,
    stop: () => {
      clearInterval(timer)
    },
  }
}
