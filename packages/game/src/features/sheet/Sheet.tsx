import death from '@tokenfall/data/death.json'
import ravens from '@tokenfall/data/ravens.json'
import sheetText from '@tokenfall/data/sheet.json'
import { threadUrl } from '@tokenfall/protocol/inbox'
import { createEffect, createSignal, onCleanup, Show, type Accessor } from 'solid-js'
import { guildLabel } from '../../core/groups.ts'
import { NOBODY, type Bridge } from '../../ui/bridge.ts'
import { Portrait } from '../../ui/Portrait.tsx'
import type { InboxModel } from '../ravens/model.ts'
import { deathText, resumeCommand } from '../death/text.ts'
import type { HeroRow, Roster } from '../roster/model.ts'
import type { SheetModel } from './model.ts'
import { createFontSize, rowHeightOf, type FontSize } from './font.ts'
import { mountTerminal, type TerminalView } from './terminal.ts'

type SheetProps = {
  readonly bridge: Bridge
  readonly roster: Roster
  readonly inbox: InboxModel
  readonly sheet: SheetModel
}

type SheetHeadProps = {
  readonly name: string
  readonly font: FontSize
  readonly onClose: () => void
}

type TerminalProps = { readonly sheet: SheetModel; readonly fontPx: Accessor<number> }

type TerminalRefs = {
  current: TerminalView | undefined
  host: HTMLDivElement | undefined
  frame: HTMLDivElement | undefined
}

const ESCAPE = 'Escape'
const PERCENT = 100

const progressOf = (thresholds: Float64Array, level: number, experience: number): number => {
  const floor = thresholds[level - 1] ?? 0
  const next = thresholds[level]

  if (next === undefined || next <= floor) {
    return 1
  }

  return Math.min(1, Math.max(0, (experience - floor) / (next - floor)))
}

const formatTokens = (tokens: number): string =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(tokens)

const Terminal = (props: TerminalProps) => {
  const view: TerminalRefs = {
    current: undefined,
    host: undefined,
    frame: undefined,
  }

  const size = (px: number): void => {
    const host = view.host

    if (host !== undefined && view.current !== undefined) {
      host.style.setProperty('--term-font-size', `${px}px`)
      host.style.setProperty('--term-row-height', `${rowHeightOf(px)}px`)
    }
  }

  const toBottom = (): void => {
    const frame = view.frame

    if (frame !== undefined) {
      frame.scrollTop = frame.scrollHeight
    }
  }

  createEffect(() => {
    size(props.fontPx())
    requestAnimationFrame(() => {
      requestAnimationFrame(toBottom)
    })
  })

  createEffect(() => {
    const screen = props.sheet.screen()

    if (screen?.alive === true && view.current !== undefined) {
      view.current.paint(screen)
    }
  })

  const start = async (host: HTMLDivElement): Promise<void> => {
    const mounted = await mountTerminal(host)
    view.current = mounted
    size(props.fontPx())
    const screen = props.sheet.screen()

    if (screen?.alive === true) {
      mounted.paint(screen)
    }

    requestAnimationFrame(toBottom)
  }

  onCleanup(() => {
    view.current?.destroy()
  })

  return (
    <div
      class="terminal-frame"
      ref={(frame) => {
        view.frame = frame
      }}
    >
      <div
        class="terminal"
        inert
        ref={(host) => {
          view.host = host
          void start(host)
        }}
      />
      <Show when={!props.sheet.live}>
        <div class="terminal-note">{sheetText.noTerminal}</div>
      </Show>
      <Show when={props.sheet.live && props.sheet.screen() === undefined}>
        <div class="terminal-note">{sheetText.loading}</div>
      </Show>
      <Show when={props.sheet.screen()?.alive === false}>
        <div class="terminal-note">{sheetText.fallen}</div>
      </Show>
    </div>
  )
}

const Fallen = (props: { readonly hero: HeroRow }) => {
  const [copied, setCopied] = createSignal(false)

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(resumeCommand(props.hero.session))
    setCopied(true)
  }

  return (
    <div class="terminal-frame fallen-frame">
      <Show when={props.hero.session} fallback={<p>{death.text.noSession}</p>}>
        <p>{death.text.terminal}</p>
        <code class="resume">{resumeCommand(props.hero.session)}</code>
        <button
          type="button"
          class="copy-resume"
          onClick={() => {
            void copy()
          }}
        >
          {copied() ? death.text.copied : death.text.copy}
        </button>
      </Show>
    </div>
  )
}

