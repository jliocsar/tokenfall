import type { Database } from 'bun:sqlite'
import { initial } from './0001-initial.ts'

export type Migration = {
  readonly name: string
  readonly up: (db: Database) => void
}

export const MIGRATIONS: readonly Migration[] = [initial]
