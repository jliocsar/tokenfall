import { For } from 'solid-js'
import type { Bridge } from './bridge.ts'

const HERO_COUNTS = [10, 100, 500] as const

const linkWith = (key: string, value: string): string => {
  const params = new URLSearchParams(window.location.search)
  params.delete('replay')
  params.set(key, value)

  return `?${params.toString()}`
}

export const DevPanel = (_props: { readonly bridge: Bridge; readonly source: string }) => (
  <div class="dev-panel panel plain">
    <span class="label">heroes</span>
    <For each={HERO_COUNTS}>
      {(count) => <a href={linkWith('heroes', String(count))}>{count}</a>}
    </For>
    <a href="/">live</a>
    <a href="?replay">replay</a>
    <a href="/?measure">measure</a>
  </div>
)
