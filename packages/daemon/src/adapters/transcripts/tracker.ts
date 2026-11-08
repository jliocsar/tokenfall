import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DaemonTuning } from '../../config.ts'
import { claimUsage, experienceOf, fileMark, saveFileMark, type Usage } from '../../store/ledger.ts'
import { gainExperience, settleArrival, type World } from '../../world.ts'
import { readLines } from './reader.ts'
import { usageOf } from './usage.ts'

export type Transcripts = {
  readonly stop: () => void
  readonly poll: () => Promise<void>
}

type Tracked = {
  readonly hero: string
  readonly session: string
  files: string[]
  project: string | undefined
  reading: boolean
  caughtUp: boolean
  nextScan: number
}

type Context = {
  readonly world: World
  readonly roots: readonly string[]
  readonly tuning: DaemonTuning['transcripts']
  readonly tracked: Map<string, Tracked>
}

const SAFE_SESSION = /^[\w-]+$/u

const scan = async (pattern: string, cwd: string): Promise<string[]> => {
  const found: string[] = []

  try {
    for await (const path of new Bun.Glob(pattern).scan({ cwd, absolute: true })) {
      found.push(path)
    }
  } catch {
    return found
  }

  return found
}

const findProject = async (
  roots: readonly string[],
  session: string,
): Promise<string | undefined> => {
  for (const root of roots) {
    const [main] = await scan(`*/${session}.jsonl`, join(root, 'projects'))

    if (main !== undefined) {
      return main.slice(0, -`/${session}.jsonl`.length)
    }
  }

  return undefined
}

const findFiles = async (context: Context, tracked: Tracked): Promise<string[]> => {
  tracked.project ??= await findProject(context.roots, tracked.session)

  if (tracked.project === undefined) {
    return []
  }

  const subagents = await scan(`${tracked.session}/subagents/**/*.jsonl`, tracked.project)

  return [join(tracked.project, `${tracked.session}.jsonl`), ...subagents.sort()]
}

const readFile = async (context: Context, hero: string, path: string): Promise<boolean> => {
  const { db } = context.world
  const info = await stat(path).catch(() => undefined)

  if (info === undefined) {
    return false
  }

  const mark = fileMark(db, path)
  const offset =
    mark !== undefined && mark.inode === info.ino && info.size >= mark.offset ? mark.offset : 0

  if (info.size === offset) {
    return false
  }

  const usages: Usage[] = []
  const end = await readLines(path, offset, (line) => {
    const usage = usageOf(line)

    if (usage !== undefined) {
      usages.push(usage)
    }
  })
  claimUsage(db, hero, usages)
  saveFileMark(db, path, hero, { inode: info.ino, offset: end })

  return usages.length > 0
}

const publish = (context: Context, tracked: Tracked, now: number): void => {
  const { world } = context
  const record = world.live.get(tracked.hero)
  const experience = experienceOf(world.db, tracked.hero)

  if (record === undefined) {
    return
  }

  if (record.experience === experience) {
    settleArrival(world, record, now)
  } else {
    gainExperience(world, record, experience, !tracked.caughtUp, now)
  }
}

const readHero = async (context: Context, tracked: Tracked): Promise<void> => {
  tracked.reading = true

  try {
    if (Date.now() >= tracked.nextScan) {
      tracked.files = await findFiles(context, tracked)
      tracked.nextScan = Date.now() + context.tuning.scanMs
    }

    let grew = false

    for (const path of tracked.files) {
      grew = (await readFile(context, tracked.hero, path)) || grew
    }

    if (grew || !tracked.caughtUp) {
      publish(context, tracked, Date.now())
    }

    tracked.caughtUp = true
  } finally {
    tracked.reading = false
  }
}

const follow = (context: Context): Tracked[] => {
  const { world, tracked } = context

  for (const id of tracked.keys()) {
    if (!world.live.has(id)) {
      tracked.delete(id)
    }
  }

  for (const record of world.live.values()) {
    if (record.session !== null && SAFE_SESSION.test(record.session) && !tracked.has(record.id)) {
      tracked.set(record.id, {
        hero: record.id,
        session: record.session,
        files: [],
        project: undefined,
        reading: false,
        caughtUp: false,
        nextScan: 0,
      })
    }
  }

  return [...tracked.values()].filter((entry) => !entry.reading)
}

const poll = async (context: Context): Promise<void> => {
  for (const tracked of follow(context)) {
    await readHero(context, tracked).catch((error: Error) => {
      console.error(`transcripts: ${tracked.hero}`, error)
    })
  }
}

export const startTranscripts = (
  world: World,
  roots: readonly string[],
  tuning: DaemonTuning['transcripts'],
): Transcripts => {
  const context: Context = { world, roots, tuning, tracked: new Map() }
  const state = { busy: false }

  const tick = async (): Promise<void> => {
    if (state.busy) {
      return
    }

    state.busy = true

    try {
      await poll(context)
    } finally {
      state.busy = false
    }
  }

  const timer = setInterval(() => void tick(), tuning.pollMs)

  return {
    poll: tick,
    stop: () => {
      clearInterval(timer)
    },
  }
}
