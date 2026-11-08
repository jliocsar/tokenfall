import type {
  DeathCause,
  GuildKey,
  HeroId,
  HeroInfo,
  HeroStatus,
  PaneId,
  WorkspaceId,
} from './hero.ts'

export type HeroJoined = {
  readonly kind: 'hero.joined'
  readonly at: number
  readonly hero: HeroInfo
}

export type HeroStatusChanged = {
  readonly kind: 'hero.status'
  readonly at: number
  readonly hero: HeroId
  readonly status: HeroStatus
}

export type HeroQuestChanged = {
  readonly kind: 'hero.quest'
  readonly at: number
  readonly hero: HeroId
  readonly quest: string
}

export type HeroExperienceChanged = {
  readonly kind: 'hero.experience'
  readonly at: number
  readonly hero: HeroId
  readonly experience: number
  readonly catchUp: boolean
}

export type HeroMoved = {
  readonly kind: 'hero.moved'
  readonly at: number
  readonly hero: HeroId
  readonly pane: PaneId
  readonly workspace: WorkspaceId
  readonly guild: GuildKey
  readonly plot: number
}

export type HeroMinionsChanged = {
  readonly kind: 'hero.minions'
  readonly at: number
  readonly hero: HeroId
  readonly minions: number
}

export type HeroLinked = {
  readonly kind: 'hero.linked'
  readonly at: number
  readonly from: HeroId
  readonly to: HeroId
  readonly session: string
}

export type HeroDied = {
  readonly kind: 'hero.died'
  readonly at: number
  readonly hero: HeroId
  readonly cause: DeathCause
}

export type HeroResurrected = {
  readonly kind: 'hero.resurrected'
  readonly at: number
  readonly hero: HeroId
}

export type HeroEvent =
  | HeroJoined
  | HeroStatusChanged
  | HeroQuestChanged
  | HeroExperienceChanged
  | HeroMoved
  | HeroMinionsChanged
  | HeroLinked
  | HeroDied
  | HeroResurrected

export type HeroEventKind = HeroEvent['kind']
