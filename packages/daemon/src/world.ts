import type { Database } from 'bun:sqlite'
import tuning from '@tokenfall/data/daemon.json'
import curve from '@tokenfall/data/level-curve.json'
import type { ChronicleKind, ChronicleLine } from '@tokenfall/protocol/chronicle'
import type { HeroEvent } from '@tokenfall/protocol/events'
import {
  LOCAL_MACHINE,
  NO_PLOT,
  paneHeroId,
  sessionHeroId,
  type DeathCause,
  type GuildKey,
  type HeroId,
  type HeroInfo,
  type HeroStatus,
  type PaneId,
  type WorkspaceId,
} from '@tokenfall/protocol/hero'
import { INBOX_DOWN, type InboxState } from '@tokenfall/protocol/inbox'
import { levelFor, levelThresholds } from '@tokenfall/protocol/level'
import { createInboxFeed, type InboxFeed } from './adapters/inbox/tracker.ts'
import { appendChronicle } from './store/chronicle.ts'
import { readMeta, writeMeta } from './store/db.ts'
import {
  deletePlot,
  loadAliveHeroes,
  loadFallenHeroes,
  loadHero,
  loadPlots,
  saveHeroes,
  savePlot,
  type HeroRecord,
} from './store/heroes.ts'

export type Observed = {
  readonly pane: PaneId
  readonly workspace: WorkspaceId
  readonly session: string | null
  readonly guild: GuildKey
  readonly title: string | null
  readonly quest: string
  readonly status: HeroStatus
}

export type ToolTally = {
  tool: string
  calls: number
  minionTool: string
  minionCalls: number
}

export type World = {
  readonly db: Database
  readonly plotCount: number
  readonly townSeed: number
  readonly live: Map<HeroId, HeroRecord>
  readonly paneHero: Map<PaneId, HeroId>
  readonly plots: Map<GuildKey, number>
  readonly missing: Map<HeroId, number>
  readonly dirty: Set<HeroRecord>
  readonly outbox: HeroEvent[]
  readonly hookSessions: Map<PaneId, string>
  readonly ended: Set<string>
  readonly minions: Map<HeroId, Set<string>>
  readonly tools: Map<HeroId, ToolTally>
  readonly chronicle: ChronicleLine[]
  readonly arriving: Map<HeroId, ChronicleKind>
  readonly inbox: InboxFeed
  inboxState: InboxState
  inboxChanged: boolean
  inboxSeq: number | null
}

const SEED_KEY = 'townSeed'
const THRESHOLDS = levelThresholds(curve)
const HOUR_MS = 3_600_000
const GRAVE_MS = tuning.graveHours * HOUR_MS

export const INBOX_SEQ_KEY = 'inboxSeq'

const loadSeed = (db: Database): number => {
  const saved = readMeta(db, SEED_KEY)

  if (saved !== undefined) {
    return Number(saved)
  }

  const seed = crypto.getRandomValues(new Uint32Array(1))[0]!
  writeMeta(db, SEED_KEY, String(seed))

  return seed
}

const savedSeq = (db: Database): number | null => {
  const saved = readMeta(db, INBOX_SEQ_KEY)

  return saved === undefined ? null : Number(saved)
}

export const heroIdOf = (pane: PaneId, session: string | null): HeroId =>
  session === null ? paneHeroId(LOCAL_MACHINE, pane) : sessionHeroId(LOCAL_MACHINE, session)

export const heroInfo = (record: HeroRecord): HeroInfo => ({
  id: record.id,
  session: record.session,
  machine: record.machine,
  pane: record.pane,
  workspace: record.workspace,
  guild: record.guild,
  plot: record.plot,
  title: record.title,
  quest: record.quest,
  status: record.status,
  experience: record.experience,
  minions: record.minions,
  lead: record.lead,
  alive: record.alive,
  diedAt: record.diedAt ?? 0,
  cause: record.deathCause,
  ravens: record.ravens,
  ravenThread: record.ravenThread,
  ravenSince: record.ravenSince,
})

