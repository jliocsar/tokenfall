import sheetText from '@tokenfall/data/sheet.json'
import { init, Terminal } from 'ghostty-web'
import type { Frame } from '@tokenfall/protocol/terminal'

export type TerminalView = {
  readonly write: (frame: Frame) => void
  readonly font: (px: number) => void
  readonly blur: () => void
  readonly destroy: () => void
}

export type Typed = (bytes: string) => void

type Engine = { ready: Promise<void> | undefined }

const TERMINAL_FONT = '400 14px "JetBrainsMono Nerd"'
const FALLBACK_COLS = 80
const FALLBACK_ROWS = 24

const engine: Engine = { ready: undefined }

const decodeBytes = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

const nextTask = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0)
  })

const encodeText = (text: string): string => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

export const mountTerminal = async (
  element: HTMLElement,
  fontPx: number,
  typed: Typed,
): Promise<TerminalView> => {
  await document.fonts.load(TERMINAL_FONT).catch(() => [])
  engine.ready ??= init()
  await engine.ready
  const term = new Terminal({
    cols: FALLBACK_COLS,
    rows: FALLBACK_ROWS,
    fontSize: fontPx,
    fontFamily: sheetText.terminal.fontFamily,
    theme: sheetText.terminal.theme,
    cursorBlink: false,
    smoothScrollDuration: 0,
  })
  term.open(element)
  await nextTask()
  term.blur()
  term.textarea?.blur()
  term.onData((data) => {
    typed(encodeText(data))
  })
  const size = { cols: FALLBACK_COLS, rows: FALLBACK_ROWS }

  return {
    write: (frame) => {
      if (
        frame.cols > 0 &&
        frame.rows > 0 &&
        (frame.cols !== size.cols || frame.rows !== size.rows)
      ) {
        size.cols = frame.cols
        size.rows = frame.rows
        term.resize(frame.cols, frame.rows)
      }

      const bytes = decodeBytes(frame.bytes)

      if (bytes.length > 0) {
        term.write(bytes)
      }
    },
    font: (px) => {
      term.options.fontSize = px
    },
    blur: () => {
      term.textarea?.blur()
      term.blur()
    },
    destroy: () => {
      term.dispose()
    },
  }
}
