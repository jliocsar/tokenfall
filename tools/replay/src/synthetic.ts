import type { HeroEvent } from '@tokenfall/protocol/events'
import {
  DEATH_CAUSES,
  LOCAL_MACHINE,
  NO_PLOT,
  sessionHeroId,
  type HeroInfo,
  type HeroStatus,
} from '@tokenfall/protocol/hero'

export type SyntheticOptions = {
  readonly seed: number
  readonly heroes: number
  readonly guilds: number
  readonly workspacesPerGuild: number
  readonly tempo: number
  readonly startAt: number
  readonly deaths?: boolean
}

export type Synthetic = {
  readonly heroes: readonly HeroInfo[]
  readonly step: (now: number, out: HeroEvent[]) => void
}

const STATUS_CODES: readonly HeroStatus[] = ['idle', 'working', 'done', 'blocked']
const IDLE = 0
const WORKING = 1
const DONE = 2
const BLOCKED = 3
const MEDIAN_EXPERIENCE = 1_930_000
const EXPERIENCE_SIGMA = 2.6
const MAX_EXPERIENCE = 4_000_000_000
const MEDIAN_TOKENS_PER_SECOND = 3000
const MEAN_IDLE_MS = 60_000
const MEAN_WORK_MS = 45_000
const MEAN_SEEN_MS = 20_000
const MEAN_BLOCKED_MS = 15_000
const MEAN_DEAD_MS = 60_000
const EXPERIENCE_EVERY_MS = 1000
const BLOCK_CHANCE = 0.12
const DEATH_CHANCE = 0.02
const FREQUENT_DEATHS = [0.25, 15_000] as const
const RARE_DEATHS = [DEATH_CHANCE, MEAN_DEAD_MS] as const
const RESURRECT_CHANCE = 0.5

const REPOS = [
  'tokenfall',
  'herdr',
  'crook',
  'pie',
  'fastlane',
  'atlas-api',
  'billing',
  'dotfiles',
  'ember-ui',
  'ledger',
  'lantern',
  'mapmaker',
] as const
const TITLES = [
  'code-reviewer',
  'planner',
  'tester',
  'scribe',
  'researcher',
  'refactorer',
  'migrator',
  'debugger',
] as const
const QUESTS = [
  'Refactor auth middleware',
  'Fix flaky payment tests',
  'Write the M2 daemon adapter',
  'Review PR 412',
  'Migrate config to TOML',
  'Profile the render loop',
  'Triage inbox questions',
  'Draft release notes',
  'Port the parser to Rust',
  'Chase a memory leak',
] as const

const TITLE_CHANCE = 0.25
const LEAD_EVERY = 2

const LIVING = {
  alive: true,
  diedAt: 0,
  cause: null,
  ravens: 0,
  ravenThread: null,
  ravenSince: 0,
} as const

const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const normal = (random: () => number): number =>
  Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())

const exponential = (random: () => number, mean: number): number => -Math.log(1 - random()) * mean

const pick = <T>(random: () => number, items: readonly T[]): T =>
  items[Math.floor(random() * items.length)]!

const repoPath = (guild: number): string => {
  const name = REPOS[guild % REPOS.length]!
  const round = Math.floor(guild / REPOS.length)

  return `/home/you/Projects/${round === 0 ? name : `${name}-${round + 1}`}`
}

const pickStatus = (roll: number): number => {
  if (roll < 0.4) {
    return WORKING
  }

  if (roll < 0.8) {
    return IDLE
  }

  return roll < 0.95 ? DONE : BLOCKED
}

const deathOf = (hero: string, index: number, now: number): HeroEvent => ({
  kind: 'hero.died',
  at: now,
  hero,
  cause: DEATH_CAUSES[index % DEATH_CAUSES.length]!,
})

const resurrectionOf = (hero: HeroInfo, experience: number, now: number): HeroEvent => ({
  kind: 'hero.resurrected',
  at: now,
  hero: hero.id,
  info: { ...hero, status: STATUS_CODES[IDLE]!, experience: Math.round(experience) },
})

