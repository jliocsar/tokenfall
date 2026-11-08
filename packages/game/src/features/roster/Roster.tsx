import tuning from '@tokenfall/data/ravens.json'
import { createMemo, createSignal, Index, Show, type JSX } from 'solid-js'
import type { Bridge } from '../../ui/bridge.ts'
import { Portrait } from '../../ui/Portrait.tsx'
import { WAIT_INBOX, WAIT_LOOT } from '../attention/queue.ts'
import type { NoticeBoard } from '../notices/model.ts'
import type { Counts, GuildGroup, PartyGroup, Roster } from './model.ts'

type Line =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'guild'; readonly group: GuildGroup; readonly open: boolean }
  | {
      readonly kind: 'party'
      readonly group: PartyGroup
      readonly guild: number
      readonly open: boolean
    }
  | { readonly kind: 'hero'; readonly eid: number; readonly depth: number }
  | { readonly kind: 'board' }

type RosterProps = {
  readonly bridge: Bridge
  readonly roster: Roster
  readonly board: NoticeBoard
  readonly onBoard: () => void
}

type GroupActions = {
  readonly toggle: (key: string) => void
  readonly onBoard: () => void
  readonly total: number
}

const ROW_HEIGHT = 40
const OVERSCAN = 6
const OPEN_ALL_UNDER = 60
const BOARD_LINE: Line = { kind: 'board' }

const SUMMARY: readonly (readonly [keyof Counts, string])[] = [
  ['raven', 'raven'],
  ['loot', 'loot'],
  ['working', 'working'],
  ['idle', 'idle'],
  ['dead', 'dead'],
]

const summary = (counts: Counts): string =>
  SUMMARY.filter(([key]) => counts[key] > 0)
    .map(([key, label]) => `${counts[key]} ${label}`)
    .join(' · ')

const guildKey = (guild: number): string => `g${guild}`

const partyKey = (party: number): string => `p${party}`

const eidOf = (line: Line): number => (line.kind === 'hero' ? line.eid : -1)

const depthOf = (line: Line): number => (line.kind === 'hero' ? line.depth : 0)

const heroLine = (cache: Map<number, Line>, eid: number, depth: number): Line => {
  const key = eid * 4 + depth
  const cached = cache.get(key)

  if (cached !== undefined) {
    return cached
  }

  const line: Line = { kind: 'hero', eid, depth }
  cache.set(key, line)

  return line
}

const groupLine = (line: Line, actions: GroupActions): JSX.Element => {
  const { toggle } = actions

  if (line.kind === 'heading') {
    return <div class="line heading">{line.text}</div>
  }

  if (line.kind === 'board') {
    return (
      <button type="button" class="line board standing-raven" onClick={actions.onBoard}>
        <span class="name">{tuning.board.row.replace('{count}', String(actions.total))}</span>
        <span class="badge">raven</span>
      </button>
    )
  }

  if (line.kind === 'guild') {
    return (
      <button
        type="button"
        class="line guild"
        onClick={() => {
          toggle(guildKey(line.group.guild))
        }}
      >
        <span class="caret">{line.open ? '▾' : '▸'}</span>
        <span class="name">{line.group.label}</span>
        <span class="counts">{summary(line.group.counts)}</span>
      </button>
    )
  }

  if (line.kind === 'party') {
    return (
      <button
        type="button"
        class="line party"
        onClick={() => {
          toggle(partyKey(line.group.party))
        }}
      >
        <span class="caret">{line.open ? '▾' : '▸'}</span>
        <span class="name">{line.group.workspace}</span>
        <span class="counts">{summary(line.group.counts)}</span>
      </button>
    )
  }

  return null
}

const attentionLines = (
  out: Line[],
  roster: Roster,
  total: number,
  heroLines: Map<number, Line>,
): void => {
  const attention = roster.attention()
  const needs = attention.length + (total > 0 ? 1 : 0)

  if (needs === 0) {
    return
  }

  out.push({ kind: 'heading', text: `needs you · ${needs}` })
  let pinned = total === 0

  for (const eid of attention) {
    if (!pinned && (roster.rows[eid]?.wait ?? WAIT_LOOT) > WAIT_INBOX) {
      out.push(BOARD_LINE)
      pinned = true
    }

    out.push(heroLine(heroLines, eid, 0))
  }

  if (!pinned) {
    out.push(BOARD_LINE)
  }
}

