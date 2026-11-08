import { INBOX_DOWN, type InboxState } from '@tokenfall/protocol/inbox'
import { createSignal, type Accessor } from 'solid-js'

export type InboxModel = {
  readonly state: Accessor<InboxState>
  readonly live: Accessor<boolean>
  readonly set: (state: InboxState) => void
}

export const createInbox = (): InboxModel => {
  const [state, setState] = createSignal<InboxState>(INBOX_DOWN)
  const [live, setLive] = createSignal(false)

  return {
    state,
    live,
    set: (next) => {
      setLive(true)
      setState(next)
    },
  }
}
