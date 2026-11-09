import { For, Show } from 'solid-js'
import type { DungeonModel } from './model.ts'

type TierStripProps = {
  readonly model: DungeonModel
}

export const TierStrip = (props: TierStripProps) => (
  <Show when={props.model.open()}>
    <nav class="tier-strip panel">
      <span class="guild">{props.model.guild()}</span>
      <For each={props.model.names}>
        {(name, index) => (
          <button
            type="button"
            classList={{
              tier: true,
              current: props.model.tier() === index(),
              empty: (props.model.counts()[index()] ?? 0) === 0,
            }}
            onClick={() => {
              props.model.pick(index())
            }}
          >
            <span class="name">{name}</span>
            <span class="count">{props.model.counts()[index()] ?? 0}</span>
          </button>
        )}
      </For>
      <button
        type="button"
        class="leave"
        onClick={() => {
          props.model.leave()
        }}
      >
        Town
      </button>
    </nav>
  </Show>
)
