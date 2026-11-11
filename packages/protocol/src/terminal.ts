import type { HeroId } from './hero.ts'

export type Watch = { readonly kind: 'watch'; readonly hero: HeroId }

export type Unwatch = { readonly kind: 'unwatch' }

export type Grid = { readonly cols: number; readonly rows: number }

export type Focus = { readonly kind: 'focus' } & Grid

export type Resize = { readonly kind: 'resize' } & Grid

export type Blur = { readonly kind: 'blur' }

export type Input = { readonly kind: 'input'; readonly bytes: string }

export type ScrollDirection = 'up' | 'down'

export type Scroll = {
  readonly kind: 'scroll'
  readonly direction: ScrollDirection
  readonly lines: number
}

export type ClientMessage = Watch | Unwatch | Focus | Resize | Blur | Input | Scroll

export type Frame = {
  readonly kind: 'frame'
  readonly hero: HeroId
  readonly alive: boolean
  readonly cols: number
  readonly rows: number
  readonly full: boolean
  readonly bytes: string
}

export type ControlState = (typeof CONTROL_STATES)[number]

export type Control = { readonly kind: 'control'; readonly state: ControlState }

export const MAX_HERO_ID = 200
export const MAX_INPUT = 1_000_000
export const MAX_SCROLL = 500
export const MAX_GRID = 1000
export const CONTROL_STATES = ['held', 'busy', 'released'] as const
