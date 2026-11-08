import brave from '@tokenfall/data/narration/brave.json'
import cheerful from '@tokenfall/data/narration/cheerful.json'
import cunning from '@tokenfall/data/narration/cunning.json'
import grim from '@tokenfall/data/narration/grim.json'
import pious from '@tokenfall/data/narration/pious.json'
import scholarly from '@tokenfall/data/narration/scholarly.json'
import stoic from '@tokenfall/data/narration/stoic.json'
import wild from '@tokenfall/data/narration/wild.json'

export type Mood = 'working' | 'idle' | 'done' | 'blocked'

export type Narration = {
  readonly personality: string
  readonly status: Readonly<Record<Mood, readonly string[]>>
  readonly tools: Readonly<Partial<Record<string, readonly string[]>>>
  readonly generic: readonly string[]
}

const TABLES: readonly Narration[] = [brave, cheerful, cunning, grim, pious, scholarly, stoic, wild]

const BY_PERSONALITY: ReadonlyMap<string, Narration> = new Map(
  TABLES.map((table) => [table.personality, table]),
)

const pick = (pool: readonly string[], seed: number): string => pool[seed % pool.length]!

const tableOf = (personality: string): Narration => BY_PERSONALITY.get(personality) ?? brave

export const statusLine = (personality: string, mood: Mood, seed: number): string =>
  pick(tableOf(personality).status[mood], seed)

export const toolLine = (personality: string, tool: string, seed: number): string => {
  const table = tableOf(personality)

  return pick(table.tools[tool] ?? table.generic, seed)
}
