export type MachineId = string
export type HeroId = string
export type PaneId = string
export type WorkspaceId = string
export type GuildKey = string
export type HeroStatus = (typeof HERO_STATUSES)[number]
export type DeathCause = (typeof DEATH_CAUSES)[number]

export type HeroInfo = {
  readonly id: HeroId
  readonly machine: MachineId
  readonly pane: PaneId
  readonly workspace: WorkspaceId
  readonly guild: GuildKey
  readonly title: string
  readonly quest: string
  readonly status: HeroStatus
  readonly experience: number
  readonly minions: number
  readonly lead: boolean
  readonly alive: boolean
}

export const HERO_STATUSES = ['idle', 'working', 'done', 'blocked', 'unknown'] as const
export const DEATH_CAUSES = ['exited', 'killed', 'cleared', 'released', 'missing'] as const
export const LOCAL_MACHINE = 'local'

export const paneHeroId = (machine: MachineId, pane: PaneId): HeroId => `${machine}/pane/${pane}`

export const sessionHeroId = (machine: MachineId, session: string): HeroId =>
  `${machine}/session/${session}`
