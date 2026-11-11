import { describe, expect, test } from 'bun:test'
import sheetText from '@tokenfall/data/sheet.json'
import type { Frame } from '@tokenfall/protocol/terminal'
import { gridAt, largestFont, type Box } from '../src/features/sheet/font.ts'
import { bufferFrame } from '../src/features/sheet/model.ts'

describe('terminal fit', () => {
  test('picks the largest font whose cells fit the whole grid in the room', () => {
    const measure = (px: number): Box => ({ width: Math.ceil(px * 0.6), height: px + 4 })
    const grid = { cols: 233, rows: 53 }

    expect(largestFont(grid, { width: 1471, height: 876 }, measure)).toBe(10)
    expect(largestFont({ cols: 163, rows: 51 }, { width: 1471, height: 876 }, measure)).toBe(13)
    expect(largestFont({ cols: 10, rows: 5 }, { width: 1471, height: 876 }, measure)).toBe(
      sheetText.maxFontPx,
    )
    expect(largestFont(grid, { width: 100, height: 100 }, measure)).toBe(sheetText.minFontPx)
  })

  test('the typing grid is what fits the room at the typing cell size', () => {
    const { minCols, minRows } = sheetText.typingGrid

    expect(gridAt({ width: 9, height: 17 }, { width: 1471, height: 876 })).toEqual({
      cols: 163,
      rows: 51,
    })
    expect(gridAt({ width: 9, height: 17 }, { width: 10, height: 10 })).toEqual({
      cols: minCols,
      rows: minRows,
    })
    expect(gridAt({ width: 0, height: 0 }, { width: 100, height: 100 })).toBeUndefined()
  })
})

const frame = (full: boolean, bytes: string): Frame => ({
  kind: 'frame',
  hero: 'h',
  alive: true,
  cols: 80,
  rows: 24,
  full,
  bytes,
})

describe('frames before the terminal mounts', () => {
  test('keep from the last full frame on, and drop diffs with no full frame', () => {
    const pending: Frame[] = []
    bufferFrame(pending, frame(false, 'lost'))
    bufferFrame(pending, frame(true, 'a'))
    bufferFrame(pending, frame(false, 'b'))
    bufferFrame(pending, frame(true, 'c'))
    bufferFrame(pending, frame(false, 'd'))

    expect(pending.map((entry) => entry.bytes)).toEqual(['c', 'd'])
  })
})
