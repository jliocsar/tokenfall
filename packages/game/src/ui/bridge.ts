import { createSignal, type Accessor } from 'solid-js'
import type { Sim } from '../core/sim.ts'

export type PortraitAtlas = {
  readonly url: string
  readonly width: number
  readonly height: number
  readonly origins: readonly (readonly number[])[]
}

export type Bridge = {
  readonly sim: Sim
  readonly portraits: PortraitAtlas
  readonly selected: Accessor<number>
  readonly select: (eid: number) => void
  readonly focus: (eid: number) => void
}

export type BridgeHooks = {
  readonly glideTo: (eid: number) => void
}

export const NOBODY = -1

export const createBridge = (sim: Sim, portraits: PortraitAtlas, hooks: BridgeHooks): Bridge => {
  const [selected, setSelected] = createSignal(NOBODY)

  return {
    sim,
    portraits,
    selected,
    select: (eid) => {
      setSelected(eid)
    },
    focus: (eid) => {
      setSelected(eid)
      hooks.glideTo(eid)
    },
  }
}
