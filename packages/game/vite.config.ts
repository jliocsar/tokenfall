import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import solid from 'vite-plugin-solid'
import { traceAll } from './trace-all.ts'

const TMP = join(import.meta.dirname, '..', '..', 'tmp')
const TRACE_ALL = process.env['TOKENFALL_TRACE'] === 'all'
const DEV_DAEMON = 'ws://127.0.0.1:47310'
const DEV_TOKEN = join(process.env['XDG_RUNTIME_DIR'] ?? '/tmp', 'tokenfall', 'dev.token')

const save = async (folder: string, file: string, body: Buffer): Promise<void> => {
  await mkdir(folder, { recursive: true })
  await writeFile(file, body)
}

const receive =
  (folder: string, prefix: string) =>
  (request: IncomingMessage, response: ServerResponse): void => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    request.on('end', () => {
      const target = join(TMP, folder)
      const file = join(target, `${prefix}-${new Date().toISOString().replaceAll(':', '-')}.json`)
      void save(target, file, Buffer.concat(chunks)).then(() => response.end(file))
    })
  }

const receiver = (route: string, folder: string, prefix: string): Plugin => ({
  name: `tokenfall-${prefix}-receiver`,
  configurePreviewServer: (server) => {
    server.middlewares.use(route, receive(folder, prefix))
  },
  configureServer: (server) => {
    server.middlewares.use(route, receive(folder, prefix))
  },
})

const devToken = (): Plugin => ({
  name: 'tokenfall-dev-token',
  apply: 'serve',
  transformIndexHtml: async (html) => {
    const token = await readFile(DEV_TOKEN, 'utf8').catch(() => '')

    return html.replace(
      '</head>',
      `<meta name="tokenfall-token" content="${token.trim()}" /></head>`,
    )
  },
})

export default defineConfig({
  publicDir: '../../assets',
  define: { 'import.meta.env.TOKENFALL_TRACE_ALL': JSON.stringify(TRACE_ALL) },
  server: {
    host: '127.0.0.1',
    proxy: { '/ws': { target: DEV_DAEMON, ws: true } },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'es2023',
    rolldownOptions: { input: { index: 'index.html', bench: 'bench.html' } },
  },
  plugins: [
    solid(),
    devToken(),
    receiver('/__bench', 'bench', 'bench'),
    receiver('/__trace', 'traces', 'trace'),
    ...(TRACE_ALL ? [traceAll()] : []),
  ],
})
