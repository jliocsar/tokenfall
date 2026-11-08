import { createWorld, type World } from 'bitecs'
import type { Characters } from './character.ts'
import { createGroups, type Groups } from './groups.ts'
import { buildTown, type Town, type TownTuning } from './layout.ts'
import type { HeroEvent } from '@tokenfall/protocol/events'
import { createDenseSet, type DenseSet } from './dense-set.ts'
import { compileMachine, inputId, stateFlags, type Machine, type MachineDefinition } from './fsm.ts'
import { createHeroIndex, type HeroIndex } from './hero-index.ts'
import { levelThresholds, type LevelCurve } from '@tokenfall/protocol/level'
import { createQueue, type Queue } from './queue.ts'
import { mulberry32, type Random } from './random.ts'
import { createArena, createStore, type Arena } from './store.ts'
import { createTimerHeap, type TimerHeap } from './timers.ts'

export type Budgets = {
  readonly entities: number
  readonly heroes: number
  readonly timers: number
  readonly inboundEvents: number
  readonly transitionsPerFrame: number
  readonly spawnsPerFrame: number
  readonly effectEmittersPerKind: number
  readonly levelUpBurstsPerFrame: number
  readonly guilds: number
  readonly parties: number
}

export type WorldTuning = {
  readonly deathFadeMs: number
  readonly walkSpeed: number
  readonly wanderEveryMs: readonly number[]
  readonly wanderRadius: number
  readonly wanderStates: readonly string[]
}

export type SimConfig = {
  readonly budgets: Budgets
  readonly machine: MachineDefinition
  readonly curve: LevelCurve
  readonly tuning: WorldTuning
  readonly seed: number
  readonly sheets: number
  readonly town: TownTuning
  readonly characters: Characters
}

export type Stores = ReturnType<typeof createStores>

export type Transitions = {
  readonly eid: Uint32Array
  readonly from: Uint8Array
  readonly to: Uint8Array
  count: number
  dropped: number
}

export type EffectKindState = {
  readonly name: string
  readonly particles: number
  readonly lifetimeMs: number
  readonly attached: boolean
  readonly loop: boolean
  readonly data: Float32Array
  readonly used: Uint8Array
  readonly free: Uint16Array
  freeCount: number
  highWater: number
  active: number
  dirty: boolean
  dropped: number
}

export type HeroText = {
  readonly name: string[]
  readonly title: string[]
  readonly quest: string[]
  readonly tool: string[]
  readonly ravenThread: string[]
}

export type Counters = {
  joined: number
  deferredJoins: number
  died: number
  resurrected: number
  levelUps: number
  burstsSkipped: number
  unknownHeroEvents: number
}

export type Sim = {
  readonly world: World
  readonly arena: Arena
  readonly config: SimConfig
  readonly machine: Machine
  readonly inputs: Readonly<Record<string, number>>
  readonly index: HeroIndex
  readonly timers: TimerHeap
  readonly inbound: Queue<HeroEvent>
  readonly stores: Stores
  readonly heroTag: object
  readonly effectTag: object
  readonly moving: DenseSet
  readonly attachedEmitters: DenseSet
  readonly transitions: Transitions
  readonly levelUps: DenseSet
  readonly auraCheck: DenseSet
  readonly auraOf: Int32Array
  readonly changed: DenseSet
  readonly statusChanged: DenseSet
  readonly toolChanged: DenseSet
  readonly wanders: Uint8Array
  readonly thresholds: Float64Array
  readonly groups: Groups
  readonly text: HeroText
  readonly town: Town
  readonly effects: EffectKindState[]
  readonly scratch: Float64Array
  readonly random: Random
  readonly counters: Counters
  readonly epoch: number
  spawnsThisFrame: number
}

export const NO_AURA = -1
export const TIMER_STATE = 0
export const TIMER_WANDER = 1
export const TIMER_EFFECT_END = 2

const createStores = (arena: Arena, entities: number) => ({
  hero: createStore(
    arena,
    'Hero',
    {
      status: 'u8',
      sheet: 'u8',
      personality: 'u8',
      level: 'u8',
      guild: 'u16',
      party: 'u16',
      experience: 'f64',
      minions: 'u16',
      ravens: 'u16',
      statusSince: 'f64',
      ravenSince: 'f64',
    },
    entities,
  ),
  behavior: createStore(arena, 'Behavior', { state: 'u8', serial: 'u32', since: 'f64' }, entities),
  position: createStore(arena, 'Position', { x: 'f32', y: 'f32' }, entities),
  anchor: createStore(arena, 'Anchor', { x: 'f32', y: 'f32' }, entities),
  motion: createStore(arena, 'Motion', { tx: 'f32', ty: 'f32', speed: 'f32', dir: 'u8' }, entities),
  emitter: createStore(
    arena,
    'Emitter',
    { kind: 'u8', slot: 'u16', serial: 'u32', target: 'i32', end: 'f64' },
    entities,
  ),
})

export const createSim = (config: SimConfig, epoch: number): Sim => {
  const { budgets } = config
  const arena = createArena()
  const machine = compileMachine(config.machine)
  const inputs = Object.fromEntries(machine.inputs.map((name) => [name, inputId(machine, name)]))

  return {
    world: createWorld(),
    arena,
    config,
    machine,
    inputs,
    index: createHeroIndex(budgets.heroes, budgets.entities),
    timers: createTimerHeap(budgets.timers),
    inbound: createQueue<HeroEvent>(budgets.inboundEvents),
    stores: createStores(arena, budgets.entities),
    heroTag: {},
    effectTag: {},
    moving: createDenseSet(budgets.entities),
    attachedEmitters: createDenseSet(budgets.entities),
    transitions: {
      eid: new Uint32Array(budgets.transitionsPerFrame),
      from: new Uint8Array(budgets.transitionsPerFrame),
      to: new Uint8Array(budgets.transitionsPerFrame),
      count: 0,
      dropped: 0,
    },
    levelUps: createDenseSet(budgets.entities),
    auraCheck: createDenseSet(budgets.entities),
    auraOf: new Int32Array(budgets.entities).fill(NO_AURA),
    changed: createDenseSet(budgets.entities),
    statusChanged: createDenseSet(budgets.entities),
    toolChanged: createDenseSet(budgets.entities),
    wanders: stateFlags(machine, config.tuning.wanderStates),
    thresholds: levelThresholds(config.curve),
    groups: createGroups(budgets.guilds, budgets.parties),
    text: {
      name: Array.from({ length: budgets.entities }, () => ''),
      title: Array.from({ length: budgets.entities }, () => ''),
      quest: Array.from({ length: budgets.entities }, () => ''),
      tool: Array.from({ length: budgets.entities }, () => ''),
      ravenThread: Array.from({ length: budgets.entities }, () => ''),
    },
    town: buildTown(config.seed, config.town, budgets.guilds),
    effects: [],
    scratch: new Float64Array(4),
    random: mulberry32(config.seed),
    counters: {
      joined: 0,
      deferredJoins: 0,
      died: 0,
      resurrected: 0,
      levelUps: 0,
      burstsSkipped: 0,
      unknownHeroEvents: 0,
    },
    epoch,
    spawnsThisFrame: 0,
  }
}
