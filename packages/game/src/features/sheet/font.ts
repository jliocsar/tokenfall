import sheetText from '@tokenfall/data/sheet.json'

export type Box = { readonly width: number; readonly height: number }

export const clampFont = (px: number): number =>
  Math.min(sheetText.maxFontPx, Math.max(sheetText.minFontPx, Math.floor(px)))

export const fitFont = (px: number, drawn: Box, room: Box): number =>
  drawn.width <= 0 || drawn.height <= 0
    ? clampFont(px)
    : clampFont(px * Math.min(room.width / drawn.width, room.height / drawn.height))

export const overflows = (drawn: Box, room: Box): boolean =>
  drawn.width > room.width || drawn.height > room.height
