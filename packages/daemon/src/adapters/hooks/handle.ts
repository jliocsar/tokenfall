import { decodeTrusted } from '@tokenfall/protocol/json'
import { LOCAL_MACHINE, sessionHeroId } from '@tokenfall/protocol/hero'
import { killHero, observe, type World } from '../../world.ts'

export type Hook = {
  readonly event: string
  readonly session: string
  readonly tool: string | undefined
  readonly agent: string | undefined
  readonly source: string | undefined
  readonly reason: string | undefined
}

type HookPayload = {
  readonly hook_event_name?: string
  readonly session_id?: string
  readonly tool_name?: string
  readonly agent_id?: string
  readonly source?: string
  readonly reason?: string
}

type Handler = (world: World, hook: Hook, pane: string, now: number) => void

const RESUME = 'resume'
const CLEAR = 'clear'

const decode = (text: string): HookPayload | undefined => {
  try {
    return decodeTrusted<HookPayload | null>(text) ?? undefined
  } catch {
    return undefined
  }
}

export const readHook = (text: string): Hook | undefined => {
  const payload = decode(text)

  if (payload?.hook_event_name === undefined || payload.session_id === undefined) {
    return undefined
  }

  return {
    event: payload.hook_event_name,
    session: payload.session_id,
    tool: payload.tool_name,
    agent: payload.agent_id,
    source: payload.source,
    reason: payload.reason,
  }
}

const sessionStart: Handler = (world, hook, pane, now) => {
  if (pane === '') {
    return
  }

  world.ended.delete(hook.session)
  world.hookSessions.set(pane, hook.session)
  const id = world.paneHero.get(pane)
  const record = id === undefined ? undefined : world.live.get(id)

  if (record === undefined || record.session === hook.session) {
    return
  }

  observe(
    world,
    {
      pane,
      workspace: record.workspace,
      session: hook.session,
      guild: record.guild,
      title: null,
      quest: record.quest,
      status: record.status,
    },
    now,
  )
}

const sessionEnd: Handler = (world, hook, pane, now) => {
  if (hook.reason === RESUME) {
    return
  }

  world.ended.add(hook.session)

  if (world.hookSessions.get(pane) === hook.session) {
    world.hookSessions.delete(pane)
  }

  const id = sessionHeroId(LOCAL_MACHINE, hook.session)
  const record = world.live.get(id)
  world.minions.delete(id)

  if (record !== undefined) {
    killHero(world, record, hook.reason === CLEAR ? 'cleared' : 'exited', now)
  }
}

const preToolUse: Handler = (world, hook) => {
  const id = sessionHeroId(LOCAL_MACHINE, hook.session)

  if (hook.agent === undefined && hook.tool !== undefined && world.live.has(id)) {
    world.tools.set(id, hook.tool)
  }
}

const countMinions =
  (adding: boolean): Handler =>
  (world, hook, _pane, now) => {
    const id = sessionHeroId(LOCAL_MACHINE, hook.session)
    const record = world.live.get(id)

    if (record === undefined || hook.agent === undefined) {
      return
    }

    const minions = world.minions.get(id) ?? new Set<string>()
    world.minions.set(id, minions)

    if (adding) {
      minions.add(hook.agent)
    } else {
      minions.delete(hook.agent)
    }

    if (record.minions !== minions.size) {
      record.minions = minions.size
      world.dirty.add(record)
      world.outbox.push({ kind: 'hero.minions', at: now, hero: id, minions: minions.size })
    }
  }

const HANDLERS: ReadonlyMap<string, Handler> = new Map([
  ['SessionStart', sessionStart],
  ['SessionEnd', sessionEnd],
  ['PreToolUse', preToolUse],
  ['SubagentStart', countMinions(true)],
  ['SubagentStop', countMinions(false)],
])

export const handleHook = (world: World, hook: Hook, pane: string, now: number): void => {
  HANDLERS.get(hook.event)?.(world, hook, pane, now)
}
