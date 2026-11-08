import type { Server, ServerWebSocket } from 'bun'
import { join, normalize } from 'node:path'
import chronicleTuning from '@tokenfall/data/chronicle.json'
import { PROTOCOL_VERSION, type Delta, type Snapshot } from '@tokenfall/protocol/wire'
import type { Config } from './config.ts'
import { tailChronicle } from './store/chronicle.ts'
import { snapshotHeroes, type World } from './world.ts'

export type Hub = {
  readonly clients: Set<ServerWebSocket>
  seq: number
}

const HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
}
const HTML_HEADERS = {
  ...HEADERS,
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
}

export const TOKEN_META = 'tokenfall-token'

export const snapshotOf = (world: World, hub: Hub, now: number): Snapshot => ({
  kind: 'snapshot',
  version: PROTOCOL_VERSION,
  seq: hub.seq,
  at: now,
  townSeed: world.townSeed,
  heroes: snapshotHeroes(world),
  chronicle: tailChronicle(world.db, chronicleTuning.tail),
  inbox: world.inboxState,
})

export const broadcast = (world: World, hub: Hub, now: number): void => {
  if (world.outbox.length === 0 && world.chronicle.length === 0 && !world.inboxChanged) {
    return
  }

  const events = world.outbox.splice(0)
  const chronicle = world.chronicle.splice(0)
  const inbox = world.inboxChanged ? { inbox: world.inboxState } : {}
  world.inboxChanged = false
  hub.seq += 1
  const delta: Delta = { kind: 'delta', seq: hub.seq, at: now, events, chronicle, ...inbox }
  const message = JSON.stringify(delta)

  for (const client of hub.clients) {
    client.send(message)
  }
}

export const withToken = (html: string, token: string): string =>
  html.replace('</head>', `<meta name="${TOKEN_META}" content="${token}" /></head>`)

const notFound = (): Response => new Response('not found', { status: 404, headers: HEADERS })

const staticFile = async (dist: string, pathname: string, token: string): Promise<Response> => {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).slice(1)
  const path = normalize(join(dist, relative))

  if (!path.startsWith(`${dist}/`)) {
    return notFound()
  }

  const file = Bun.file(path)

  if (!(await file.exists())) {
    return notFound()
  }

  if (path.endsWith('.html')) {
    return new Response(withToken(await file.text(), token), { headers: HTML_HEADERS })
  }

  return new Response(file, { headers: HEADERS })
}

export const startServer = (
  config: Config,
  world: World,
  hub: Hub,
  token: string,
): Server<undefined> =>
  Bun.serve({
    hostname: '127.0.0.1',
    port: config.port,
    fetch: (request, server) => {
      const url = new URL(request.url)

      if (url.pathname !== '/ws') {
        return staticFile(normalize(config.distDir), url.pathname, token)
      }

      const origin = request.headers.get('origin') ?? ''

      if (!config.origins.includes(origin) || url.searchParams.get('token') !== token) {
        return new Response('forbidden', { status: 403 })
      }

      return server.upgrade(request) ? undefined : new Response('upgrade failed', { status: 400 })
    },
    websocket: {
      open: (socket) => {
        broadcast(world, hub, Date.now())
        hub.clients.add(socket)
        socket.send(JSON.stringify(snapshotOf(world, hub, Date.now())))
      },
      message: () => undefined,
      close: (socket) => {
        hub.clients.delete(socket)
      },
    },
  })
