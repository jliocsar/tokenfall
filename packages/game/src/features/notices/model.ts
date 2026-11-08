import type { InboxState, Notice } from '@tokenfall/protocol/inbox'
import { createSignal, type Accessor } from 'solid-js'
import { createBoard, type Board } from '../attention/queue.ts'

export type Spot = {
  x: number
  y: number
  placed: boolean
}

export type NoticeBoard = {
  readonly board: Board
  readonly spot: Spot
  readonly notices: Accessor<readonly Notice[]>
  readonly total: Accessor<number>
  readonly open: Accessor<boolean>
  readonly show: () => void
  readonly hide: () => void
  readonly toggle: () => void
  readonly update: (state: InboxState) => void
}

export const createNoticeBoard = (): NoticeBoard => {
  const [notices, setNotices] = createSignal<readonly Notice[]>([])
  const [total, setTotal] = createSignal(0)
  const [open, setOpen] = createSignal(false)
  const board = createBoard()

  return {
    board,
    spot: { x: 0, y: 0, placed: false },
    notices,
    total,
    open,
    show: () => {
      setOpen(true)
    },
    hide: () => {
      setOpen(false)
    },
    toggle: () => {
      setOpen((current) => !current)
    },
    update: (state) => {
      let count = 0
      let since = Number.POSITIVE_INFINITY

      for (const notice of state.notices) {
        count += notice.count
        since = Math.min(since, notice.since)
      }

      board.count = count
      board.since = count === 0 ? 0 : since
      setNotices(state.notices)
      setTotal(count)
    },
  }
}
