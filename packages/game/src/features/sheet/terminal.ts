import sheetText from '@tokenfall/data/sheet.json'
import { init, Terminal } from 'ghostty-web'
import type { Frame, Grid } from '@tokenfall/protocol/terminal'
import { gridAt, largestFont, type Box } from './font.ts'

export type TerminalView = {
  readonly write: (frame: Frame) => boolean
  readonly fit: (room: Box) => void
  readonly grid: (room: Box) => Grid | undefined
  readonly blur: () => void
  readonly destroy: () => void
}

export type Typed = (bytes: string) => void

type Engine = {
  ready: Promise<void> | undefined
  measuring: CanvasRenderingContext2D | null | undefined
}

const TERMINAL_FONT = '400 14px "JetBrainsMono Nerd"'
const FALLBACK_COLS = 80
const FALLBACK_ROWS = 24

const engine: Engine = { ready: undefined, measuring: undefined }

const decodeBytes = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

const GLYPH_PAD_PX = 2
const ASCENT_SHARE = 0.8
const DESCENT_SHARE = 0.2
const MEASURED_GLYPH = 'M'

const orShare = (measured: number, px: number, share: number): number =>
  measured === 0 ? px * share : measured

const cellAt = (px: number): Box => {
  engine.measuring ??= document.createElement('canvas').getContext('2d')
  const context = engine.measuring

  if (context === null) {
    return { width: 0, height: 0 }
  }

  context.font = `${px}px ${sheetText.terminal.fontFamily}`
  const glyph = context.measureText(MEASURED_GLYPH)

  return {
    width: Math.ceil(glyph.width),
    height:
      Math.ceil(
        orShare(glyph.actualBoundingBoxAscent, px, ASCENT_SHARE) +
          orShare(glyph.actualBoundingBoxDescent, px, DESCENT_SHARE),
      ) + GLYPH_PAD_PX,
  }
}

const nextTask = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0)
  })

const fitTo = (term: Terminal, grid: Grid, room: Box): void => {
  if (room.width <= 0 || room.height <= 0) {
    return
  }

  const px = largestFont(grid, room, cellAt)

  if (term.options.fontSize !== px) {
    term.options.fontSize = px
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
      fitTo(term, size, room)
    },
    grid: (room) => gridAt(cellAt(sheetText.typingGrid.fontPx), room),
    blur: () => {
      term.textarea?.blur()
      term.blur()
    },
    destroy: () => {
      term.dispose()
    },
  }
}
