import type { PromptOutcome, Screen } from '@tokenfall/protocol/terminal'
import { createSignal, type Accessor } from 'solid-js'
import { heroOfEntity } from '../../core/hero-index.ts'
import type { Sim } from '../../core/sim.ts'
import { NOBODY } from '../../ui/bridge.ts'

export type Watcher = (hero: string | null) => void

export type Prompter = (hero: string, text: string) => Promise<PromptOutcome>

type SheetState = {
  watcher: Watcher | undefined
  prompter: Prompter | undefined
  hero: string | null
  sim: Sim | undefined
}

export type SheetModel = {
  readonly open: Accessor<number>
  readonly screen: Accessor<Screen | undefined>
  readonly live: boolean
  readonly show: (eid: number) => void
  readonly hide: () => void
  readonly receive: (screen: Screen) => void
  readonly connect: (sim: Sim, watcher: Watcher | undefined, prompter: Prompter | undefined) => void
  readonly prompt: (text: string) => Promise<PromptOutcome>
}

export const createSheet = (): SheetModel => {
  const [open, setOpen] = createSignal(NOBODY)
  const [screen, setScreen] = createSignal<Screen | undefined>(undefined)
  const state: SheetState = {
    watcher: undefined,
    prompter: undefined,
    hero: null,
    sim: undefined,
  }

  return {
    open,
    screen,
    get live() {
      return state.watcher !== undefined
    },
    show: (eid) => {
      if (state.sim === undefined) {
        return
      }

      state.hero = heroOfEntity(state.sim.index, eid)
      setScreen(undefined)
      setOpen(eid)
      state.watcher?.(state.hero)
    },
    hide: () => {
      state.hero = null
      setOpen(NOBODY)
      setScreen(undefined)
      state.watcher?.(null)
    },
    receive: (next) => {
      if (next.hero === state.hero) {
        setScreen(next)
      }
    },
    connect: (sim, watcher, prompter) => {
      state.sim = sim
      state.watcher = watcher
      state.prompter = prompter
    },
    prompt: (text) =>
      state.prompter === undefined || state.hero === null
        ? Promise.resolve('error')
        : state.prompter(state.hero, text),
  }
}
