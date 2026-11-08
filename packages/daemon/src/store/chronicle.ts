import type { Database } from 'bun:sqlite'
import {
  CHRONICLE_KINDS,
  type ChronicleKind,
  type ChronicleLine,
} from '@tokenfall/protocol/chronicle'
import { DEATH_CAUSES, type DeathCause, type HeroId } from '@tokenfall/protocol/hero'

export type ChronicleEntry = {
  readonly at: number
  readonly kind: ChronicleKind
  readonly hero: HeroId
  readonly title: string
  readonly level: number | null
  readonly cause: DeathCause | null
}

type ChronicleRow = {
  readonly seq: number
  readonly at: number
  readonly kind: string
  readonly hero: string
  readonly title: string | null
  readonly level: number | null
  readonly cause: string | null
}

const kindOf = (raw: string): ChronicleKind =>
  CHRONICLE_KINDS.find((kind) => kind === raw) ?? 'joined'

const causeOf = (raw: string | null): DeathCause | null =>
  DEATH_CAUSES.find((cause) => cause === raw) ?? null

export const appendChronicle = (db: Database, entry: ChronicleEntry): ChronicleLine => {
  const row = db
    .query<{ seq: number }, [number, string, string, number | null, string | null]>(
      'INSERT INTO chronicle (at, kind, hero, level, cause) VALUES (?, ?, ?, ?, ?) RETURNING seq',
    )
    .get(entry.at, entry.kind, entry.hero, entry.level, entry.cause)

  return { seq: row?.seq ?? 0, ...entry }
}

export const tailChronicle = (db: Database, limit: number): ChronicleLine[] =>
  db
    .query<ChronicleRow, [number]>(
      `SELECT c.seq, c.at, c.kind, c.hero, h.title, c.level, c.cause
       FROM chronicle c LEFT JOIN heroes h ON h.id = c.hero
       ORDER BY c.seq DESC LIMIT ?`,
    )
    .all(limit)
    .reverse()
    .map((row) => ({
      seq: row.seq,
      at: row.at,
      kind: kindOf(row.kind),
      hero: row.hero,
      title: row.title ?? '',
      level: row.level,
      cause: causeOf(row.cause),
    }))
