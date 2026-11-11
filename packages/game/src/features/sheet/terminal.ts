import sheetText from '@tokenfall/data/sheet.json'
import { init, Terminal } from 'ghostty-web'
import type { Frame } from '@tokenfall/protocol/terminal'
import { clampFont, fitFont, overflows, type Box } from './font.ts'

export type TerminalView = {
  readonly write: (frame: Frame) => boolean
  readonly fit: (room: Box) => void
  readonly blur: () => void
  readonly destroy: () => void
}

export type Typed = (bytes: string) => void

type Engine = { ready: Promise<void> | undefined }

const TERMINAL_FONT = '400 14px "JetBrainsMono Nerd"'
const FALLBACK_COLS = 80
const FALLBACK_ROWS = 24
const FIT_TRIES = 6

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

const drawnBox = (element: HTMLElement): Box => {
  const canvas = element.querySelector('canvas')

  return { width: canvas?.offsetWidth ?? 0, height: canvas?.offsetHeight ?? 0 }
}

const fitTo = (term: Terminal, element: HTMLElement, room: Box): void => {
  if (room.width <= 0 || room.height <= 0) {
    return
  }

  for (let tries = 0; tries < FIT_TRIES; tries++) {
    const px = term.options.fontSize ?? sheetText.maxFontPx
    const drawn = drawnBox(element)
    const fitted = overflows(drawn, room)
      ? clampFont(Math.min(px - 1, fitFont(px, drawn, room)))
      : fitFont(px, drawn, room)

    if (fitted === px || (fitted > px && tries > 0)) {
      return
    }

    term.options.fontSize = fitted
  }
}

const encodeText = (text: string): string => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

export const mountTerminal = async (element: HTMLElement, typed: Typed): Promise<TerminalView> => {
  await document.fonts.load(TERMINAL_FONT).catch(() => [])
  engine.ready ??= init()
  await engine.ready
  const term = new Terminal({
    cols: FALLBACK_COLS,
    rows: FALLBACK_ROWS,
    fontSize: sheetText.maxFontPx,
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
      const resized =
        frame.cols > 0 && frame.rows > 0 && (frame.cols !== size.cols || frame.rows !== size.rows)

      if (resized) {
        size.cols = frame.cols
        size.rows = frame.rows
        term.resize(frame.cols, frame.rows)
      }

      const bytes = decodeBytes(frame.bytes)

      if (bytes.length > 0) {
        term.write(bytes)
      }

      return resized
    },
    fit: (room) => {
      fitTo(term, element, room)
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
