import { createRoot } from 'solid-js'
import { render } from 'solid-js/web'
import { Chronicle } from '../features/chronicle/Chronicle.tsx'
import type { ChronicleModel } from '../features/chronicle/model.ts'
import { HeroCard } from '../features/roster/HeroCard.tsx'
import { createRoster, type Roster } from '../features/roster/model.ts'
import { RosterTree } from '../features/roster/Roster.tsx'
import type { Bridge } from './bridge.ts'
import { DevPanel } from './DevPanel.tsx'
import './skins/dusk.css'
import './ui.css'

export type Ui = { readonly roster: Roster }

export const mountUi = (
  bridge: Bridge,
  source: string,
  chronicle: ChronicleModel,
  root: HTMLElement,
): Ui => {
  const roster = createRoot(() => createRoster(bridge.sim))
  render(
    () => (
      <>
        <DevPanel bridge={bridge} source={source} />
        <aside class="roster panel">
          <RosterTree bridge={bridge} roster={roster} />
        </aside>
        <div class="dock-left">
          <HeroCard bridge={bridge} roster={roster} />
          <Chronicle bridge={bridge} model={chronicle} />
        </div>
      </>
    ),
    root,
  )

  return { roster }
}
