import { batch, createMemo, createSignal, type Accessor } from 'solid-js'
import { createStore } from 'solid-js/store'
import ravens from '@tokenfall/data/ravens.json'
import world from '@tokenfall/data/world.json'
import { displayName, titleOf, isStranger } from '../../core/character.ts'
import { clearSet } from '../../core/dense-set.ts'
import { stateId } from '../../core/fsm.ts'
import { guildLabel } from '../../core/groups.ts'
import { heroOfEntity } from '../../core/hero-index.ts'
import type { Sim } from '../../core/sim.ts'
import { DEATH_CAUSES, type DeathCause } from '@tokenfall/protocol/hero'
import { WAIT_LOOT, WAIT_NONE, waitOf, waitSince } from '../attention/queue.ts'

export type Standing = (typeof STANDINGS)[number]

export type HeroRow = {
  readonly eid: number
  readonly name: string
  readonly fullName: string
  readonly className: string
  readonly personality: string
  readonly sheet: number
  readonly stranger: boolean
  readonly lead: boolean
  readonly level: number
  readonly standing: Standing
  readonly quest: string
  readonly guild: number
  readonly party: number
  readonly wait: number
  readonly since: number
  readonly waiting: string
  readonly ravenThread: string
  readonly diedAt: number
  readonly cause: DeathCause | null
  readonly session: string
}

export type Counts = Record<Standing, number>

export type PartyGroup = {
  readonly party: number
  readonly workspace: string
  readonly heroes: number[]
  readonly counts: Counts
  lead: number
}

export type TeamRow = {
  readonly eid: number
  readonly branch: string
  readonly mates: number
}

export type GuildGroup = {
  readonly guild: number
  readonly label: string
  readonly parties: PartyGroup[]
  readonly counts: Counts
  readonly size: number
}

type Rows = ReadonlyMap<number, HeroRow>

type GuildDraft = { readonly group: GuildGroup; size: number }

export type Roster = {
  readonly rows: Readonly<Record<number, HeroRow | undefined>>
  readonly guilds: Accessor<GuildGroup[]>
  readonly attention: Accessor<number[]>
  readonly fallen: Accessor<number[]>
  readonly flush: (now: number) => void
}

const STANDING_OF_STATUS = [
  'idle',
  'working',
  'loot',
  'raven',
  'unknown',
] as const satisfies readonly Standing[]

const BLOCKED = 3
const NO_LEAD = -1
const BRANCH = '├ '
const LAST_BRANCH = '└ '
const SESSION_MARK = '/session/'

const sessionOf = (id: string): string => {
  const at = id.indexOf(SESSION_MARK)

  return at === -1 ? '' : id.slice(at + SESSION_MARK.length)
}

export const STANDINGS = ['raven', 'loot', 'working', 'idle', 'unknown', 'dead'] as const

const emptyCounts = () =>
  ({ raven: 0, loot: 0, working: 0, idle: 0, unknown: 0, dead: 0 }) satisfies Counts

const standingOf = (sim: Sim, eid: number, dying: number, dead: number): Standing => {
  const state = sim.stores.behavior.state[eid]!

  if (state === dying || state === dead) {
    return 'dead'
  }

  if (sim.stores.hero.ravens[eid]! > 0) {
    return 'raven'
  }

  return STANDING_OF_STATUS[sim.stores.hero.status[eid]!] ?? 'unknown'
}

const inboxText = (count: number): string =>
  count === 1 ? ravens.inboxOne : ravens.inboxMany.replace('{count}', String(count))

export const waitingText = (sim: Sim, eid: number): string => {
  const { hero } = sim.stores
  const parts: string[] = []

  if (hero.status[eid] === BLOCKED) {
    parts.push(ravens.terminal)
  }

  if (hero.ravens[eid]! > 0) {
    parts.push(inboxText(hero.ravens[eid]!))
  }

  if (parts.length === 0 && waitOf(sim, eid) === WAIT_LOOT) {
    parts.push(ravens.loot)
  }

  return parts.join(' · ')
}

const rowOf = (sim: Sim, eid: number, dying: number, dead: number): HeroRow => {
  const { hero } = sim.stores
  const personality = sim.config.characters.personalities[hero.personality[eid]!]!
  const standing = standingOf(sim, eid, dying, dead)
  const wait = standing === 'dead' ? WAIT_NONE : waitOf(sim, eid)
  const title = titleOf(sim.text.title[eid]!)

  return {
    eid,
    name: sim.text.name[eid]!,
    fullName: displayName(sim.text.name[eid]!, title),
    className: personality.class,
    personality: personality.name,
    sheet: hero.sheet[eid]!,
    stranger: isStranger(sim.config.characters, hero.sheet[eid]!),
    lead: hero.lead[eid] === 1 && standing !== 'dead',
    level: hero.level[eid]!,
    standing,
    quest: sim.text.quest[eid]!,
    guild: hero.guild[eid]!,
    party: hero.party[eid]!,
    wait,
    since: wait === WAIT_NONE ? 0 : waitSince(sim, eid, wait),
    waiting: waitingText(sim, eid),
    ravenThread: sim.text.ravenThread[eid]!,
    diedAt: hero.diedAt[eid]!,
    cause: DEATH_CAUSES[hero.cause[eid]!] ?? null,
    session: sessionOf(heroOfEntity(sim.index, eid)),
  }
}