export const createWorld = (db: Database, plotCount: number): World => {
  const plots = loadPlots(db)
  const world: World = {
    db,
    plotCount,
    townSeed: loadSeed(db),
    live: new Map(),
    paneHero: new Map(),
    plots,
    missing: new Map(),
    dirty: new Set(),
    outbox: [],
    hookSessions: new Map(),
    ended: new Set(),
    minions: new Map(),
    tools: new Map(),
    chronicle: [],
    arriving: new Map(),
    inbox: createInboxFeed(),
    inboxState: INBOX_DOWN,
    inboxChanged: false,
    inboxSeq: savedSeq(db),
  }

  for (const record of loadAliveHeroes(db, plots)) {
    world.live.set(record.id, record)
    world.paneHero.set(record.pane, record.id)
  }

  return world
}

export const snapshotHeroes = (world: World, now: number): HeroInfo[] => {
  flushDirty(world)
  const heroes: HeroInfo[] = []

  for (const record of world.live.values()) {
    heroes.push(heroInfo(record))
  }

  for (const record of loadFallenHeroes(world.db, world.plots, now - GRAVE_MS, tuning.graveCap)) {
    if (!world.live.has(record.id)) {
      heroes.push(heroInfo(record))
    }
  }

  return heroes
}

export const flushDirty = (world: World): void => {
  if (world.dirty.size > 0) {
    saveHeroes(world.db, world.dirty)
    world.dirty.clear()
  }
}

const claimPlot = (world: World, guild: GuildKey): number => {
  const held = world.plots.get(guild)

  if (held !== undefined) {
    return held
  }

  const taken = new Set(world.plots.values())

  for (let plot = 0; plot < world.plotCount; plot++) {
    if (!taken.has(plot)) {
      world.plots.set(guild, plot)
      savePlot(world.db, guild, plot)

      return plot
    }
  }

  return NO_PLOT
}

const releasePlot = (world: World, guild: GuildKey): void => {
  for (const record of world.live.values()) {
    if (record.guild === guild) {
      return
    }
  }

  if (world.plots.delete(guild)) {
    deletePlot(world.db, guild)
  }
}

const place = (world: World, record: HeroRecord, seen: Observed, now: number): void => {
  if (world.paneHero.get(record.pane) === record.id) {
    world.paneHero.delete(record.pane)
  }

  record.pane = seen.pane
  record.workspace = seen.workspace
  record.guild = seen.guild
  record.plot = claimPlot(world, seen.guild)
  record.quest = seen.quest
  record.status = seen.status
  record.title = seen.title ?? record.title
  record.seenAt = now
  record.alive = true
  record.diedAt = null
  record.deathCause = null
  world.live.set(record.id, record)
  world.paneHero.set(seen.pane, record.id)
  world.dirty.add(record)
}

const freshRecord = (id: HeroId, session: string | null, now: number): HeroRecord => ({
  id,
  session,
  machine: LOCAL_MACHINE,
  pane: '',
  workspace: '',
  guild: '',
  plot: NO_PLOT,
  title: '',
  quest: '',
  status: 'unknown',
  experience: 0,
  minions: 0,
  lead: false,
  alive: true,
  bornAt: now,
  seenAt: now,
  diedAt: null,
  deathCause: null,
  ravens: 0,
  ravenThread: null,
  ravenSince: 0,
})

export const chronicle = (
  world: World,
  kind: ChronicleKind,
  record: HeroRecord,
  now: number,
  cause: DeathCause | null = null,
): void => {
  world.chronicle.push(
    appendChronicle(world.db, {
      at: now,
      kind,
      hero: record.id,
      title: record.title,
      level: levelFor(THRESHOLDS, record.experience),
      cause,
    }),
  )
}

export const settleArrival = (world: World, record: HeroRecord, now: number): void => {
  const kind = world.arriving.get(record.id)

  if (kind !== undefined) {
    world.arriving.delete(record.id)
    chronicle(world, kind, record, now)
  }
}

