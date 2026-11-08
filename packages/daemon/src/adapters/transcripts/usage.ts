import { decodeTrusted } from '@tokenfall/protocol/json'
import type { Usage } from '../../store/ledger.ts'

type TranscriptUsage = {
  readonly input_tokens?: number
  readonly cache_creation_input_tokens?: number
  readonly cache_read_input_tokens?: number
  readonly output_tokens?: number
}

type TranscriptLine = {
  readonly type?: string
  readonly message?: { readonly id?: string; readonly usage?: TranscriptUsage }
}

const USAGE_MARK = '"usage"'
const ASSISTANT = 'assistant'

const decode = (line: string): TranscriptLine | undefined => {
  try {
    return decodeTrusted<TranscriptLine | null>(line) ?? undefined
  } catch {
    return undefined
  }
}

const count = (value: number | undefined): number =>
  value !== undefined && Number.isFinite(value) ? value : 0

export const usageOf = (line: string): Usage | undefined => {
  if (!line.includes(USAGE_MARK)) {
    return undefined
  }

  const entry = decode(line)
  const id = entry?.message?.id
  const usage = entry?.message?.usage

  if (entry?.type !== ASSISTANT || id === undefined || usage === undefined) {
    return undefined
  }

  return {
    id,
    input: count(usage.input_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    output: count(usage.output_tokens),
  }
}
