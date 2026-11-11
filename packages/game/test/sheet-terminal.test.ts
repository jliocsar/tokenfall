import { describe, expect, test } from 'bun:test'
import sheetText from '@tokenfall/data/sheet.json'
import type { Frame } from '@tokenfall/protocol/terminal'
import { fitFont, overflows } from '../src/features/sheet/font.ts'
import { bufferFrame } from '../src/features/sheet/model.ts'

describe('terminal fit', () => {
  test('scales the font so the whole pane fits, within the font range', () => {
    const room = { width: 800, height: 600 }

    expect(fitFont(24, { width: 1600, height: 900 }, room)).toBe(12)
    expect(fitFont(10, { width: 400, height: 200 }, room)).toBe(20)
    expect(fitFont(10, { width: 100, height: 50 }, room)).toBe(sheetText.maxFontPx)
    expect(fitFont(24, { width: 99_999, height: 99_999 }, room)).toBe(sheetText.minFontPx)
    expect(overflows({ width: 801, height: 10 }, room)).toBe(true)
    expect(overflows({ width: 800, height: 600 }, room)).toBe(false)
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
