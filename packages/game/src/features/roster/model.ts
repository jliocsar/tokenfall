import { createMemo, createSignal, type Accessor } from 'solid-js'
import { createStore } from 'solid-js/store'
import { displayName, titleOf } from '../../core/character.ts'
import { clearSet } from '../../core/dense-set.ts'
import { stateId } from '../../core/fsm.ts'
import { guildLabel } from '../../core/groups.ts'
import type { Sim } from '../../core/sim.ts'

export type Standing = (typeof STANDINGS)[number]

export type HeroRow = {
  readonly eid: number
  readonly name: string
  readonly fullName: string
  readonly className: string
  readonly personality: string
  readonly sheet: number
  readonly level: number
  readonly standing: Standing
  readonly quest: string
  readonly guild: number
  readonly party: number
}

export type Counts = Record<Standing, number>

export type PartyGroup = {
  readonly party: number
  readonly workspace: string
  readonly heroes: number[]
  readonly counts: Counts
}

export type GuildGroup = {
  readonly guild: number
  readonly label: string
  readonly parties: PartyGroup[]
  readonly counts: Counts
  readonly size: number
}

export type Roster = {
  readonly rows: Readonly<Record<number, HeroRow>>
  readonly guilds: Accessor<GuildGroup[]>
  readonly attention: Accessor<number[]>
  readonly flush: () => void
}

const STANDING_OF_STATUS = [
  'idle',
  'working',
  'loot',
  'raven',
  'unknown',
] as const satisfies readonly Standing[]

export const STANDINGS = ['raven', 'loot', 'working', 'idle', 'unknown', 'dead'] as const

const emptyCounts = () =>
  ({ raven: 0, loot: 0, working: 0, idle: 0, unknown: 0, dead: 0 }) satisfies Counts

const standingOf = (sim: Sim, eid: number, dying: number, dead: number): Standing => {
  const state = sim.stores.behavior.state[eid]!

  if (state === dying || state === dead) {
    return 'dead'
  }

  return STANDING_OF_STATUS[sim.stores.hero.status[eid]!] ?? 'unknown'
}

const rowOf = (sim: Sim, eid: number, dying: number, dead: number): HeroRow => {
  const { hero } = sim.stores
  const personality = sim.config.characters.personalities[hero.personality[eid]!]!
  const title = titleOf(sim.text.title[eid]!)

  return {
    eid,
    name: sim.text.name[eid]!,
    fullName: displayName(sim.text.name[eid]!, title),
    className: personality.class,
    personality: personality.name,
    sheet: hero.sheet[eid]!,
    level: hero.level[eid]!,
    standing: standingOf(sim, eid, dying, dead),
    quest: sim.text.quest[eid]!,
    guild: hero.guild[eid]!,
    party: hero.party[eid]!,
  }
}

const rank = (row: HeroRow): number => STANDINGS.indexOf(row.standing)

const byStanding = (rows: Readonly<Record<number, HeroRow>>) => (a: number, b: number) =>
  rank(rows[a]!) - rank(rows[b]!) || rows[a]!.name.localeCompare(rows[b]!.name)

const group = (sim: Sim, rows: Readonly<Record<number, HeroRow>>): GuildGroup[] => {
  const guilds = new Map<number, GuildGroup>()
  const parties = new Map<number, PartyGroup>()

  for (const row of Object.values(rows)) {
    const guild =
      guilds.get(row.guild) ??
      guilds
        .set(row.guild, {
          guild: row.guild,
          label: guildLabel(sim.groups.guildKeys[row.guild] ?? ''),
          parties: [],
          counts: emptyCounts(),
          size: 0,
        })
        .get(row.guild)!
    const party =
      parties.get(row.party) ??
      parties
        .set(row.party, {
          party: row.party,
          workspace: sim.groups.partyWorkspace[row.party] ?? '',
          heroes: [],
          counts: emptyCounts(),
        })
        .get(row.party)!

    if (party.heroes.length === 0) {
      guild.parties.push(party)
    }

    party.heroes.push(row.eid)
    party.counts[row.standing] += 1
    guild.counts[row.standing] += 1
    guilds.set(row.guild, { ...guild, size: guild.size + 1 })
  }

  const order = byStanding(rows)

  for (const party of parties.values()) {
    party.heroes.sort(order)
  }

  return [...guilds.values()].toSorted((a, b) => a.guild - b.guild)
}

export const createRoster = (sim: Sim): Roster => {
  const [rows, setRows] = createStore<Record<number, HeroRow>>({})
  const [version, setVersion] = createSignal(0)
  const dying = stateId(sim.machine, 'dying')
  const dead = stateId(sim.machine, 'dead')
  const guilds = createMemo(() => {
    version()

    return group(sim, rows)
  })
  const attention = createMemo(() => {
    version()

    return Object.values(rows)
      .filter((row) => row.standing === 'raven' || row.standing === 'loot')
      .map((row) => row.eid)
      .sort(byStanding(rows))
  })

  return {
    rows,
    guilds,
    attention,
    flush: () => {
      const { changed } = sim

      if (changed.size === 0) {
        return
      }

      for (let i = 0; i < changed.size; i++) {
        const eid = changed.dense[i]!
        setRows(eid, rowOf(sim, eid, dying, dead))
      }

      clearSet(changed)
      setVersion((value) => value + 1)
    },
  }
}
