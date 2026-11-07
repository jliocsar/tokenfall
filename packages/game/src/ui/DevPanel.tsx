import { For } from 'solid-js'
import { TOWN_KINDS } from '../core/layout.ts'
import { ROSTER_VARIANTS, type Bridge } from './bridge.ts'

const HERO_COUNTS = [10, 100, 500] as const

const linkWith = (key: string, value: string | undefined): string => {
  const params = new URLSearchParams(window.location.search)

  if (value === undefined) {
    params.delete(key)
  } else {
    params.set(key, value)
  }

  return `?${params.toString()}`
}

export const DevPanel = (props: { readonly bridge: Bridge; readonly source: string }) => (
  <div class="dev-panel panel">
    <span class="label">town</span>
    <For each={TOWN_KINDS}>
      {(kind) => (
        <button
          type="button"
          classList={{ active: props.bridge.layout() === kind }}
          onClick={() => {
            props.bridge.setLayout(kind)
          }}
        >
          {kind}
        </button>
      )}
    </For>
    <span class="label">roster</span>
    <For each={ROSTER_VARIANTS}>
      {(variant) => (
        <button
          type="button"
          classList={{ active: props.bridge.roster() === variant }}
          onClick={() => {
            props.bridge.setRoster(variant)
          }}
        >
          {variant}
        </button>
      )}
    </For>
    <span class="label">heroes</span>
    <For each={HERO_COUNTS}>
      {(count) => <a href={linkWith('heroes', String(count))}>{count}</a>}
    </For>
    <a href={linkWith('replay', props.source.startsWith('replay') ? undefined : '')}>
      {props.source.startsWith('replay') ? 'synthetic' : 'replay'}
    </a>
  </div>
)
