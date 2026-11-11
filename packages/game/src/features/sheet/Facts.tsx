import sheetText from '@tokenfall/data/sheet.json'
import { Show } from 'solid-js'
import { depthTierOf } from '../../core/dungeon.ts'
import { guildLabel } from '../../core/groups.ts'
import type { Sim } from '../../core/sim.ts'
import type { PortraitAtlas } from '../../ui/bridge.ts'
import { Portrait } from '../../ui/Portrait.tsx'
import { Crown } from '../crown/Crown.tsx'
import { deathText } from '../death/text.ts'
import type { HeroRow } from '../roster/model.ts'

type FactsProps = {
  readonly hero: HeroRow
  readonly sim: Sim
  readonly portraits: PortraitAtlas
  readonly inbox: string | undefined
}

type StatProps = {
  readonly icon: string
  readonly label: string
  readonly value: string
  readonly number: boolean
  readonly note: string
}

const PERCENT = 100
const RING_TRACK = '#2b2433'

const progressOf = (thresholds: Float64Array, level: number, experience: number): number => {
  const floor = thresholds[level] ?? 0
  const next = thresholds[level + 1]

  if (next === undefined || next <= floor) {
    return 1
  }

  return Math.min(1, Math.max(0, (experience - floor) / (next - floor)))
}

const formatTokens = (tokens: number): string =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(tokens)

const epithetOf = (hero: HeroRow): string => hero.fullName.slice(hero.name.length).trim()

const floorsOf = (sim: Sim, level: number): string => {
  const tiers = sim.config.depthTiers
  const tier = depthTierOf(level, tiers)
  const next = tiers[tier + 1]
  const to = next === undefined ? sim.thresholds.length - 1 : next.fromLevel - 1

  return sheetText.floors
    .replace('{from}', String(tiers[tier]?.fromLevel ?? 1))
    .replace('{to}', String(to))
}

const Stat = (props: StatProps) => (
  <div class="stat">
    <span class="nf">{props.icon}</span>
    <div>
      <div class="key">{props.label}</div>
      <div class={props.number ? 'value number' : 'value'}>
        {props.value}
        <Show when={props.note}>
          <small>{` · ${props.note}`}</small>
        </Show>
      </div>
    </div>
  </div>
)

const Standing = (props: { readonly hero: HeroRow; readonly sim: Sim }) => {
  const detail = () =>
    props.hero.standing === 'dead' && props.hero.cause !== null
      ? deathText(props.hero.cause, props.hero.diedAt, performance.now() + props.sim.clockOffset)
      : props.hero.waiting

  return (
    <div class={`standing-chip standing-${props.hero.standing} wait-${props.hero.wait}`}>
      <span class="nf">{sheetText.icons.standing[props.hero.standing]}</span>
      <div>
        <div class="title">{props.hero.standing}</div>
        <Show when={detail()}>
          <div class="detail">{detail()}</div>
        </Show>
      </div>
    </div>
  )
}

export const Facts = (props: FactsProps) => {
  const experience = () => props.sim.stores.hero.experience[props.hero.eid] ?? 0
  const progress = () => progressOf(props.sim.thresholds, props.hero.level, experience())
  const percent = () => Math.floor(progress() * PERCENT)
  const maxed = () => props.hero.level >= props.sim.thresholds.length - 1
  const tiers = () => props.sim.config.depthTiers

  return (
    <div class="sheet-facts">
      <div class="facts-portrait">
        <div class="portrait-frame">
          <div class="portrait-stage">
            <Portrait
              atlas={props.portraits}
              sheet={props.hero.sheet}
              size="sheet"
              status={props.hero.standing}
            />
          </div>
        </div>
        <div
          class="level-ring"
          style={{
            background: `conic-gradient(var(--ink-gold) 0 ${percent()}%, ${RING_TRACK} ${percent()}% 100%)`,
          }}
        >
          <div class="level-core">
            <span class="key">{sheetText.levelShort}</span>
            <span class="value">{props.hero.level}</span>
          </div>
        </div>
      </div>
      <div class="name-plate">
        <div class="hero-name">
          {props.hero.name}
          <Show when={props.hero.lead}>
            <Crown />
          </Show>
        </div>
        <Show when={epithetOf(props.hero)}>
          <div class="epithet">{epithetOf(props.hero)}</div>
        </Show>
        <div class="class-line">
          {props.hero.stranger
            ? sheetText.stranger
            : `${props.hero.className} · ${props.hero.personality}`}
        </div>
      </div>
      <div class="experience" title={`${formatTokens(experience())} ${sheetText.experience}`}>
        <div class="bar">
          <div class="fill" style={{ width: `${(progress() * PERCENT).toFixed(1)}%` }} />
        </div>
        <div class="row">
          <span>
            <b>{formatTokens(experience())}</b> {sheetText.tokens}
          </span>
          <span>
            {maxed()
              ? sheetText.maxLevel
              : sheetText.toNext
                  .replace('{percent}', String(percent()))
                  .replace('{level}', String(props.hero.level + 1))}
          </span>
        </div>
      </div>
      <Standing hero={props.hero} sim={props.sim} />
      <div class="stats">
        <Stat
          icon={sheetText.icons.quest}
          label={sheetText.quest}
          value={props.hero.quest || sheetText.noQuest}
          number={false}
          note=""
        />
        <Stat
          icon={sheetText.icons.guild}
          label={sheetText.guild}
          value={guildLabel(props.sim.groups.guildKeys[props.hero.guild] ?? '')}
          number={false}
          note=""
        />
        <Stat
          icon={sheetText.icons.party}
          label={sheetText.party}
          value={props.sim.groups.partyWorkspace[props.hero.party] ?? ''}
          number
          note=""
        />
        <Stat
          icon={sheetText.icons.minions}
          label={sheetText.minions}
          value={String(props.sim.stores.hero.minions[props.hero.eid] ?? 0)}
          number
          note=""
        />
        <Stat
          icon={sheetText.icons.depth}
          label={sheetText.depth}
          value={tiers()[depthTierOf(props.hero.level, tiers())]?.name ?? ''}
          number={false}
          note={floorsOf(props.sim, props.hero.level)}
        />
      </div>
      <Show when={props.inbox}>
        {(href) => (
          <a class="inbox-button" href={href()} target="_blank" rel="noopener">
            <span class="nf">{sheetText.icons.inbox}</span>
            {sheetText.openInbox}
          </a>
        )}
      </Show>
    </div>
  )
}
