import '@wterm/dom/src/terminal.css'
import { WTerm } from '@wterm/dom'
import type { Screen } from '@tokenfall/protocol/terminal'

export type TerminalView = {
  readonly paint: (screen: Screen) => void
  readonly destroy: () => void
}

const TERMINAL_FONT = '400 14px "JetBrainsMono Nerd"'
const HOME_AND_CLEAR = '\u001B[H\u001B[2J'
const FALLBACK_COLS = 80
const FALLBACK_ROWS = 24
const ESC = 27
const FINAL_LOW = 64
const FINAL_HIGH = 126
const NEWLINE = 10

const widest = (text: string): number => {
  let best = 0
  let width = 0
  let escaping = false

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)

    if (code === NEWLINE) {
      best = Math.max(best, width)
      width = 0
    } else if (code === ESC) {
      escaping = true
      i += 1
    } else if (escaping) {
      escaping = code < FINAL_LOW || code > FINAL_HIGH
    } else {
      width += 1
    }
  }

  return Math.max(best, width)
}

export const mountTerminal = async (element: HTMLElement): Promise<TerminalView> => {
  await document.fonts.load(TERMINAL_FONT).catch(() => [])
  const term = new WTerm(element, {
    cols: FALLBACK_COLS,
    rows: FALLBACK_ROWS,
    autoResize: false,
    scrollbackLines: 0,
    cursorBlink: false,
    onData: () => undefined,
  })
  await term.init()
  const size = { cols: FALLBACK_COLS, rows: FALLBACK_ROWS }

  return {
    paint: (screen) => {
      const cols = screen.cols > 0 ? screen.cols : Math.max(1, widest(screen.text))
      const rows = Math.max(1, screen.rows)

      if (cols !== size.cols || rows !== size.rows) {
        size.cols = cols
        size.rows = rows
        term.resize(cols, rows)
      }

      term.write(HOME_AND_CLEAR + screen.text.replace(/\n$/u, '').replaceAll('\n', '\r\n'))
    },
    destroy: () => {
      term.destroy()
    },
  }
}
