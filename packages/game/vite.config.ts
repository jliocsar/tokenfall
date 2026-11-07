import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import solid from 'vite-plugin-solid'
import { traceAll } from './trace-all.ts'

const TMP = join(import.meta.dirname, '..', '..', 'tmp')
const TRACE_ALL = process.env['TOKENFALL_TRACE'] === 'all'

const save = async (folder: string, file: string, body: Buffer): Promise<void> => {
  await mkdir(folder, { recursive: true })
  await writeFile(file, body)
}

const receiver = (route: string, folder: string, prefix: string): Plugin => ({
  name: `tokenfall-${prefix}-receiver`,
  configureServer: (server) => {
    server.middlewares.use(route, (request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      request.on('end', () => {
        const target = join(TMP, folder)
        const file = join(target, `${prefix}-${new Date().toISOString().replaceAll(':', '-')}.json`)
        void save(target, file, Buffer.concat(chunks)).then(() => response.end(file))
      })
    })
  },
})

export default defineConfig({
  publicDir: '../../assets',
  define: { 'import.meta.env.TOKENFALL_TRACE_ALL': JSON.stringify(TRACE_ALL) },
  server: {
    host: '127.0.0.1',
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
    receiver('/__bench', 'bench', 'bench'),
    receiver('/__trace', 'traces', 'trace'),
    ...(TRACE_ALL ? [traceAll()] : []),
  ],
})
