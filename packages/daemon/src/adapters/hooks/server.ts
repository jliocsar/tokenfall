import { chmodSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Config } from '../../config.ts'
import type { World } from '../../world.ts'
import { handleHook, readHook } from './handle.ts'

export type Hooks = { readonly stop: () => void }

const PANE_HEADER = 'x-herdr-pane'

export const startHooks = (world: World, config: Config): Hooks => {
  const path = join(config.runtimeDir, `${config.instance}.sock`)
  mkdirSync(config.runtimeDir, { recursive: true, mode: 0o700 })
  rmSync(path, { force: true })
  const server = Bun.serve({
    unix: path,
    fetch: async (request) => {
      const hook = readHook(await request.text())

      if (hook !== undefined) {
        handleHook(world, hook, request.headers.get(PANE_HEADER) ?? '', Date.now())
      }

      return new Response(null, { status: 204 })
    },
  })
  chmodSync(path, 0o600)

  return {
    stop: () => {
      void server.stop(true)
      rmSync(path, { force: true })
    },
  }
}
