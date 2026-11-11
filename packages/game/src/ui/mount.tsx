import { createRoot, Show } from 'solid-js'
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
import type { DungeonModel } from '../features/dungeon/model.ts'
import { TierStrip } from '../features/dungeon/TierStrip.tsx'
import './skins/dusk.css'
import './ui.css'

export type Ui = { readonly roster: Roster }

export type UiMode = { readonly source: string; readonly debug: boolean }

export type UiModels = {
  readonly chronicle: ChronicleModel
  readonly inbox: InboxModel
  readonly sheet: SheetModel
  readonly board: NoticeBoard
  readonly onBoard: () => void
  readonly dungeon: DungeonModel
}

export const mountUi = (bridge: Bridge, mode: UiMode, models: UiModels, root: HTMLElement): Ui => {
  const { chronicle, inbox, sheet, board, onBoard, dungeon } = models
  const roster = createRoot(() => createRoster(bridge.sim))
  render(
    () => (
      <>
        <Show when={mode.debug}>
          <DevPanel bridge={bridge} source={mode.source} />
        </Show>
        <Banner inbox={inbox} />
        <TierStrip model={dungeon} />
        <Sheet bridge={bridge} roster={roster} inbox={inbox} sheet={sheet} />
        <aside class="roster panel">
          <RosterTree bridge={bridge} roster={roster} board={board} onBoard={onBoard} />
        </aside>
        <div class="dock-top-left">
          <HeroCard bridge={bridge} roster={roster} inbox={inbox} sheet={sheet} />
          <NoticeList board={board} inbox={inbox} />
        </div>
        <div class="dock-left">
          <Chronicle bridge={bridge} model={chronicle} />
        </div>
      </>
    ),
    root,
  )

  return { roster }
}
