import sheetText from '@tokenfall/data/sheet.json'
import type { Grid } from '@tokenfall/protocol/terminal'

export type Box = { readonly width: number; readonly height: number }

export type Measure = (px: number) => Box

const fits = (grid: Grid, cell: Box, room: Box): boolean =>
  cell.width > 0 &&
  cell.height > 0 &&
  grid.cols * cell.width <= room.width &&
  grid.rows * cell.height <= room.height

export const largestFont = (grid: Grid, room: Box, measure: Measure): number => {
  for (let px = sheetText.maxFontPx; px > sheetText.minFontPx; px--) {
    if (fits(grid, measure(px), room)) {
      return px
    }
  }

  return sheetText.minFontPx
}

export const shrinkFor = (grid: Grid, room: Box, cell: Box): number =>
  cell.width <= 0 || cell.height <= 0
    ? 1
    : Math.min(1, room.width / (grid.cols * cell.width), room.height / (grid.rows * cell.height))

export const gridAt = (cell: Box, room: Box): Grid | undefined => {
  if (cell.width <= 0 || cell.height <= 0) {
    return undefined
  }

  const { minCols, minRows } = sheetText.typingGrid

  return {
    cols: Math.max(minCols, Math.floor(room.width / cell.width)),
    rows: Math.max(minRows, Math.floor(room.height / cell.height)),
  }
}
