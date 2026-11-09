import type { DeathCause } from '@tokenfall/protocol/hero'
import type { DaemonTuning } from '../../config.ts'
import {
  anyDone,
  observe,
  paneGone,
  paneMoved,
  setLeads,
  setStatus,
  sweepMissing,
  type Observed,
  type World,
} from '../../world.ts'
import {
  eventName,
  request,
  subscribe,
  type HerdrAgent,
  type HerdrData,
  type HerdrMessage,
  type HerdrPane,
  type Subscription,
} from './client.ts'
import { repoOf } from './repo.ts'

export type HerdrAdapter = {
  readonly stop: () => void
  readonly reconcile: () => Promise<void>
  readonly refreshStatus: () => Promise<void>
}

type State = {
  stopped: boolean
  connected: boolean
  lifecycle: Subscription | undefined
  retry: ReturnType<typeof setTimeout> | undefined
  backoff: number
  reconciling: boolean
  again: boolean
  refreshing: boolean
  seenTimer: ReturnType<typeof setTimeout> | undefined
  readonly statusSubs: Set<Subscription>
  readonly subscribed: Set<string>
  readonly pending: Set<string>
}

type Context = {
  readonly world: World
  readonly state: State
  readonly tuning: DaemonTuning
}

type Handler = (context: Context, data: HerdrData) => void

const CLAUDE = 'claude'
const LEAD_TAB = 'lead'
const TAB_NUMBER = /^\d+ · /u

const LIFECYCLE = [
  'pane.closed',
  'pane.exited',
  'pane.agent_detected',
  'pane.updated',
  'pane.moved',
  'workspace.focused',
  'tab.focused',
  'pane.focused',
]

const FOCUS = ['workspace.focused', 'tab.focused', 'pane.focused']

export const isLeadTab = (label: string): boolean => label.replace(TAB_NUMBER, '') === LEAD_TAB

const markLeads = async (world: World, agents: readonly HerdrAgent[]): Promise<void> => {
  const listed = await request('tab.list', {})
  const tabs = listed.result?.tabs

  if (tabs === undefined) {
    return
  }

  const leadTabs = new Set(tabs.filter((tab) => isLeadTab(tab.label)).map((tab) => tab.tab_id))
  const leadPanes = new Set(
    agents
      .filter((agent) => agent.tab_id !== undefined && leadTabs.has(agent.tab_id))
      .map((agent) => agent.pane_id),
  )
  setLeads(world, leadPanes, Date.now())
}

const observedOf = async (pane: HerdrPane, title: string | null): Promise<Observed> => ({
  pane: pane.pane_id,
  workspace: pane.workspace_id,
  session: pane.agent_session?.value ?? null,
  guild: await repoOf(pane.cwd),
  title,
  quest: pane.terminal_title_stripped ?? '',
  status: pane.agent_status,
})

const watchStatus = (state: State, pane: string): void => {
  if (!state.subscribed.has(pane)) {
    state.pending.add(pane)
  }
}

const see = async (context: Context, pane: HerdrPane): Promise<void> => {
  observe(context.world, await observedOf(pane, null), Date.now())
  watchStatus(context.state, pane.pane_id)
}

const gone =
  (cause: DeathCause): Handler =>
  (context, data) => {
    if (data.pane_id !== undefined) {
      paneGone(context.world, data.pane_id, cause, Date.now())
    }
  }

const runReconcile = async (context: Context): Promise<void> => {
  const { world, state, tuning } = context
  const listed = await request('agent.list', {})

  if (listed.result?.agents === undefined) {
    return
  }

  const agents = listed.result.agents.filter((agent) => agent.agent === CLAUDE)

  for (const agent of agents) {
    observe(world, await observedOf(agent, agent.name ?? ''), Date.now())
    watchStatus(state, agent.pane_id)
  }

  sweepMissing(
    world,
    new Set(agents.map((agent) => agent.pane_id)),
    tuning.missingAfterReconciles,
    Date.now(),
  )
  await markLeads(world, agents)
}

const reconcile = async (context: Context): Promise<void> => {
  const { state } = context

  if (state.reconciling) {
    state.again = true

    return
  }

  state.reconciling = true

  try {
    do {
      state.again = false
      await runReconcile(context)
    } while (state.again)
  } catch {
    state.again = false
  } finally {
    state.reconciling = false
  }
}

const refreshStatus = async (context: Context): Promise<void> => {
  const { world, state } = context

  if (state.refreshing || !state.connected) {
    return
  }

  state.refreshing = true

  try {
    const listed = await request('agent.list', {})

    for (const agent of listed.result?.agents ?? []) {
      if (agent.agent === CLAUDE) {
        setStatus(world, agent.pane_id, agent.agent_status, Date.now())
      }
    }
  } catch {
    state.refreshing = false

    return
  }

  state.refreshing = false
}