export const gainExperience = (
  world: World,
  record: HeroRecord,
  experience: number,
  catchUp: boolean,
  now: number,
): void => {
  const before = levelFor(THRESHOLDS, record.experience)
  record.experience = experience
  world.dirty.add(record)
  world.outbox.push({ kind: 'hero.experience', at: now, hero: record.id, experience, catchUp })

  if (world.arriving.has(record.id)) {
    settleArrival(world, record, now)
  } else if (levelFor(THRESHOLDS, experience) > before) {
    chronicle(world, 'level', record, now)
  }
}

const spawn = (world: World, id: HeroId, seen: Observed, now: number): void => {
  flushDirty(world)
  const saved = seen.session === null ? undefined : loadHero(world.db, id, world.plots)
  const record = saved ?? freshRecord(id, seen.session, now)
  const returning = saved !== undefined && !saved.alive
  place(world, record, seen, now)

  if (returning) {
    world.outbox.push(
      { kind: 'hero.resurrected', at: now, hero: id, info: heroInfo(record) },
      { kind: 'hero.status', at: now, hero: id, status: record.status },
      { kind: 'hero.quest', at: now, hero: id, quest: record.quest },
    )
    chronicle(world, 'resurrected', record, now)

    return
  }

  world.outbox.push({ kind: 'hero.joined', at: now, hero: heroInfo(record) })

  if (saved === undefined && seen.session !== null) {
    world.arriving.set(id, 'joined')
  }
}

export const killHero = (
  world: World,
  record: HeroRecord,
  cause: DeathCause,
  now: number,
): void => {
  if (!record.alive) {
    return
  }

  world.live.delete(record.id)
  world.missing.delete(record.id)

  if (world.paneHero.get(record.pane) === record.id) {
    world.paneHero.delete(record.pane)
  }

  settleArrival(world, record, now)

  if (record.session !== null) {
    chronicle(world, 'died', record, now, cause)
  }

  record.alive = false
  record.diedAt = now
  record.deathCause = cause
  world.dirty.add(record)
  world.outbox.push({ kind: 'hero.died', at: now, hero: record.id, cause })
  releasePlot(world, record.guild)
}

const update = (world: World, record: HeroRecord, seen: Observed, now: number): void => {
  const { id } = record
  record.seenAt = now

  if (seen.status !== record.status) {
    record.status = seen.status
    world.outbox.push({ kind: 'hero.status', at: now, hero: id, status: seen.status })
  }

  if (seen.quest !== record.quest) {
    record.quest = seen.quest
    world.outbox.push({ kind: 'hero.quest', at: now, hero: id, quest: seen.quest })
  }

  record.title = seen.title ?? record.title

  if (
    seen.pane !== record.pane ||
    seen.workspace !== record.workspace ||
    seen.guild !== record.guild
  ) {
    const left = record.guild
    place(world, record, seen, now)
    world.outbox.push({
      kind: 'hero.moved',
      at: now,
      hero: id,
      pane: record.pane,
      workspace: record.workspace,
      guild: record.guild,
      plot: record.plot,
    })
    releasePlot(world, left)
  }

  world.dirty.add(record)
}

const link = (
  world: World,
  stranger: HeroRecord,
  seen: Observed,
  session: string,
  now: number,
): boolean => {
  const id = sessionHeroId(LOCAL_MACHINE, session)

  if (world.live.has(id)) {
    killHero(world, stranger, 'missing', now)

    return false
  }

  flushDirty(world)
  const saved = loadHero(world.db, id, world.plots)
  const record = saved ?? freshRecord(id, session, now)
  const returning = saved !== undefined && !saved.alive
  world.live.delete(stranger.id)
  world.paneHero.delete(stranger.pane)
  record.pane = stranger.pane
  record.workspace = stranger.workspace
  record.guild = stranger.guild
  record.status = stranger.status
  record.quest = stranger.quest
  place(world, record, { ...seen, status: stranger.status, quest: stranger.quest }, now)

  if (saved === undefined) {
    world.arriving.set(id, 'linked')
  } else if (returning) {
    chronicle(world, 'resurrected', record, now)
  }

  world.outbox.push({ kind: 'hero.linked', at: now, from: stranger.id, to: id, session })

  if (returning) {
    world.outbox.push({ kind: 'hero.resurrected', at: now, hero: id, info: heroInfo(record) })
  }

  if (record.experience > 0) {
    world.outbox.push({
      kind: 'hero.experience',
      at: now,
      hero: id,
      experience: record.experience,
      catchUp: true,
    })
  }

  update(world, record, seen, now)

  return true
}

