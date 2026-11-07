import { createSignal, type Accessor } from 'solid-js'
import type { TownKind } from '../core/layout.ts'
import type { Sim } from '../core/sim.ts'

export type RosterVariant = (typeof ROSTER_VARIANTS)[number]

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
  readonly layout: Accessor<TownKind>
  readonly setLayout: (kind: TownKind) => void
  readonly roster: Accessor<RosterVariant>
  readonly setRoster: (variant: RosterVariant) => void
}

export type BridgeHooks = {
  readonly glideTo: (eid: number) => void
  readonly relayout: (kind: TownKind) => void
}

export const ROSTER_VARIANTS = ['tree', 'chips'] as const
export const NOBODY = -1

export const createBridge = (
  sim: Sim,
  portraits: PortraitAtlas,
  hooks: BridgeHooks,
  roster: RosterVariant,
): Bridge => {
  const [selected, setSelected] = createSignal(NOBODY)
  const [layout, setLayoutSignal] = createSignal<TownKind>(sim.town.kind)
  const [variant, setVariant] = createSignal<RosterVariant>(roster)

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
    layout,
    setLayout: (kind) => {
      hooks.relayout(kind)
      setLayoutSignal(kind)
    },
    roster: variant,
    setRoster: (next) => {
      setVariant(next)
    },
  }
}
