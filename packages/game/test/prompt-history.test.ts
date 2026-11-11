import { describe, expect, test } from 'bun:test'
import sheetText from '@tokenfall/data/sheet.json'
import { readHistory, recall, remember, saveHistory } from '../src/features/sheet/history.ts'

const memory = () => {
  const values = new Map<string, string>()

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe('prompt history', () => {
  test('keeps the newest prompts last, without repeats, up to the cap', () => {
    let history: string[] = []

    for (let i = 0; i < sheetText.prompt.history + 5; i++) {
      history = remember(history, `prompt ${i}`)
    }

    history = remember(history, 'prompt 10')

    expect(history).toHaveLength(sheetText.prompt.history)
    expect(history.at(-1)).toBe('prompt 10')
    expect(history.filter((entry) => entry === 'prompt 10')).toHaveLength(1)
  })

  test('survives a round trip and ignores a broken save', () => {
    const storage = memory()
    saveHistory(storage, ['a', 'b'])

    expect(readHistory(storage)).toEqual(['a', 'b'])

    storage.setItem('tokenfall.prompts', '{oops')

    expect(readHistory(storage)).toEqual([])
  })

  test('browsing stops at both ends', () => {
    const history = ['a', 'b']

    expect(recall(history, 0, -1)).toBe(0)
    expect(recall(history, 2, 1)).toBe(2)
    expect(recall(history, 2, -1)).toBe(1)
  })
})
