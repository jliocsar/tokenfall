import sheetText from '@tokenfall/data/sheet.json'
import { init, Terminal } from 'ghostty-web'
import type { Frame } from '@tokenfall/protocol/terminal'

export type TerminalView = {
  readonly write: (frame: Frame) => void
  readonly font: (px: number) => void
  readonly destroy: () => void
}

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

export const mountTerminal = async (
  element: HTMLElement,
  fontPx: number,
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
    disableStdin: true,
    smoothScrollDuration: 0,
  })
  term.open(element)
  term.blur()
  term.textarea?.blur()
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
    destroy: () => {
      term.dispose()
    },
  }
}