export const HeroLine = (props: {
  readonly bridge: Bridge
  readonly roster: Roster
  readonly eid: number
  readonly depth: number
}) => {
  const row = () => props.roster.rows[props.eid]

  return (
    <Show when={row()}>
      {(hero) => (
        <button
          type="button"
          class={`line hero standing-${hero().standing}`}
          classList={{ selected: props.bridge.selected() === props.eid }}
          style={{ 'padding-left': `${8 + props.depth * 14}px` }}
          onClick={() => {
            props.bridge.focus(props.eid)
          }}
        >
          <Portrait
            atlas={props.bridge.portraits}
            sheet={hero().sheet}
            size="small"
            status={hero().standing}
          />
          <span class="who">
            <span class="name">{hero().fullName}</span>
            <span class="quest">{hero().quest || hero().className}</span>
          </span>
          <span class="level">{hero().stranger ? '' : `Lv ${hero().level}`}</span>
          <span class="badge">{hero().standing}</span>
        </button>
      )}
    </Show>
  )
}

export const RosterTree = (props: RosterProps) => {
  const [toggled, setToggled] = createSignal<ReadonlySet<string>>(new Set())
  const [scroll, setScroll] = createSignal(0)
  const [height, setHeight] = createSignal(600)
  const heroLines = new Map<number, Line>()

  const toggle = (key: string): void => {
    setToggled((current) => {
      const next = new Set(current)

      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }

      return next
    })
  }

  const lines = createMemo<Line[]>(() => {
    const guilds = props.roster.guilds()
    const heroes = guilds.reduce((sum, guild) => sum + guild.size, 0)
    const defaultOpen = heroes <= OPEN_ALL_UNDER
    const out: Line[] = []

    attentionLines(out, props.roster, props.board.total(), heroLines)

    out.push({ kind: 'heading', text: `guilds · ${guilds.length}` })

    for (const guild of guilds) {
      const open = toggled().has(guildKey(guild.guild)) !== defaultOpen
      out.push({ kind: 'guild', group: guild, open })

      if (!open) {
        continue
      }

      for (const party of guild.parties) {
        const partyOpen = !toggled().has(partyKey(party.party))
        out.push({ kind: 'party', group: party, guild: guild.guild, open: partyOpen })

        if (partyOpen) {
          for (const eid of party.heroes) {
            out.push(heroLine(heroLines, eid, 2))
          }
        }
      }
    }

    return out
  })

  const first = createMemo(() => Math.max(0, Math.floor(scroll() / ROW_HEIGHT) - OVERSCAN))
  const visible = createMemo(() =>
    lines().slice(
      first(),
      Math.min(lines().length, Math.ceil((scroll() + height()) / ROW_HEIGHT) + OVERSCAN),
    ),
  )

  return (
    <div
      class="roster-scroll"
      ref={(element) => {
        queueMicrotask(() => {
          setHeight(element.clientHeight)
        })
      }}
      onScroll={(event) => {
        setScroll(event.currentTarget.scrollTop)
        setHeight(event.currentTarget.clientHeight)
      }}
    >
      <div class="roster-track" style={{ height: `${lines().length * ROW_HEIGHT}px` }}>
        <Index each={visible()}>
          {(item, offset) => (
            <div class="slot" style={{ top: `${(first() + offset) * ROW_HEIGHT}px` }}>
              <Show
                when={item().kind === 'hero'}
                fallback={groupLine(item(), {
                  toggle,
                  onBoard: props.onBoard,
                  total: props.board.total(),
                })}
              >
                <HeroLine
                  bridge={props.bridge}
                  roster={props.roster}
                  eid={eidOf(item())}
                  depth={depthOf(item())}
                />
              </Show>
            </div>
          )}
        </Index>
      </div>
    </div>
  )
}
