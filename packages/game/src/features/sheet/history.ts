import sheetText from '@tokenfall/data/sheet.json'
import { decodeTrusted } from '@tokenfall/protocol/json'

export type HistoryStorage = Pick<Storage, 'getItem' | 'setItem'>

const HISTORY_KEY = 'tokenfall.prompts'

export const readHistory = (storage: HistoryStorage): string[] => {
  const raw = storage.getItem(HISTORY_KEY)

  if (raw === null) {
    return []
  }

  try {
    return [...decodeTrusted<readonly string[]>(raw)]
  } catch {
    return []
  }
}

export const remember = (history: readonly string[], text: string): string[] =>
  [...history.filter((entry) => entry !== text), text].slice(-sheetText.prompt.history)

export const saveHistory = (storage: HistoryStorage, history: readonly string[]): void => {
  storage.setItem(HISTORY_KEY, JSON.stringify(history))
}

export const recall = (history: readonly string[], cursor: number, step: number): number =>
  Math.max(0, Math.min(history.length, cursor + step))
