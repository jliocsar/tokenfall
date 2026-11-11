import sheetText from '@tokenfall/data/sheet.json'
import { init, Terminal } from 'ghostty-web'
import type { Frame, Grid } from '@tokenfall/protocol/terminal'
import { gridAt, largestFont, shrinkFor, type Box } from './font.ts'

export type TerminalView = {
  readonly push: (frame: Frame) => void
  readonly fit: (room: Box) => void
  readonly grid: () => Grid | undefined
  readonly blur: () => void
  readonly destroy: () => void
}

export type TerminalHandlers = {
  readonly typed: (bytes: string) => void
  readonly resized: (grid: Grid | undefined) => void
}

type Engine = {
  ready: Promise<void> | undefined
  measuring: CanvasRenderingContext2D | null | undefined
}

type Base64 = { readonly fromBase64?: (text: string) => Uint8Array }

type ViewState = {
  readonly size: { cols: number; rows: number }
  room: Box
  shrink: number
  readonly held: Frame[]
  holding: boolean
  quiet: ReturnType<typeof setTimeout> | undefined
  limit: ReturnType<typeof setTimeout> | undefined
  settle: ReturnType<typeof setTimeout> | undefined
}

const TERMINAL_FONT = '400 14px "JetBrainsMono Nerd"'
const FALLBACK_COLS = 80
const FALLBACK_ROWS = 24
const GLYPH_PAD_PX = 2
const ASCENT_SHARE = 0.8
const DESCENT_SHARE = 0.2
const MEASURED_GLYPH = 'M'
const SHRINK_VAR = '--terminal-shrink'

const engine: Engine = { ready: undefined, measuring: undefined }
const cells: Box[] = []
const native: Base64 = Uint8Array

const decodeBytes = (base64: string): Uint8Array => {
  if (native.fromBase64 !== undefined) {
    return native.fromBase64(base64)
  }

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

const orShare = (measured: number, px: number, share: number): number =>
  measured === 0 ? px * share : measured

const measure = (px: number): Box => {
  engine.measuring ??= document.createElement('canvas').getContext('2d')
  const context = engine.measuring

  if (context === null) {
    return { width: 0, height: 0 }
  }

  context.font = `${px}px ${sheetText.terminal.fontFamily}`
  const glyph = context.measureText(MEASURED_GLYPH)
  const ascent = orShare(glyph.actualBoundingBoxAscent, px, ASCENT_SHARE)
  const descent = orShare(glyph.actualBoundingBoxDescent, px, DESCENT_SHARE)

  return { width: Math.ceil(glyph.width), height: Math.ceil(ascent + descent) + GLYPH_PAD_PX }
}

const cellAt = (px: number): Box => {
  const known = cells[px]

  if (known !== undefined && known.width > 0) {
    return known
  }

  const cell = measure(px)
  cells[px] = cell

  return cell
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

const fitTo = (term: Terminal, element: HTMLElement, state: ViewState): void => {
  if (state.room.width <= 0 || state.room.height <= 0) {
    return
  }

  const px = largestFont(state.size, state.room, cellAt)
  const shrink = shrinkFor(state.size, state.room, cellAt(px))

  if (term.options.fontSize !== px) {
    term.options.fontSize = px
  }

  if (shrink !== state.shrink) {
    state.shrink = shrink
    element.style.setProperty(SHRINK_VAR, String(shrink))
  }
}

const writeFrame = (term: Terminal, element: HTMLElement, state: ViewState, frame: Frame): void => {
  const resized =
    frame.cols > 0 &&
    frame.rows > 0 &&
    (frame.cols !== state.size.cols || frame.rows !== state.size.rows)

  if (resized) {
    state.size.cols = frame.cols
    state.size.rows = frame.rows
    fitTo(term, element, state)
    term.resize(frame.cols, frame.rows)
  }

  const bytes = decodeBytes(frame.bytes)

  if (bytes.length > 0) {
    term.write(bytes)
  }
}

const createTerm = (): Terminal =>
  new Terminal({
    cols: FALLBACK_COLS,
    rows: FALLBACK_ROWS,
    fontSize: sheetText.minFontPx,
    fontFamily: sheetText.terminal.fontFamily,
    theme: sheetText.terminal.theme,
    cursorBlink: false,
    smoothScrollDuration: 0,
  })

export const mountTerminal = async (
  element: HTMLElement,
  handlers: TerminalHandlers,
): Promise<TerminalView> => {
  await document.fonts.load(TERMINAL_FONT).catch(() => [])
  engine.ready ??= init()
  await engine.ready
  const term = createTerm()
  term.open(element)
  await nextTask()
  term.blur()
  term.textarea?.blur()
  term.onData((data) => {
    handlers.typed(encodeText(data))
  })
  const state: ViewState = {
    size: { cols: FALLBACK_COLS, rows: FALLBACK_ROWS },
    room: { width: 0, height: 0 },
    shrink: 1,
    held: [],
    holding: false,
    quiet: undefined,
    limit: undefined,
    settle: undefined,
  }

  const flush = (): void => {
    clearTimeout(state.quiet)
    clearTimeout(state.limit)
    state.holding = false

    for (const frame of state.held) {
      writeFrame(term, element, state, frame)
    }

    state.held.length = 0
  }

  const grid = (): Grid | undefined => gridAt(cellAt(sheetText.typingGrid.readablePx), state.room)

  return {
    push: (frame) => {
      const resizing =
        state.size.cols !== FALLBACK_COLS &&
        (frame.cols !== state.size.cols || frame.rows !== state.size.rows)

      if (!state.holding && !resizing) {
        writeFrame(term, element, state, frame)

        return
      }

      state.held.push(frame)
      clearTimeout(state.quiet)
      state.quiet = setTimeout(flush, sheetText.settle.quietMs)

      if (!state.holding) {
        state.holding = true
        state.limit = setTimeout(flush, sheetText.settle.maxMs)
      }
    },
    fit: (room) => {
      state.room = room
      fitTo(term, element, state)
      clearTimeout(state.settle)
      state.settle = setTimeout(() => {
        handlers.resized(grid())
      }, sheetText.settle.resizeMs)
    },
    grid,
    blur: () => {
      term.textarea?.blur()
      term.blur()
    },
    destroy: () => {
      clearTimeout(state.quiet)
      clearTimeout(state.limit)
      clearTimeout(state.settle)
      term.dispose()
    },
  }
}
