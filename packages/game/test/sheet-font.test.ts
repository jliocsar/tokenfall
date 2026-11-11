import { describe, expect, test } from 'bun:test'
import sheetText from '@tokenfall/data/sheet.json'
import { createRoot } from 'solid-js'
import { clampFont, createFontSize, readFont, rowHeightOf } from '../src/features/sheet/font.ts'

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

  test('rows grow with the font', () => {
    expect(rowHeightOf(20)).toBeGreaterThan(rowHeightOf(sheetText.minFontPx))
  })
})
