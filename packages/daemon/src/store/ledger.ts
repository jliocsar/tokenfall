import type { Database } from 'bun:sqlite'

export type Usage = {
  readonly id: string
  readonly input: number
  readonly cacheWrite: number
  readonly cacheRead: number
  readonly output: number
}

export type FileMark = { readonly inode: number; readonly offset: number }

const CLAIM = `INSERT INTO messages (id, hero, input, cache_write, cache_read, output)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    input = max(input, excluded.input),
    cache_write = max(cache_write, excluded.cache_write),
    cache_read = max(cache_read, excluded.cache_read),
    output = max(output, excluded.output)
  WHERE hero = excluded.hero`

export const claimUsage = (db: Database, hero: string, usages: readonly Usage[]): void => {
  const claim = db.query(CLAIM)
  db.transaction(() => {
    for (const usage of usages) {
      claim.run(usage.id, hero, usage.input, usage.cacheWrite, usage.cacheRead, usage.output)
    }
  })()
}

export const experienceOf = (db: Database, hero: string): number =>
  db
    .query<{ total: number }, [string]>(
      'SELECT coalesce(sum(input + cache_write + cache_read + output), 0) AS total FROM messages WHERE hero = ?',
    )
    .get(hero)?.total ?? 0

export const fileMark = (db: Database, path: string): FileMark | undefined =>
  db
    .query<{ inode: number; offset: number }, [string]>(
      'SELECT inode, offset FROM files WHERE path = ?',
    )
    .get(path) ?? undefined

export const saveFileMark = (db: Database, path: string, hero: string, mark: FileMark): void => {
  db.query(
    `INSERT INTO files (path, hero, inode, offset) VALUES (?, ?, ?, ?)
      ON CONFLICT (path) DO UPDATE SET hero = excluded.hero, inode = excluded.inode, offset = excluded.offset`,
  ).run(path, hero, mark.inode, mark.offset)
}
