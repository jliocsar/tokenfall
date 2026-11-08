import type { Database } from 'bun:sqlite'
import {
  DEATH_CAUSES,
  NO_PLOT,
  type DeathCause,
  type GuildKey,
  type HeroId,
  type HeroStatus,
} from '@tokenfall/protocol/hero'

export type HeroRecord = {
  id: HeroId
  session: string | null
  machine: string
  pane: string
  workspace: string
  guild: GuildKey
  plot: number
  title: string
  quest: string
  status: HeroStatus
  experience: number
  minions: number
  lead: boolean
  alive: boolean
  bornAt: number
  seenAt: number
  diedAt: number | null
  deathCause: DeathCause | null
}

type HeroRow = {
  readonly id: string
  readonly session: string
  readonly machine: string
  readonly pane: string
  readonly workspace: string
  readonly guild: string
  readonly title: string
  readonly quest: string
  readonly experience: number
  readonly minions: number
  readonly lead: number
  readonly alive: number
  readonly born_at: number
  readonly seen_at: number
  readonly died_at: number | null
  readonly death_cause: string | null
}

const COLUMNS = [
  'id',
  'session',
  'machine',
  'pane',
  'workspace',
  'guild',
  'title',
  'quest',
  'experience',
  'minions',
  'lead',
  'alive',
  'born_at',
  'seen_at',
  'died_at',
  'death_cause',
] as const

const SELECT = `SELECT ${COLUMNS.join(', ')} FROM heroes`

const UPSERT = `INSERT INTO heroes (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})
  ON CONFLICT (id) DO UPDATE SET ${COLUMNS.slice(1)
    .map((column) => `${column} = excluded.${column}`)
    .join(', ')}`

const causeOf = (raw: string | null): DeathCause | null =>
  DEATH_CAUSES.find((cause) => cause === raw) ?? null

const fromRow = (row: HeroRow, plots: ReadonlyMap<GuildKey, number>): HeroRecord => ({
  id: row.id,
  session: row.session,
  machine: row.machine,
  pane: row.pane,
  workspace: row.workspace,
  guild: row.guild,
  plot: plots.get(row.guild) ?? NO_PLOT,
  title: row.title,
  quest: row.quest,
  status: 'unknown',
  experience: row.experience,
  minions: row.minions,
  lead: row.lead === 1,
  alive: row.alive === 1,
  bornAt: row.born_at,
  seenAt: row.seen_at,
  diedAt: row.died_at,
  deathCause: causeOf(row.death_cause),
})

export const loadAliveHeroes = (db: Database, plots: ReadonlyMap<GuildKey, number>): HeroRecord[] =>
  db
    .query<HeroRow, []>(`${SELECT} WHERE alive = 1`)
    .all()
    .map((row) => fromRow(row, plots))

export const loadHero = (
  db: Database,
  id: HeroId,
  plots: ReadonlyMap<GuildKey, number>,
): HeroRecord | undefined => {
  const row = db.query<HeroRow, [string]>(`${SELECT} WHERE id = ?`).get(id)

  return row === null ? undefined : fromRow(row, plots)
}

export const saveHeroes = (db: Database, records: Iterable<HeroRecord>): void => {
  const upsert = db.query(UPSERT)
  db.transaction(() => {
    for (const record of records) {
      if (record.session !== null) {
        upsert.run(
          record.id,
          record.session,
          record.machine,
          record.pane,
          record.workspace,
          record.guild,
          record.title,
          record.quest,
          record.experience,
          record.minions,
          record.lead ? 1 : 0,
          record.alive ? 1 : 0,
          record.bornAt,
          record.seenAt,
          record.diedAt,
          record.deathCause,
        )
      }
    }
  })()
}

export const loadPlots = (db: Database): Map<GuildKey, number> =>
  new Map(
    db
      .query<{ guild: string; plot: number }, []>('SELECT guild, plot FROM plots')
      .all()
      .map((row) => [row.guild, row.plot]),
  )

export const savePlot = (db: Database, guild: GuildKey, plot: number): void => {
  db.query('INSERT INTO plots (guild, plot) VALUES (?, ?)').run(guild, plot)
}

export const deletePlot = (db: Database, guild: GuildKey): void => {
  db.query('DELETE FROM plots WHERE guild = ?').run(guild)
}