export const sessionFor = (world: World, pane: PaneId, reported: string | null): string | null =>
  world.hookSessions.get(pane) ??
  (reported !== null && !world.ended.has(reported) ? reported : null)

export const flushTools = (world: World, now: number): void => {
  for (const [hero, tally] of world.tools) {
    if (tally.calls > 0) {
      world.outbox.push({
        kind: 'hero.tool',
        at: now,
        hero,
        tool: tally.tool,
        calls: tally.calls,
        minion: false,
      })
    }

    if (tally.minionCalls > 0) {
      world.outbox.push({
        kind: 'hero.tool',
        at: now,
        hero,
        tool: tally.minionTool,
        calls: tally.minionCalls,
        minion: true,
      })
    }
  }

  world.tools.clear()
}

export const observe = (world: World, reported: Observed, now: number): void => {
  const seen = { ...reported, session: sessionFor(world, reported.pane, reported.session) }
  const id = heroIdOf(seen.pane, seen.session)
  const currentId = world.paneHero.get(seen.pane)
  const current = currentId === undefined ? undefined : world.live.get(currentId)
  world.missing.delete(id)

  if (current !== undefined && current.id !== id) {
    if (seen.session === null) {
      update(world, current, seen, now)

      return
    }

    if (current.session !== null) {
      killHero(world, current, 'cleared', now)
    } else if (link(world, current, seen, seen.session, now)) {
      return
    }
  }

  const existing = world.live.get(id)

  if (existing === undefined) {
    spawn(world, id, seen, now)
  } else {
    update(world, existing, seen, now)
  }
}

export const setLeads = (world: World, leadPanes: ReadonlySet<PaneId>, now: number): void => {
  for (const record of world.live.values()) {
    const lead = leadPanes.has(record.pane)

    if (lead !== record.lead) {
      record.lead = lead
      world.dirty.add(record)
      world.outbox.push({ kind: 'hero.lead', at: now, hero: record.id, lead })
    }
  }
}

export const anyDone = (world: World): boolean => {
  for (const record of world.live.values()) {
    if (record.status === 'done') {
      return true
    }
  }

  return false
}

export const setStatus = (world: World, pane: PaneId, status: HeroStatus, now: number): void => {
  const id = world.paneHero.get(pane)
  const record = id === undefined ? undefined : world.live.get(id)

  if (record !== undefined && record.status !== status) {
    record.status = status
    world.outbox.push({ kind: 'hero.status', at: now, hero: record.id, status })
  }
}

export const paneGone = (world: World, pane: PaneId, cause: DeathCause, now: number): void => {
  const id = world.paneHero.get(pane)
  const record = id === undefined ? undefined : world.live.get(id)

  world.hookSessions.delete(pane)

  if (record !== undefined) {
    killHero(world, record, cause, now)
  }
}

export const paneMoved = (world: World, from: PaneId, to: PaneId): void => {
  const id = world.paneHero.get(from)

  if (id !== undefined && from !== to) {
    world.paneHero.delete(from)
    world.paneHero.set(to, id)
  }
}

export const sweepMissing = (
  world: World,
  listed: ReadonlySet<PaneId>,
  limit: number,
  now: number,
): void => {
  for (const record of [...world.live.values()]) {
    if (listed.has(record.pane)) {
      world.missing.delete(record.id)
    } else {
      const misses = (world.missing.get(record.id) ?? 0) + 1

      if (misses >= limit) {
        killHero(world, record, 'missing', now)
      } else {
        world.missing.set(record.id, misses)
      }
    }
  }
}
