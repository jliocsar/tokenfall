import { homedir } from 'node:os'
import { join } from 'node:path'
import tuning from '@tokenfall/data/daemon.json'

export type Config = {
  readonly dev: boolean
  readonly port: number
  readonly stateDir: string
  readonly runtimeDir: string
  readonly instance: string
  readonly distDir: string
  readonly origins: readonly string[]
}

export type DaemonTuning = typeof tuning

const runtimeRoot = (env: NodeJS.ProcessEnv): string =>
  env['XDG_RUNTIME_DIR'] ?? join('/tmp', `tokenfall-${process.getuid?.() ?? 0}`)

export const daemonTuning: DaemonTuning = tuning

export const readConfig = (args: readonly string[], env: NodeJS.ProcessEnv): Config => {
  const home = env['HOME'] ?? homedir()
  const dev = args.includes('--dev')
  const port = Number(env['TOKENFALL_PORT'] ?? (dev ? tuning.ports.dev : tuning.ports.service))
  const stateHome = env['XDG_STATE_HOME'] ?? join(home, '.local', 'state')
  const local = [`http://127.0.0.1:${port}`, `http://localhost:${port}`]

  return {
    dev,
    port,
    stateDir: env['TOKENFALL_STATE_DIR'] ?? join(stateHome, dev ? 'tokenfall-dev' : 'tokenfall'),
    runtimeDir: join(runtimeRoot(env), 'tokenfall'),
    instance: dev ? 'dev' : 'service',
    distDir: env['TOKENFALL_DIST'] ?? join(import.meta.dirname, '..', '..', 'game', 'dist'),
    origins: dev ? [...local, ...tuning.devOrigins] : local,
  }
}
