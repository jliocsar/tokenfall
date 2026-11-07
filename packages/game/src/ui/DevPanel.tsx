import { For } from 'solid-js'
import type { Bridge } from './bridge.ts'

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
    <span class="label">heroes</span>
    <For each={HERO_COUNTS}>
      {(count) => <a href={linkWith('heroes', String(count))}>{count}</a>}
    </For>
    <a href={linkWith('replay', props.source.startsWith('replay') ? undefined : '')}>
      {props.source.startsWith('replay') ? 'synthetic' : 'replay'}
    </a>
  </div>
)