const SheetHead = (props: SheetHeadProps) => (
  <header class="sheet-head">
    <span class="title">{props.name}</span>
    <button
      type="button"
      class="tool"
      disabled={props.font.px() <= sheetText.minFontPx}
      onClick={() => {
        props.font.step(-1)
      }}
    >
      {sheetText.smaller}
    </button>
    <button
      type="button"
      class="tool"
      disabled={props.font.px() >= sheetText.maxFontPx}
      onClick={() => {
        props.font.step(1)
      }}
    >
      {sheetText.bigger}
    </button>
    <button type="button" class="tool close" aria-label={sheetText.close} onClick={props.onClose}>
      ×
    </button>
  </header>
)

export const Sheet = (props: SheetProps) => {
  const sim = () => props.bridge.sim
  const font = createFontSize(localStorage)

  const row = () => {
    const eid = props.sheet.open()

    return eid === NOBODY ? undefined : props.roster.rows[eid]
  }

  const inboxLink = (thread: string): string | undefined => {
    const { url } = props.inbox.state()

    return url === null || thread === '' ? undefined : threadUrl(url, thread)
  }

  const onKey = (event: KeyboardEvent): void => {
    if (props.sheet.open() === NOBODY) {
      return
    }

    event.stopImmediatePropagation()

    if (event.key === ESCAPE) {
      props.sheet.hide()
    }
  }

  window.addEventListener('keydown', onKey, { capture: true })
  onCleanup(() => {
    window.removeEventListener('keydown', onKey, { capture: true })
  })

  return (
    <Show when={row()}>
      {(hero) => {
        const eid = hero().eid
        const experience = () => sim().stores.hero.experience[eid] ?? 0
        const progress = () => progressOf(sim().thresholds, hero().level, experience())

        return (
          <div class="sheet-backdrop">
            <section class="sheet panel" role="dialog" aria-label={hero().fullName}>
              <SheetHead
                name={hero().fullName}
                font={font}
                onClose={() => {
                  props.sheet.hide()
                }}
              />
              <div class="sheet-body">
                <div class="sheet-facts">
                  <Portrait
                    atlas={props.bridge.portraits}
                    sheet={hero().sheet}
                    size="large"
                    status={hero().standing}
                  />
                  <div class="meta">
                    {hero().stranger
                      ? sheetText.stranger
                      : `Lv ${hero().level} ${hero().className} · ${hero().personality}`}
                  </div>
                  <div class="xp" title={`${formatTokens(experience())} tokens`}>
                    <div
                      class="xp-fill"
                      style={{ width: `${(progress() * PERCENT).toFixed(1)}%` }}
                    />
                  </div>
                  <div class="xp-label">
                    {`${formatTokens(experience())} ${sheetText.experience}`}
                  </div>
                  <div class={`badge standing-${hero().standing}`}>{hero().standing}</div>
                  <Show when={hero().standing === 'dead' && hero().cause !== null}>
                    <div class="died">
                      {deathText(
                        hero().cause,
                        hero().diedAt,
                        performance.now() + sim().clockOffset,
                      )}
                    </div>
                  </Show>
                  <dl>
                    <dt>{sheetText.quest}</dt>
                    <dd>{hero().quest || sheetText.noQuest}</dd>
                    <dt>{sheetText.guild}</dt>
                    <dd>{guildLabel(sim().groups.guildKeys[hero().guild] ?? '')}</dd>
                    <dt>{sheetText.party}</dt>
                    <dd>{sim().groups.partyWorkspace[hero().party] ?? ''}</dd>
                    <dt>{sheetText.minions}</dt>
                    <dd>{sim().stores.hero.minions[eid] ?? 0}</dd>
                  </dl>
                  <Show when={hero().waiting}>
                    <div class={`waiting wait-${hero().wait}`}>{hero().waiting}</div>
                  </Show>
                  <Show when={inboxLink(hero().ravenThread)}>
                    {(href) => (
                      <a class="inbox-link" href={href()} target="_blank" rel="noopener">
                        {ravens.openInbox}
                      </a>
                    )}
                  </Show>
                </div>
                <Show
                  when={hero().standing === 'dead'}
                  fallback={<Terminal sheet={props.sheet} fontPx={font.px} />}
                >
                  <Fallen hero={hero()} />
                </Show>
              </div>
            </section>
          </div>
        )
      }}
    </Show>
  )
}
