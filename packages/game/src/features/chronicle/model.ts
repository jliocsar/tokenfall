import tuning from '@tokenfall/data/chronicle.json'
import type { ChronicleLine } from '@tokenfall/protocol/chronicle'
import { createSignal, type Accessor } from 'solid-js'

export type ChronicleModel = {
  readonly lines: Accessor<readonly ChronicleLine[]>
  readonly seen: Accessor<number>
  readonly collapsed: Accessor<boolean>
  readonly add: (lines: readonly ChronicleLine[]) => void
  readonly toggle: () => void
}

const NEVER = Number.POSITIVE_INFINITY

const storedSeen = (): number => {
  const raw = localStorage.getItem(tuning.seenKey)

  return raw === null ? NEVER : Number(raw)
}

export const createChronicle = (): ChronicleModel => {
  const [lines, setLines] = createSignal<readonly ChronicleLine[]>([])
  const [seen, setSeen] = createSignal(storedSeen())
  const [collapsed, setCollapsed] = createSignal(
    localStorage.getItem(tuning.collapsedKey) === 'true',
  )

  const remember = (): void => {
    const last = lines().at(-1)

    if (last !== undefined) {
      setSeen(last.seq)
      localStorage.setItem(tuning.seenKey, String(last.seq))
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      remember()
    }
  })
  window.addEventListener('pagehide', remember)

  return {
    lines,
    seen,
    collapsed,
    add: (added) => {
      if (added.length > 0) {
        setLines((current) => [...current, ...added].slice(-tuning.tail))
      }
    },
    toggle: () => {
      const next = !collapsed()
      setCollapsed(next)
      localStorage.setItem(tuning.collapsedKey, String(next))
    },
  }
}
