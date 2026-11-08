import type { HeroId } from './hero.ts'

export type Watch = { readonly kind: 'watch'; readonly hero: HeroId }

export type Unwatch = { readonly kind: 'unwatch' }

export type ClientMessage = Watch | Unwatch

export type Screen = {
  readonly kind: 'screen'
  readonly hero: HeroId
  readonly alive: boolean
  readonly cols: number
  readonly rows: number
  readonly text: string
}

export const MAX_HERO_ID = 200
