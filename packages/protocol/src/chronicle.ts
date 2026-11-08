import type { DeathCause, HeroId } from './hero.ts'

export type ChronicleKind = (typeof CHRONICLE_KINDS)[number]

export type ChronicleLine = {
  readonly seq: number
  readonly at: number
  readonly kind: ChronicleKind
  readonly hero: HeroId
  readonly title: string
  readonly level: number | null
  readonly cause: DeathCause | null
}

export const CHRONICLE_KINDS = ['joined', 'linked', 'level', 'died', 'resurrected'] as const
