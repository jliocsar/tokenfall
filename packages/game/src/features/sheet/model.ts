import type { Frame, PromptOutcome } from '@tokenfall/protocol/terminal'
import { createSignal, type Accessor } from 'solid-js'
import { heroOfEntity } from '../../core/hero-index.ts'
import type { Sim } from '../../core/sim.ts'
import { NOBODY } from '../../ui/bridge.ts'

export type Watcher = (hero: string | null) => void

export type Prompter = (hero: string, text: string) => Promise<PromptOutcome>

export type FrameListener = (frame: Frame) => void

export type TerminalState = 'waiting' | 'alive' | 'fallen'

type SheetState = {
  watcher: Watcher | undefined
  prompter: Prompter | undefined
  listener: FrameListener | undefined
  readonly pending: Frame[]
  hero: string | null
  sim: Sim | undefined
}

export type SheetModel = {
  readonly open: Accessor<number>
  readonly terminal: Accessor<TerminalState>
  readonly live: boolean
  readonly show: (eid: number) => void
  readonly hide: () => void
  readonly receive: (frame: Frame) => void
  readonly listen: (listener: FrameListener | undefined) => void
  readonly connect: (sim: Sim, watcher: Watcher | undefined, prompter: Prompter | undefined) => void
  readonly prompt: (text: string) => Promise<PromptOutcome>
}

const PENDING_FRAMES = 256

export const bufferFrame = (pending: Frame[], frame: Frame): void => {
  if (frame.full || pending.length >= PENDING_FRAMES) {
    pending.length = 0
  }

  if (frame.full || pending.length > 0) {
    pending.push(frame)
  }
}

const deliver = (state: SheetState, frame: Frame): void => {
  if (state.listener === undefined) {
    bufferFrame(state.pending, frame)
  } else {
    state.listener(frame)
  }
}

export const createSheet = (): SheetModel => {
  const [open, setOpen] = createSignal(NOBODY)
  const [terminal, setTerminal] = createSignal<TerminalState>('waiting')
  const state: SheetState = {
    watcher: undefined,
    prompter: undefined,
    listener: undefined,
    pending: [],
    hero: null,
    sim: undefined,
  }

  return {
    open,
    terminal,
    get live() {
      return state.watcher !== undefined
    },
    show: (eid) => {
      if (state.sim === undefined) {
        return
      }

      state.hero = heroOfEntity(state.sim.index, eid)
      state.pending.length = 0
      setTerminal('waiting')
      setOpen(eid)
      state.watcher?.(state.hero)
    },
    hide: () => {
      state.hero = null
      state.pending.length = 0
      setOpen(NOBODY)
      setTerminal('waiting')
      state.watcher?.(null)
    },
    receive: (frame) => {
      if (frame.hero !== state.hero) {
        return
      }

      setTerminal(frame.alive ? 'alive' : 'fallen')

      if (frame.alive) {
        deliver(state, frame)
      }
    },
    listen: (listener) => {
      state.listener = listener

      for (const frame of state.pending) {
        listener?.(frame)
      }

      state.pending.length = 0
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