const scheduleSeen: Handler = (context) => {
  const { state, tuning } = context
  clearTimeout(state.seenTimer)
  state.seenTimer = setTimeout(() => {
    state.seenTimer = undefined
    void refreshStatus(context)
  }, tuning.seen.debounceMs)
}

const HANDLERS: ReadonlyMap<string, Handler> = new Map<string, Handler>([
  ...FOCUS.map((name): [string, Handler] => [name, scheduleSeen]),
  [
    'pane.agent_status_changed',
    (context, data) => {
      if (data.pane_id !== undefined && data.agent_status !== undefined) {
        setStatus(context.world, data.pane_id, data.agent_status, Date.now())
      }
    },
  ],
  ['pane.closed', gone('killed')],
  ['pane.exited', gone('exited')],
  [
    'pane.agent_detected',
    (context, data) => {
      if (data.released === true) {
        gone('released')(context, data)
      } else if (data.agent === CLAUDE) {
        void reconcile(context)
      }
    },
  ],
  [
    'pane.updated',
    (context, data) => {
      if (data.pane?.agent === CLAUDE) {
        void see(context, data.pane)
      }
    },
  ],
  [
    'pane.moved',
    (context, data) => {
      if (data.previous_pane_id !== undefined && data.pane !== undefined) {
        paneMoved(context.world, data.previous_pane_id, data.pane.pane_id)
        void see(context, data.pane)
      }
    },
  ],
])

const handle = (context: Context, message: HerdrMessage): void => {
  if (message.data !== undefined) {
    HANDLERS.get(eventName(message))?.(context, message.data)
  }
}

const flushPending = (context: Context): void => {
  const { state } = context

  if (!state.connected || state.pending.size === 0) {
    return
  }

  const panes = [...state.pending]
  state.pending.clear()

  for (const pane of panes) {
    state.subscribed.add(pane)
  }

  const subscription = subscribe(
    panes.map((pane) => ({ type: 'pane.agent_status_changed', pane_id: pane })),
    (_raw, message) => {
      handle(context, message)
    },
    {
      onClose: () => {
        state.statusSubs.delete(subscription)

        for (const pane of panes) {
          state.subscribed.delete(pane)
        }
      },
    },
  )
  state.statusSubs.add(subscription)
}

const dropConnections = (state: State): void => {
  state.connected = false
  state.lifecycle?.close()
  state.lifecycle = undefined

  for (const subscription of state.statusSubs) {
    subscription.close()
  }

  state.statusSubs.clear()
  state.subscribed.clear()
  state.pending.clear()
}

const reconnect = (context: Context): void => {
  const { state, tuning } = context

  if (state.stopped || state.retry !== undefined) {
    return
  }

  dropConnections(state)
  state.retry = setTimeout(() => {
    state.retry = undefined
    connect(context)
  }, state.backoff)
  state.backoff = Math.min(state.backoff * 2, tuning.reconnect.maxMs)
}

const start = async (context: Context, lifecycle: Subscription): Promise<void> => {
  try {
    await lifecycle.ready
  } catch {
    reconnect(context)

    return
  }

  context.state.connected = true
  context.state.backoff = context.tuning.reconnect.minMs
  await reconcile(context)
}

const connect = (context: Context): void => {
  const { state } = context

  if (state.stopped) {
    return
  }

  const lifecycle = subscribe(
    LIFECYCLE.map((type) => ({ type })),
    (_raw, message) => {
      handle(context, message)
    },
    {
      onClose: () => {
        reconnect(context)
      },
    },
  )
  state.lifecycle = lifecycle
  void start(context, lifecycle)
}

export const startHerdr = (world: World, tuning: DaemonTuning): HerdrAdapter => {
  const state: State = {
    stopped: false,
    connected: false,
    lifecycle: undefined,
    retry: undefined,
    backoff: tuning.reconnect.minMs,
    reconciling: false,
    again: false,
    refreshing: false,
    seenTimer: undefined,
    statusSubs: new Set(),
    subscribed: new Set(),
    pending: new Set(),
  }
  const context: Context = { world, state, tuning }
  connect(context)
  const timers = [
    setInterval(() => void reconcile(context), tuning.reconcileMs),
    setInterval(() => {
      flushPending(context)
    }, tuning.statusBatchMs),
    setInterval(() => {
      if (anyDone(world)) {
        void refreshStatus(context)
      }
    }, tuning.seen.pollMs),
  ]

  return {
    reconcile: () => reconcile(context),
    refreshStatus: () => refreshStatus(context),
    stop: () => {
      state.stopped = true
      clearTimeout(state.retry)
      clearTimeout(state.seenTimer)

      for (const timer of timers) {
        clearInterval(timer)
      }

      dropConnections(state)
    },
  }
}
