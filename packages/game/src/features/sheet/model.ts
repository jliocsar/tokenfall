import type {
  Blur,
  ControlState,
  Focus,
  Frame,
  Input,
  Scroll,
  ScrollDirection,
} from '@tokenfall/protocol/terminal'
import { createSignal, type Accessor } from 'solid-js'
import { heroOfEntity } from '../../core/hero-index.ts'
import type { Sim } from '../../core/sim.ts'
import { NOBODY } from '../../ui/bridge.ts'

export type Watcher = (hero: string | null) => void

export type Steer = (message: Focus | Blur | Input | Scroll) => void

export type FrameListener = (frame: Frame) => void

export type TerminalState = 'waiting' | 'alive' | 'fallen'

export type Typing = 'off' | 'asking' | 'held' | 'busy'

type SheetState = {
  watcher: Watcher | undefined
  steer: Steer | undefined
  listener: FrameListener | undefined
  readonly pending: Frame[]
  hero: string | null
  sim: Sim | undefined
}

export type SheetModel = {
  readonly open: Accessor<number>
  readonly terminal: Accessor<TerminalState>
  readonly typing: Accessor<Typing>
  readonly live: boolean
  readonly show: (eid: number) => void
  readonly hide: () => void
  readonly receive: (frame: Frame) => void
  readonly control: (state: ControlState) => void
  readonly listen: (listener: FrameListener | undefined) => void
  readonly connect: (sim: Sim, watcher: Watcher | undefined, steer: Steer | undefined) => void
  readonly focus: () => void
  readonly blur: () => void
  readonly input: (bytes: string) => void
  readonly scroll: (direction: ScrollDirection, lines: number) => void
}

const PENDING_FRAMES = 256

const TYPING_OF = {
  held: 'held',
  busy: 'busy',
  released: 'off',
} as const satisfies Record<ControlState, Typing>

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
  const [typing, setTyping] = createSignal<Typing>('off')
  const state: SheetState = {
    watcher: undefined,
    steer: undefined,
    listener: undefined,
    pending: [],
    hero: null,
    sim: undefined,
  }

  const reset = (): void => {
    state.pending.length = 0
    setTerminal('waiting')
    setTyping('off')
  }

  return {
    open,
    terminal,
    typing,
    get live() {
      return state.watcher !== undefined
    },
    show: (eid) => {
      if (state.sim === undefined) {
        return
      }

      state.hero = heroOfEntity(state.sim.index, eid)
      reset()
      setOpen(eid)
      state.watcher?.(state.hero)
    },
    hide: () => {
      state.hero = null
      reset()
      setOpen(NOBODY)
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
    control: (next) => {
      if (state.hero !== null) {
        setTyping(TYPING_OF[next])
      }
    },
    listen: (listener) => {
      state.listener = listener

      for (const frame of state.pending) {
        listener?.(frame)
      }

      state.pending.length = 0
    },
    connect: (sim, watcher, steer) => {
      state.sim = sim
      state.watcher = watcher
      state.steer = steer
    },
    focus: () => {
      if (state.steer !== undefined && (typing() === 'off' || typing() === 'busy')) {
        setTyping('asking')
        state.steer({ kind: 'focus' })
      }
    },
    blur: () => {
      if (typing() === 'asking' || typing() === 'held') {
        state.steer?.({ kind: 'blur' })
        setTyping('off')
      }
    },
    input: (bytes) => {
      if (typing() === 'asking' || typing() === 'held') {
        state.steer?.({ kind: 'input', bytes })
      }
    },
    scroll: (direction, lines) => {
      if (typing() === 'held') {
        state.steer?.({ kind: 'scroll', direction, lines })
      }
    },
  }
}
