import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import town from '@tokenfall/data/town.json'
import { startHerdr } from './adapters/herdr/adapter.ts'
import { startHooks } from './adapters/hooks/server.ts'
import { startTranscripts } from './adapters/transcripts/tracker.ts'
import { daemonTuning, readConfig } from './config.ts'
import { broadcast, startServer, type Hub } from './server.ts'
import { openStore } from './store/db.ts'
import { createWorld, flushDirty, flushTools } from './world.ts'

const TOKEN_BYTES = 24

const config = readConfig(Bun.argv.slice(2), process.env)
const db = openStore(config.stateDir)
const world = createWorld(db, town.plots)
const hub: Hub = { clients: new Set(), seq: 0 }
const token = Buffer.from(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))).toString('base64url')
const tokenFile = join(config.runtimeDir, `${config.instance}.token`)
mkdirSync(config.runtimeDir, { recursive: true, mode: 0o700 })
writeFileSync(tokenFile, token, { mode: 0o600 })
const server = startServer(config, world, hub, token)
const herdr = startHerdr(world, daemonTuning)
const hooks = startHooks(world, config)
const transcripts = startTranscripts(world, config.claudeDirs, daemonTuning.transcripts)
const ticker = setInterval(() => {
  flushTools(world, Date.now())
  broadcast(world, hub, Date.now())
  flushDirty(world)
}, daemonTuning.tickMs)

const stop = (): void => {
  clearInterval(ticker)
  herdr.stop()
  hooks.stop()
  transcripts.stop()
  flushDirty(world)
  void server.stop(true)
  db.close()
  rmSync(tokenFile, { force: true })
  process.exit(0)
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
console.log(
  `tokenfall ${config.instance} daemon on http://127.0.0.1:${config.port} with ${world.live.size} saved heroes, state in ${config.stateDir}`,
)
