import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const RESULTS = join(import.meta.dirname, '..', '..', 'tmp', 'bench')

const save = async (file: string, body: Buffer): Promise<void> => {
  await mkdir(RESULTS, { recursive: true })
  await writeFile(file, body)
}

const benchResults = (): Plugin => ({
  name: 'tokenfall-bench-results',
  configureServer: (server) => {
    server.middlewares.use('/__bench', (request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      request.on('end', () => {
        const file = join(RESULTS, `bench-${new Date().toISOString().replaceAll(':', '-')}.json`)
        void save(file, Buffer.concat(chunks)).then(() => response.end(file))
      })
    })
  },
})

export default defineConfig({
  publicDir: '../../assets',
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
  plugins: [benchResults()],
})
