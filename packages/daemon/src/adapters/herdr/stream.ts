import { decodeTrusted } from '@tokenfall/protocol/json'

export type StreamMode = 'observe' | 'control'

export type StreamFrame = {
  readonly cols: number
  readonly rows: number
  readonly full: boolean
  readonly bytes: string
}

export type StreamHandlers = {
  readonly frame: (frame: StreamFrame) => void
  readonly closed: (reason: string) => void
}

export type StreamCommand =
  | { readonly type: 'terminal.input'; readonly bytes: string }
  | {
      readonly type: 'terminal.scroll'
      readonly direction: 'up' | 'down'
      readonly lines: number
      readonly source: 'wheel'
    }
  | { readonly type: 'terminal.resize'; readonly cols: number; readonly rows: number }
  | { readonly type: 'terminal.release' }

export type Stream = {
  readonly mode: StreamMode
  readonly write: (command: StreamCommand) => void
  readonly stop: () => void
}

type StreamRecord = {
  readonly type?: string
  readonly full?: boolean
  readonly width?: number
  readonly height?: number
  readonly bytes?: string
  readonly reason?: string
}

type StreamState = { closed: boolean }

const NEWLINE = '\n'
const RELEASE_GRACE_MS = 500

export const HERDR_ENV = 'TOKENFALL_HERDR'
export const EXITED = 'exited'

export const herdrBinary = (env: NodeJS.ProcessEnv): string => env[HERDR_ENV] ?? 'herdr'

export const streamArgs = (
  herdr: string,
  mode: StreamMode,
  pane: string,
  cols: number,
  rows: number,
): string[] => [
  herdr,
  'terminal',
  'session',
  mode,
  pane,
  '--cols',
  String(cols),
  '--rows',
  String(rows),
]

const readLines = async (
  stream: ReadableStream<Uint8Array>,
  line: (text: string) => void,
): Promise<void> => {
  const decoder = new TextDecoder()
  let buffer = ''

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true })

    for (let at = buffer.indexOf(NEWLINE); at !== -1; at = buffer.indexOf(NEWLINE)) {
      line(buffer.slice(0, at))
      buffer = buffer.slice(at + 1)
    }
  }
}

const decodeRecord = (text: string): StreamRecord => {
  try {
    return decodeTrusted<StreamRecord | null>(text) ?? {}
  } catch {
    return {}
  }
}

export const openStream = (
  mode: StreamMode,
  pane: string,
  size: { readonly cols: number; readonly rows: number },
  handlers: StreamHandlers,
): Stream => {
  const child = Bun.spawn(streamArgs(herdrBinary(process.env), mode, pane, size.cols, size.rows), {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const state: StreamState = { closed: false }

  const close = (reason: string): void => {
    if (!state.closed) {
      state.closed = true
      handlers.closed(reason)
    }
  }

  const line = (text: string): void => {
    const record = decodeRecord(text)

    if (state.closed) {
      return
    }

    if (record.type === 'terminal.frame' && record.bytes !== undefined) {
      handlers.frame({
        cols: record.width ?? size.cols,
        rows: record.height ?? size.rows,
        full: record.full === true,
        bytes: record.bytes,
      })
    } else if (record.type === 'terminal.closed') {
      close(record.reason ?? '')
    }
  }

  const pump = async (): Promise<void> => {
    try {
      await readLines(child.stdout, line)
    } finally {
      close(EXITED)
    }
  }

  void pump()

  return {
    mode,
    write: (command) => {
      if (mode === 'control' && !state.closed) {
        void child.stdin.write(`${JSON.stringify(command)}${NEWLINE}`)
      }
    },
    stop: () => {
      const releasing = mode === 'control' && !state.closed
      state.closed = true

      if (!releasing) {
        child.kill()

        return
      }

      void child.stdin.write(`${JSON.stringify({ type: 'terminal.release' })}${NEWLINE}`)
      void child.stdin.end()
      setTimeout(() => {
        child.kill()
      }, RELEASE_GRACE_MS).unref()
    },
  }
}
