import { Show } from 'solid-js'
import { NOBODY, type Bridge } from '../../ui/bridge.ts'
import { Portrait } from '../../ui/Portrait.tsx'
import type { Roster } from './model.ts'

type HeroCardProps = { readonly bridge: Bridge; readonly roster: Roster }

export const HeroCard = (props: HeroCardProps) => {
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
              Lv {hero().level} {hero().className} · {hero().personality}
            </div>
            <div class={`badge standing-${hero().standing}`}>{hero().standing}</div>
            <div class="quest">{hero().quest || 'no quest yet'}</div>
          </div>
        </aside>
      )}
    </Show>
  )
}
