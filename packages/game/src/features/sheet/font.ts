import sheetText from '@tokenfall/data/sheet.json'
import { createSignal, type Accessor } from 'solid-js'

export type FontStorage = Pick<Storage, 'getItem' | 'setItem'>

export type FontSize = {
  readonly px: Accessor<number>
  readonly step: (by: number) => void
}

const FONT_KEY = 'tokenfall.sheet.fontPx'

export const clampFont = (px: number): number =>
  Math.min(sheetText.maxFontPx, Math.max(sheetText.minFontPx, Math.round(px)))

export const readFont = (storage: FontStorage): number => {
  const saved = Number(storage.getItem(FONT_KEY))

  return saved > 0 ? clampFont(saved) : sheetText.fontPx
}

export const rowHeightOf = (px: number): number => Math.ceil(px * sheetText.lineHeight)

export const createFontSize = (storage: FontStorage): FontSize => {
  const [px, setPx] = createSignal(readFont(storage))

  return {
    px,
    step: (by) => {
      const next = clampFont(px() + by * sheetText.stepPx)
      setPx(next)
      storage.setItem(FONT_KEY, String(next))
    },
  }
}
