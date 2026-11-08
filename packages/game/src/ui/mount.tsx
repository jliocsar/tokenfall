import { createRoot } from 'solid-js'
import { render } from 'solid-js/web'
import { Chronicle } from '../features/chronicle/Chronicle.tsx'
import type { ChronicleModel } from '../features/chronicle/model.ts'
import type { NoticeBoard } from '../features/notices/model.ts'
import { NoticeList } from '../features/notices/NoticeList.tsx'
import { Banner } from '../features/ravens/Banner.tsx'
import type { InboxModel } from '../features/ravens/model.ts'
import type { SheetModel } from '../features/sheet/model.ts'
import { Sheet } from '../features/sheet/Sheet.tsx'
import { HeroCard } from '../features/roster/HeroCard.tsx'
import { createRoster, type Roster } from '../features/roster/model.ts'
import { RosterTree } from '../features/roster/Roster.tsx'
import type { Bridge } from './bridge.ts'
import { DevPanel } from './DevPanel.tsx'
import './skins/dusk.css'
import './ui.css'

export type Ui = { readonly roster: Roster }

export type UiModels = {
  readonly chronicle: ChronicleModel
  readonly inbox: InboxModel
  readonly sheet: SheetModel
  readonly board: NoticeBoard
  readonly onBoard: () => void
}

export const mountUi = (
  bridge: Bridge,
  source: string,
  models: UiModels,
  root: HTMLElement,
): Ui => {
  const { chronicle, inbox, sheet, board, onBoard } = models
  const roster = createRoot(() => createRoster(bridge.sim))
  render(
    () => (
      <>
        <DevPanel bridge={bridge} source={source} />
        <Banner inbox={inbox} />
        <NoticeList board={board} inbox={inbox} />
        <Sheet bridge={bridge} roster={roster} inbox={inbox} sheet={sheet} />
        <aside class="roster panel">
          <RosterTree bridge={bridge} roster={roster} board={board} onBoard={onBoard} />
        </aside>
        <div class="dock-left">
          <HeroCard bridge={bridge} roster={roster} inbox={inbox} sheet={sheet} />
          <Chronicle bridge={bridge} model={chronicle} />
        </div>
      </>
    ),
    root,
  )

  return { roster }
}
