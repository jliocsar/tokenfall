import type { Migration } from './index.ts'

const STATEMENTS = [
  `CREATE TABLE heroes (
    id TEXT PRIMARY KEY,
    session TEXT NOT NULL,
    machine TEXT NOT NULL,
    pane TEXT NOT NULL,
    workspace TEXT NOT NULL,
    guild TEXT NOT NULL,
    title TEXT NOT NULL,
    quest TEXT NOT NULL,
    experience INTEGER NOT NULL DEFAULT 0,
    minions INTEGER NOT NULL DEFAULT 0,
    lead INTEGER NOT NULL DEFAULT 0,
    alive INTEGER NOT NULL,
    born_at INTEGER NOT NULL,
    seen_at INTEGER NOT NULL,
    died_at INTEGER,
    death_cause TEXT
  )`,
  'CREATE INDEX heroes_alive ON heroes (alive)',
  'CREATE TABLE plots (guild TEXT PRIMARY KEY, plot INTEGER NOT NULL UNIQUE)',
  `CREATE TABLE chronicle (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    hero TEXT,
    level INTEGER,
    cause TEXT
  )`,
  `CREATE TABLE files (
    path TEXT PRIMARY KEY,
    hero TEXT NOT NULL,
    inode INTEGER NOT NULL,
    offset INTEGER NOT NULL
  )`,
  `CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    hero TEXT NOT NULL,
    input INTEGER NOT NULL,
    cache_write INTEGER NOT NULL,
    cache_read INTEGER NOT NULL,
    output INTEGER NOT NULL
  )`,
  'CREATE INDEX messages_hero ON messages (hero)',
]

export const initial: Migration = {
  name: '0001-initial',
  up: (db) => {
    for (const statement of STATEMENTS) {
      db.run(statement)
    }
  },
}
