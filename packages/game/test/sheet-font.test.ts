import { describe, expect, test } from 'bun:test'
import sheetText from '@tokenfall/data/sheet.json'
import { createRoot } from 'solid-js'
import type { Frame } from '@tokenfall/protocol/terminal'
import { clampFont, createFontSize, readFont } from '../src/features/sheet/font.ts'
import { bufferFrame } from '../src/features/sheet/model.ts'

const memory = (): Storage => {
  const values = new Map<string, string>()

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
    clear: () => {
      values.clear()
    },
    key: () => null,
    get length() {
      return values.size
    },
  }
}

describe('sheet font', () => {
  test('starts at the default and clamps to the range', () => {
    expect(readFont(memory())).toBe(sheetText.fontPx)
    expect(clampFont(1)).toBe(sheetText.minFontPx)
    expect(clampFont(400)).toBe(sheetText.maxFontPx)
  })

  test('steps, stops at the edges and is remembered', () => {
    const storage = memory()
    createRoot((dispose) => {
      const font = createFontSize(storage)
      font.step(2)

      expect(font.px()).toBe(sheetText.fontPx + 2 * sheetText.stepPx)

      for (let i = 0; i < 100; i++) {
        font.step(1)
      }

      expect(font.px()).toBe(sheetText.maxFontPx)

      dispose()
    })

    expect(readFont(storage)).toBe(sheetText.maxFontPx)
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
