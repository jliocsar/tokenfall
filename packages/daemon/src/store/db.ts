import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { MIGRATIONS, type Migration } from './migrations/index.ts'

const SCHEMA_KEY = 'schema'

export const SAVE_FILE = 'tokenfall.sqlite'

export const readMeta = (db: Database, key: string): string | undefined =>
  db.query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?').get(key)?.value

export const writeMeta = (db: Database, key: string, value: string): void => {
  db.query(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}

export const schemaVersion = (db: Database): number => {
  db.run('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

  return Number(readMeta(db, SCHEMA_KEY) ?? 0)
}

export const migrate = (
  db: Database,
  migrations: readonly Migration[],
  backup: string | undefined,
): number => {
  const from = schemaVersion(db)

  if (from > migrations.length) {
    throw new Error(`the save is at schema ${from}, but this build only knows ${migrations.length}`)
  }

  if (from > 0 && from < migrations.length && backup !== undefined) {
    db.query('VACUUM INTO ?').run(backup)
  }

  for (let version = from; version < migrations.length; version++) {
    db.transaction(() => {
      migrations[version]!.up(db)
      writeMeta(db, SCHEMA_KEY, String(version + 1))
    })()
  }

  return migrations.length
}

export const openDatabase = (file: string): Database => {
  const db = new Database(file, { create: true, strict: true })
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA synchronous = NORMAL')

  return db
}

export const openStore = (dir: string): Database => {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const db = openDatabase(join(dir, SAVE_FILE))
  migrate(db, MIGRATIONS, join(dir, `${SAVE_FILE}.before-v${MIGRATIONS.length}`))

  return db
}
