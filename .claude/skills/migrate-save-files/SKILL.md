---
name: migrate-save-files
description: Change the Tokenfall save format (the daemon's SQLite schema) with a migration. Use whenever a change adds, drops or reshapes a table or column under packages/daemon/src/store/, or changes what a saved value means.
---

The daemon's save is `tokenfall.sqlite` in `~/.local/state/tokenfall/`. The dev daemon's save is in `~/.local/state/tokenfall-dev/`. Every format change ships as a migration. Never edit a save by hand, and never change an existing migration after it has been committed.

## How migrations run

- They live in `packages/daemon/src/store/migrations/`, one file each, named `NNNN-what-it-does.ts`, and each exports a `Migration` (`{ name, up(db) }`).
- `migrations/index.ts` lists them in order. A migration's position in that list is its schema version, and `meta.schema` stores the version the save is at.
- On start, `openStore` runs every migration past `meta.schema`. Each one runs in its own transaction, together with its version bump.
- Before migrating a save that already exists, the daemon copies it to `tokenfall.sqlite.before-v<N>` with `VACUUM INTO`.
- A save at a newer schema than the build knows is refused, not downgraded.

## Writing one

1. Add `NNNN-<name>.ts` next to the others, numbered one past the last, and append it to `MIGRATIONS` in `index.ts`.
2. In `up`, only use SQL that works on the save as the previous migration left it. Don't import the current row types into a migration, because they change later. Write the SQL out in full.
3. For a reshaped column, create the new column or table, copy the data across with SQL, then drop the old one. SQLite's `ALTER TABLE ... DROP COLUMN` works on simple columns, but not on indexed ones.
4. Update the code that reads and writes the table: `store/heroes.ts` and its neighbours.
5. Add a test to `packages/daemon/test/`:
   - Build a save at the previous version: run `migrate` with `MIGRATIONS.slice(0, N - 1)`, then insert a few rows the old way.
   - Run the full list, and check the rows came through.
6. Try it on a copy of the real dev save, never on the original:

   ```sh
   cp ~/.local/state/tokenfall-dev/tokenfall.sqlite tmp/save-check.sqlite
   TOKENFALL_STATE_DIR=tmp/save-check bun packages/daemon/src/main.ts --dev
   ```

   (Put the copy at `tmp/save-check/tokenfall.sqlite` first.)
7. Note the change in the commit message: what moved, and why.

## Don't

- Store message content, tool inputs or inbox bodies. Spec section 12 lists what may be saved.
- Renumber or edit committed migrations. If one was wrong, fix it with the next one.
- Delete the `before-v<N>` backups yourself. They're the person's to clean up.