const RANK = new Map<Standing, number>(STANDINGS.map((standing, i) => [standing, i]))

const moved = (before: HeroRow | undefined, after: HeroRow): boolean =>
  before === undefined ||
  before.standing !== after.standing ||
  before.guild !== after.guild ||
  before.party !== after.party ||
  before.name !== after.name

const rank = (row: HeroRow): number => RANK.get(row.standing) ?? STANDINGS.length

const byName = (a: string, b: string): number => {
  if (a === b) {
    return 0
  }

  return a < b ? -1 : 1
}

const byStanding = (rows: Rows) => (a: number, b: number) =>
  rank(rows.get(a)!) - rank(rows.get(b)!) || byName(rows.get(a)!.name, rows.get(b)!.name)

const byWait = (rows: Rows) => (a: number, b: number) => {
  const rowA = rows.get(a)!
  const rowB = rows.get(b)!

  return rowA.wait - rowB.wait || rowA.since - rowB.since || byName(rowA.name, rowB.name)
}

export const leadFirst = (party: PartyGroup, isLead: (eid: number) => boolean): void => {
  const at = party.heroes.findIndex(isLead)

  if (at !== -1) {
    const [lead] = party.heroes.splice(at, 1)
    party.heroes.unshift(lead!)
    party.lead = lead!
  }
}

export const teamRows = (party: PartyGroup): TeamRow[] =>
  party.heroes.map((eid, i) => {
    if (i === 0) {
      return { eid, branch: '', mates: party.heroes.length - 1 }
    }

    return { eid, branch: i === party.heroes.length - 1 ? LAST_BRANCH : BRANCH, mates: 0 }
  })

export const isTeam = (party: PartyGroup): boolean => party.lead !== NO_LEAD

const group = (sim: Sim, rows: Rows): GuildGroup[] => {
  const guilds = new Map<number, GuildDraft>()
  const parties = new Map<number, PartyGroup>()

  for (const row of rows.values()) {
    if (row.standing === 'dead') {
      continue
    }

    const draft =
      guilds.get(row.guild) ??
      guilds
        .set(row.guild, {
          group: {
            guild: row.guild,
            label: guildLabel(sim.groups.guildKeys[row.guild] ?? ''),
            parties: [],
            counts: emptyCounts(),
            size: 0,
          },
          size: 0,
        })
        .get(row.guild)!
    const guild = draft.group
    const party =
      parties.get(row.party) ??
      parties
        .set(row.party, {
          party: row.party,
          workspace: sim.groups.partyWorkspace[row.party] ?? '',
          heroes: [],
          counts: emptyCounts(),
          lead: NO_LEAD,
        })
        .get(row.party)!

    if (party.heroes.length === 0) {
      guild.parties.push(party)
    }

    party.heroes.push(row.eid)
    party.counts[row.standing] += 1
    guild.counts[row.standing] += 1
    draft.size += 1
  }

  const order = byStanding(rows)

  for (const party of parties.values()) {
    party.heroes.sort(order)
    leadFirst(party, (eid) => rows.get(eid)?.lead === true)
  }

  return [...guilds.values()]
    .map((draft) => ({ ...draft.group, size: draft.size }))
    .toSorted((a, b) => a.guild - b.guild)
}

export const createRoster = (sim: Sim): Roster => {
  const [rows, setRows] = createStore<Record<number, HeroRow | undefined>>({})
  const plain = new Map<number, HeroRow>()
  const pending = { regroup: false, nextRegroup: 0 }
  const [version, setVersion] = createSignal(0)
  const dying = stateId(sim.machine, 'dying')
  const dead = stateId(sim.machine, 'dead')
  const guilds = createMemo(() => {
    version()

    return group(sim, plain)
  })
  const attention = createMemo(() => {
    version()

    const out: number[] = []

    for (const row of plain.values()) {
      if (row.standing === 'raven' || row.standing === 'loot') {
        out.push(row.eid)
      }
    }

    return out.sort(byWait(plain))
  })

  const fallen = createMemo(() => {
    version()

    const out: number[] = []

    for (const row of plain.values()) {
      if (row.standing === 'dead') {
        out.push(row.eid)
      }
    }

    return out.sort((a, b) => plain.get(b)!.diedAt - plain.get(a)!.diedAt)
  })

  return {
    rows,
    guilds,
    attention,
    fallen,
    flush: (now) => {
      const { changed, forgotten } = sim

      batch(() => {
        for (let i = 0; i < forgotten.size; i++) {
          const eid = forgotten.dense[i]!
          pending.regroup ||= plain.delete(eid)
          setRows(eid, undefined)
        }

        clearSet(forgotten)

        for (let i = 0; i < changed.size; i++) {
          const eid = changed.dense[i]!
          const row = rowOf(sim, eid, dying, dead)
          pending.regroup ||= moved(plain.get(eid), row)
          plain.set(eid, row)
          setRows(eid, row)
        }

        clearSet(changed)

        if (pending.regroup && now >= pending.nextRegroup) {
          pending.regroup = false
          pending.nextRegroup = now + world.roster.regroupEveryMs
          setVersion((value) => value + 1)
        }
      })
    },
  }
}
