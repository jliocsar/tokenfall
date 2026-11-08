import { createEffect, For, on, Show } from 'solid-js'
import { entityOfHero, NONE } from '../../core/hero-index.ts'
import type { Bridge } from '../../ui/bridge.ts'
import type { ChronicleModel } from './model.ts'
import { AWAY, lineText, timeOf } from './text.ts'

type ChronicleProps = { readonly bridge: Bridge; readonly model: ChronicleModel }

type Scroll = { stuck: boolean; body: HTMLDivElement | undefined }

const STUCK_PX = 8

export const Chronicle = (props: ChronicleProps) => {
  const state: Scroll = { stuck: true, body: undefined }
  const firstNew = () => props.model.lines().find((line) => line.seq > props.model.seen())?.seq

  createEffect(
    on(props.model.lines, () => {
      if (state.stuck && state.body !== undefined) {
        state.body.scrollTop = state.body.scrollHeight
      }
    }),
  )

  return (
    <section class="chronicle panel" classList={{ collapsed: props.model.collapsed() }}>
      <button type="button" class="chronicle-head" onClick={props.model.toggle}>
        Chronicle <span class="chevron">{props.model.collapsed() ? '▴' : '▾'}</span>
      </button>
      <Show when={!props.model.collapsed()}>
        <div
          class="chronicle-body"
          ref={(body) => {
            state.body = body
            queueMicrotask(() => {
              body.scrollTop = body.scrollHeight
            })
          }}
          onScroll={(event) => {
            const body = event.currentTarget
            state.stuck = body.scrollHeight - body.scrollTop - body.clientHeight < STUCK_PX
          }}
        >
          <For each={props.model.lines()}>
            {(line) => {
              const text = lineText(props.bridge.sim.config.characters, line)

              const focus = () => {
                const eid = entityOfHero(props.bridge.sim.index, line.hero)

                if (eid !== NONE) {
                  props.bridge.focus(eid)
                }
              }

              return (
                <>
                  <Show when={line.seq === firstNew()}>
                    <div class="chronicle-away">{AWAY}</div>
                  </Show>
                  <p class={`chronicle-line ${line.kind}`}>
                    <time>{timeOf(line.at, Date.now())}</time>
                    {text.before}
                    <button type="button" class="who-link" onClick={focus}>
                      {text.name}
                    </button>
                    {text.after}
                  </p>
                </>
              )
            }}
          </For>
        </div>
      </Show>
    </section>
  )
}
