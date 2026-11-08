import { LOCAL_MACHINE, sessionHeroId, type HeroId } from '@tokenfall/protocol/hero'
import type { InboxState, Notice } from '@tokenfall/protocol/inbox'
import type { InboxItem } from './adapters/inbox/parse.ts'
import { writeMeta } from './store/db.ts'
import type { HeroRecord } from './store/heroes.ts'
import { chronicle, INBOX_SEQ_KEY, type World } from './world.ts'

type Tally = { count: number; thread: string; since: number }

type Notices = Map<string, { -readonly [K in keyof Notice]: Notice[K] }>

const ownerOf = (world: World, item: InboxItem): HeroRecord | undefined =>
  item.session === null ? undefined : world.live.get(sessionHeroId(LOCAL_MACHINE, item.session))

const tallyHero = (tallies: Map<HeroId, Tally>, id: HeroId, item: InboxItem): void => {
  const tally = tallies.get(id)

  if (tally === undefined) {
    tallies.set(id, { count: 1, thread: item.thread, since: item.since })

    return
  }

  tally.count += 1

  if (item.since < tally.since) {
    tally.since = item.since
    tally.thread = item.thread
  }
}

const pinNotice = (notices: Notices, item: InboxItem): void => {
  const notice = notices.get(item.thread)

  if (notice === undefined) {
    notices.set(item.thread, {
      thread: item.thread,
      project: item.project,
      host: item.host,
      count: 1,
      since: item.since,
    })

    return
  }

  notice.count += 1
  notice.since = Math.min(notice.since, item.since)
}

const publishHero = (
  world: World,
  record: HeroRecord,
  tally: Tally | undefined,
  now: number,
): void => {
  const ravens = tally?.count ?? 0
  const thread = tally?.thread ?? null
  const since = tally?.since ?? 0

  if (record.ravens === ravens && record.ravenThread === thread && record.ravenSince === since) {
    return
  }

  record.ravens = ravens
  record.ravenThread = thread
  record.ravenSince = since
  world.outbox.push({ kind: 'hero.ravens', at: now, hero: record.id, ravens, thread, since })
}

const announce = (world: World, now: number): void => {
  const { items, maxSeq } = world.inbox
  const mark = world.inboxSeq

  if (mark !== null && maxSeq <= mark) {
    return
  }

  if (mark !== null) {
    const told = new Set<string>()

    for (const item of items) {
      const record = ownerOf(world, item)

      if (item.seq > mark && record !== undefined && !told.has(item.message)) {
        told.add(item.message)
        chronicle(world, 'raven', record, now)
      }
    }
  }

  world.inboxSeq = maxSeq
  writeMeta(world.db, INBOX_SEQ_KEY, String(maxSeq))
}

const sameState = (a: InboxState, b: InboxState): boolean =>
  a.up === b.up &&
  a.url === b.url &&
  a.notices.length === b.notices.length &&
  a.notices.every((notice, i) => {
    const other = b.notices[i]!

    return (
      notice.thread === other.thread &&
      notice.count === other.count &&
      notice.since === other.since &&
      notice.project === other.project &&
      notice.host === other.host
    )
  })

export const syncRavens = (world: World, now: number): void => {
  const { inbox } = world
  const tallies = new Map<HeroId, Tally>()
  const notices: Notices = new Map()

  for (const item of inbox.items) {
    const record = ownerOf(world, item)

    if (record === undefined) {
      pinNotice(notices, item)
    } else {
      tallyHero(tallies, record.id, item)
    }
  }

  for (const record of world.live.values()) {
    publishHero(world, record, tallies.get(record.id), now)
  }

  if (inbox.up) {
    announce(world, now)
  }

  const state: InboxState = {
    up: inbox.up,
    url: inbox.url,
    notices: [...notices.values()].sort((a, b) => a.since - b.since),
  }

  if (!sameState(state, world.inboxState)) {
    world.inboxState = state
    world.inboxChanged = true
  }
}
