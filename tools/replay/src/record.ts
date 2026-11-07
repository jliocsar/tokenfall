import { $ } from 'bun'
import { parseArgs } from 'node:util'
import type { HeroEvent } from '@tokenfall/protocol/events'
import { LOCAL_MACHINE, paneHeroId, sessionHeroId, type HeroInfo } from '@tokenfall/protocol/hero'
import { RECORDING_VERSION } from '@tokenfall/protocol/wire'
import { eventName, request, subscribe, type HerdrAgent, type HerdrMessage } from './herdr.ts'
import { eventLine, headerLine } from './recording.ts'

const RECONCILE_MS = 30_000
const LIFECYCLE = ['pane.closed', 'pane.exited', 'pane.agent_detected', 'pane.created']

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: `recordings/herdr-${Date.now()}.jsonl` },
    seconds: { type: 'string', default: '0' },
    raw: { type: 'boolean', default: false },
  },
})

const writer = Bun.file(values.out).writer()
const rawWriter = values.raw
  ? Bun.file(values.out.replace(/\.jsonl$/u, '.raw.jsonl')).writer()
  : undefined
const heroOfPane = new Map<string, string>()
const statusOfPane = new Map<string, string>()
const subscribed = new Set<string>()
const repoOfCwd = new Map<string, string>()
const totals = { written: 0 }

const emit = (event: HeroEvent): void => {
  void writer.write(eventLine(event))
  totals.written += 1
}

const repoOf = async (cwd: string): Promise<string> => {
  const known = repoOfCwd.get(cwd)

  if (known !== undefined) {
    return known
  }

  const common = await $`git -C ${cwd} rev-parse --path-format=absolute --git-common-dir`
    .quiet()
    .nothrow()
  const repo =
    common.exitCode === 0
      ? common.stdout
          .toString()
          .trim()
          .replace(/\/\.git$/u, '')
      : ''
  repoOfCwd.set(cwd, repo)

  return repo
}

const heroIdOf = (agent: HerdrAgent): string =>
  agent.agent_session?.value === undefined
    ? paneHeroId(LOCAL_MACHINE, agent.pane_id)
    : sessionHeroId(LOCAL_MACHINE, agent.agent_session.value)

const onLine = (raw: string, message: HerdrMessage): void => {
  void rawWriter?.write(`${JSON.stringify({ at: Date.now(), raw })}\n`)
  const name = eventName(message)
  const pane = message.data?.pane_id
  const hero = pane === undefined ? undefined : heroOfPane.get(pane)

  if (hero === undefined || pane === undefined) {
    return
  }

  if (name === 'pane.agent_status_changed' && message.data?.agent_status !== undefined) {
    statusOfPane.set(pane, message.data.agent_status)
    emit({ kind: 'hero.status', at: Date.now(), hero, status: message.data.agent_status })
  } else if (name === 'pane.closed' || name === 'pane.exited') {
    heroOfPane.delete(pane)
    emit({
      kind: 'hero.died',
      at: Date.now(),
      hero,
      cause: name === 'pane.closed' ? 'killed' : 'exited',
    })
  } else if (name === 'pane.agent_detected' && message.data?.released === true) {
    heroOfPane.delete(pane)
    emit({ kind: 'hero.died', at: Date.now(), hero, cause: 'released' })
  }
}

const join = async (agent: HerdrAgent): Promise<void> => {
  const id = heroIdOf(agent)
  const hero: HeroInfo = {
    id,
    machine: LOCAL_MACHINE,
    pane: agent.pane_id,
    workspace: agent.workspace_id,
    guild: agent.cwd === null || agent.cwd === undefined ? '' : await repoOf(agent.cwd),
    title: agent.name ?? '',
    quest: agent.terminal_title_stripped ?? '',
    status: agent.agent_status,
    experience: 0,
    minions: 0,
    lead: false,
    alive: true,
  }
  heroOfPane.set(agent.pane_id, id)
  statusOfPane.set(agent.pane_id, agent.agent_status)
  emit({ kind: 'hero.joined', at: Date.now(), hero })

  if (!subscribed.has(agent.pane_id)) {
    subscribed.add(agent.pane_id)
    await subscribe([{ type: 'pane.agent_status_changed', pane_id: agent.pane_id }], onLine)
  }
}

const reconcile = async (): Promise<void> => {
  const listed = await request('agent.list', {})
  const agents = (listed.result?.agents ?? []).filter((agent) => agent.agent === 'claude')

  for (const agent of agents) {
    const known = heroOfPane.get(agent.pane_id)

    if (known === undefined) {
      await join(agent)
    } else if (statusOfPane.get(agent.pane_id) !== agent.agent_status) {
      statusOfPane.set(agent.pane_id, agent.agent_status)
      emit({ kind: 'hero.status', at: Date.now(), hero: known, status: agent.agent_status })
    }
  }
}

void writer.write(
  headerLine({
    kind: 'recording',
    version: RECORDING_VERSION,
    startedAt: Date.now(),
    source: 'herdr',
    note: 'pane titles and repo paths are real; scrub before sharing',
  }),
)
await subscribe(
  LIFECYCLE.map((type) => ({ type })),
  (raw, message) => {
    onLine(raw, message)

    if (eventName(message) === 'pane.agent_detected') {
      void reconcile()
    }
  },
)
await reconcile()
setInterval(() => void reconcile(), RECONCILE_MS)
console.log(`recording ${heroOfPane.size} heroes from herdr into ${values.out}, ctrl+c to stop`)

const stop = async (): Promise<void> => {
  await writer.end()
  await rawWriter?.end()
  console.log(`wrote ${totals.written} events`)
  process.exit(0)
}

process.on('SIGINT', () => void stop())

if (Number(values.seconds) > 0) {
  setTimeout(() => void stop(), Number(values.seconds) * 1000)
}
