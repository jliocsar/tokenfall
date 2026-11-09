import type { Migration } from './index.ts'

export const gravesIndex: Migration = {
  name: '0002-graves-index',
  up: (db) => {
    db.run('CREATE INDEX heroes_died_at ON heroes (died_at)')
  },
}
