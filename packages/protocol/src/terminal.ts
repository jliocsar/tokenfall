import type { HeroId } from './hero.ts'

export type Watch = { readonly kind: 'watch'; readonly hero: HeroId }

export type Unwatch = { readonly kind: 'unwatch' }

export type Prompt = {
  readonly kind: 'prompt'
  readonly hero: HeroId
  readonly id: number
  readonly text: string
}

export type ClientMessage = Watch | Unwatch | Prompt

export type PromptOutcome = (typeof PROMPT_OUTCOMES)[number]

export type PromptResult = {
  readonly kind: 'prompt.result'
  readonly id: number
  readonly outcome: PromptOutcome
}

export type Frame = {
  readonly kind: 'frame'
  readonly hero: HeroId
  readonly alive: boolean
  readonly cols: number
  readonly rows: number
  readonly full: boolean
  readonly bytes: string
}

export const MAX_HERO_ID = 200
export const MAX_PROMPT = 16_000
export const PROMPT_OUTCOMES = ['sent', 'blocked', 'gone', 'refused', 'error'] as const
