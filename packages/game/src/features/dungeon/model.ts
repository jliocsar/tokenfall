import { createSignal, type Accessor } from 'solid-js'
import plan from '@tokenfall/data/dungeon.json'

export type DungeonHooks = {
  readonly pick: (tier: number) => void
  readonly leave: () => void
}

export type DungeonModel = {
  readonly names: readonly string[]
  readonly guild: Accessor<string>
  readonly tier: Accessor<number>
  readonly open: Accessor<boolean>
  readonly counts: Accessor<readonly number[]>
  readonly show: (guild: string, tier: number) => void
  readonly hide: () => void
  readonly setCounts: (counts: ArrayLike<number>) => void
  readonly pick: (tier: number) => void
  readonly leave: () => void
}

export const createDungeonModel = (hooks: DungeonHooks): DungeonModel => {
  const [guild, setGuild] = createSignal('')
  const [tier, setTier] = createSignal(0)
  const [open, setOpen] = createSignal(false)
  const [counts, setCounts] = createSignal<readonly number[]>(plan.tiers.map(() => 0))

  return {
    names: plan.tiers.map((entry) => entry.name),
    guild,
    tier,
    open,
    counts,
    show: (name, shown) => {
      setGuild(name)
      setTier(shown)
      setOpen(true)
    },
    hide: () => {
      setOpen(false)
    },
    setCounts: (next) => {
      const current = counts()
      let changed = false

      for (let index = 0; index < next.length; index++) {
        changed ||= next[index] !== current[index]
      }

      if (changed) {
        setCounts(Array.from(next))
      }
    },
    pick: hooks.pick,
    leave: hooks.leave,
  }
}
