import { Show } from 'solid-js'
import { NOBODY, type Bridge } from '../../ui/bridge.ts'
import { Portrait } from '../../ui/Portrait.tsx'
import ravens from '@tokenfall/data/ravens.json'
import { threadUrl } from '@tokenfall/protocol/inbox'
import type { InboxModel } from '../ravens/model.ts'
import type { Roster } from './model.ts'

type HeroCardProps = {
  readonly bridge: Bridge
  readonly roster: Roster
  readonly inbox: InboxModel
}

export const HeroCard = (props: HeroCardProps) => {
  const inboxLink = (thread: string): string | undefined => {
    const { url } = props.inbox.state()

    return url === null || thread === '' ? undefined : threadUrl(url, thread)
  }

  const row = () => {
    const eid = props.bridge.selected()

    return eid === NOBODY ? undefined : props.roster.rows[eid]
  }

  return (
    <Show when={row()}>
      {(hero) => (
        <aside class="hero-card panel">
          <button
            type="button"
            class="close"
            onClick={() => {
              props.bridge.select(NOBODY)
            }}
          >
            ×
          </button>
          <Portrait
            atlas={props.bridge.portraits}
            sheet={hero().sheet}
            size="large"
            status={hero().standing}
          />
          <div class="facts">
            <div class="name">{hero().fullName}</div>
            <div class="meta">
              {hero().stranger
                ? 'not yet known'
                : `Lv ${hero().level} ${hero().className} · ${hero().personality}`}
            </div>
            <div class={`badge standing-${hero().standing}`}>{hero().standing}</div>
            <div class="quest">{hero().quest || 'no quest yet'}</div>
            <Show when={hero().waiting}>
              <div class="waiting">{hero().waiting}</div>
            </Show>
            <Show when={inboxLink(hero().ravenThread)}>
              {(href) => (
                <a class="inbox-link" href={href()} target="_blank" rel="noopener">
                  {ravens.openInbox}
                </a>
              )}
            </Show>
          </div>
        </aside>
      )}
    </Show>
  )
}