export const createSynthetic = (options: SyntheticOptions): Synthetic => {
  const random = createRandom(options.seed)
  const count = options.heroes
  const status = new Uint8Array(count)
  const alive = new Uint8Array(count).fill(1)
  const nextChange = new Float64Array(count)
  const nextExperience = new Float64Array(count)
  const experience = new Float64Array(count)
  const tokensPerSecond = new Float64Array(count)
  const lastStep = new Float64Array(count).fill(options.startAt)
  const ids: string[] = []
  const heroes: HeroInfo[] = []
  const tempo = options.tempo
  const led = new Set<string>()
  const [deathChance, meanDeadMs] = options.deaths === true ? FREQUENT_DEATHS : RARE_DEATHS

  for (let i = 0; i < count; i++) {
    const guild = Math.floor(random() * options.guilds)
    const workspace = Math.floor(random() * options.workspacesPerGuild)
    const session = `synthetic-${options.seed}-${i}`
    const party = `w${guild}-${workspace}`
    const lead = !led.has(party) && i % LEAD_EVERY === 0

    if (lead) {
      led.add(party)
    }

    const id = sessionHeroId(LOCAL_MACHINE, session)
    ids.push(id)
    status[i] = pickStatus(random())
    experience[i] = Math.min(
      MAX_EXPERIENCE,
      MEDIAN_EXPERIENCE * Math.exp(normal(random) * EXPERIENCE_SIGMA),
    )
    tokensPerSecond[i] = MEDIAN_TOKENS_PER_SECOND * Math.exp(normal(random)) * tempo
    nextChange[i] = options.startAt + exponential(random, MEAN_IDLE_MS / tempo)
    nextExperience[i] = options.startAt + random() * EXPERIENCE_EVERY_MS
    heroes.push({
      id,
      session,
      machine: LOCAL_MACHINE,
      pane: `w${guild}:p${i}`,
      workspace: `w${guild}-${workspace}`,
      guild: repoPath(guild),
      plot: NO_PLOT,
      title: random() < TITLE_CHANCE ? pick(random, TITLES) : '',
      quest: pick(random, QUESTS),
      status: STATUS_CODES[status[i]!]!,
      experience: Math.round(experience[i]!),
      minions: random() < 0.2 ? Math.floor(random() * 8) : 0,
      lead,
      ...LIVING,
    })
  }

  const changeStatus = (i: number, now: number, out: HeroEvent[]): void => {
    const current = status[i]!
    let next = IDLE
    let mean = MEAN_IDLE_MS

    if (current === IDLE) {
      next = WORKING
      mean = MEAN_WORK_MS
    } else if (current === WORKING) {
      next = random() < BLOCK_CHANCE ? BLOCKED : DONE
      mean = next === BLOCKED ? MEAN_BLOCKED_MS : MEAN_SEEN_MS
    } else if (current === BLOCKED) {
      next = WORKING
      mean = MEAN_WORK_MS
    }

    status[i] = next
    nextChange[i] = now + exponential(random, mean / tempo)
    out.push({ kind: 'hero.status', at: now, hero: ids[i]!, status: STATUS_CODES[next]! })

    if (current === IDLE) {
      out.push({ kind: 'hero.quest', at: now, hero: ids[i]!, quest: pick(random, QUESTS) })
    }

    if (next === IDLE && random() < deathChance) {
      alive[i] = 0
      nextChange[i] = now + exponential(random, meanDeadMs / tempo)
      out.push(deathOf(ids[i]!, i, now))
    }
  }

  const reviveOrStay = (i: number, now: number, out: HeroEvent[]): void => {
    nextChange[i] = now + exponential(random, meanDeadMs / tempo)

    if (random() < RESURRECT_CHANCE) {
      alive[i] = 1
      status[i] = IDLE
      out.push(resurrectionOf(heroes[i]!, experience[i]!, now))
    }
  }

  const earn = (i: number, now: number, out: HeroEvent[]): void => {
    nextExperience[i] = now + EXPERIENCE_EVERY_MS
    const seconds = (now - lastStep[i]!) / 1000
    lastStep[i] = now

    if (status[i] !== WORKING || alive[i] === 0) {
      return
    }

    experience[i] = Math.min(MAX_EXPERIENCE, experience[i]! + tokensPerSecond[i]! * seconds)
    out.push({
      kind: 'hero.experience',
      at: now,
      hero: ids[i]!,
      experience: Math.round(experience[i]),
      catchUp: false,
    })
  }

  const step = (now: number, out: HeroEvent[]): void => {
    for (let i = 0; i < count; i++) {
      if (now >= nextChange[i]!) {
        if (alive[i] === 1) {
          changeStatus(i, now, out)
        } else {
          reviveOrStay(i, now, out)
        }
      }

      if (now >= nextExperience[i]!) {
        earn(i, now, out)
      }
    }
  }

  return { heroes, step }
}
