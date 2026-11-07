import { createMemo, For, Show } from 'solid-js'
import type { Bridge } from '../../ui/bridge.ts'
import { Portrait } from '../../ui/Portrait.tsx'
import type { GuildGroup, Roster } from './model.ts'
import { summary } from './Roster.tsx'

type ChipsProps = { readonly bridge: Bridge; readonly roster: Roster }

const Chip = (props: ChipsProps & { readonly eid: number; readonly large?: boolean }) => {
  const row = () => props.roster.rows[props.eid]

  return (
    <Show when={row()}>
      {(hero) => (
        <button
          type="button"
          class={`chip standing-${hero().standing}`}
          classList={{ selected: props.bridge.selected() === props.eid }}
          title={`${hero().fullName} · Lv ${hero().level} · ${hero().standing}${hero().quest ? ` · ${hero().quest}` : ''}`}
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
        </button>
      )}
    </Show>
  )
}

const sameNumbers = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index])

const summaryOf = (group: GuildGroup | undefined): string =>
  group === undefined ? '' : summary(group.counts)

export const RosterChips = (props: ChipsProps) => {
  const byGuild = createMemo(
    () => new Map(props.roster.guilds().map((group) => [group.guild, group])),
  )
  const guildIds = createMemo(() => props.roster.guilds().map((group) => group.guild), [], {
    equals: sameNumbers,
  })
  const members = (guild: number): number[] =>
    byGuild()
      .get(guild)
      ?.parties.flatMap((party) => party.heroes) ?? []

  return (
    <div class="roster-scroll chips">
      <Show when={props.roster.attention().length > 0}>
        <div class="line heading">needs you · {props.roster.attention().length}</div>
        <div class="chip-grid">
          <For each={props.roster.attention()}>
            {(eid) => <Chip bridge={props.bridge} roster={props.roster} eid={eid} />}
          </For>
        </div>
      </Show>
      <For each={guildIds()}>
        {(guild) => (
          <section class="chip-guild">
            <div class="line guild">
              <span class="name">{byGuild().get(guild)?.label}</span>
              <span class="counts">{summaryOf(byGuild().get(guild))}</span>
            </div>
            <div class="chip-grid">
              <For each={members(guild)}>
                {(eid) => <Chip bridge={props.bridge} roster={props.roster} eid={eid} />}
              </For>
            </div>
          </section>
        )}
      </For>
    </div>
  )
}
