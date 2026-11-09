import death from '@tokenfall/data/death.json'
import ravens from '@tokenfall/data/ravens.json'
import sheetText from '@tokenfall/data/sheet.json'
import { threadUrl } from '@tokenfall/protocol/inbox'
import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { guildLabel } from '../../core/groups.ts'
import { NOBODY, type Bridge } from '../../ui/bridge.ts'
import { Portrait } from '../../ui/Portrait.tsx'
import type { InboxModel } from '../ravens/model.ts'
import { deathText, resumeCommand } from '../death/text.ts'
import type { HeroRow, Roster } from '../roster/model.ts'
import type { SheetModel } from './model.ts'
import { mountTerminal, type TerminalView } from './terminal.ts'

type SheetProps = {
  readonly bridge: Bridge
  readonly roster: Roster
  readonly inbox: InboxModel
  readonly sheet: SheetModel
}

type TerminalProps = { readonly sheet: SheetModel }

type TerminalRefs = { current: TerminalView | undefined; host: HTMLDivElement | undefined }

const ESCAPE = 'Escape'
const CHAR_WIDTH = 0.6
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
  }

  const fit = (cols: number): void => {
    const host = view.host

    if (host !== undefined && cols > 0) {
      const size = Math.max(
        sheetText.minFontPx,
        Math.min(sheetText.maxFontPx, host.clientWidth / (cols * CHAR_WIDTH)),
      )
      host.style.setProperty('--term-font-size', `${size.toFixed(1)}px`)
    }
  }

  createEffect(() => {
    const screen = props.sheet.screen()

    if (screen?.alive === true && view.current !== undefined) {
      fit(screen.cols)
      view.current.paint(screen)
    }
  })

  const start = async (host: HTMLDivElement): Promise<void> => {
    const mounted = await mountTerminal(host)
    view.current = mounted
    const screen = props.sheet.screen()

    if (screen?.alive === true) {
      fit(screen.cols)
      mounted.paint(screen)
    }
  }

  onCleanup(() => {
    view.current?.destroy()
  })

  return (
    <div class="terminal-frame">
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

export const Sheet = (props: SheetProps) => {
  const sim = () => props.bridge.sim

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
              <button
                type="button"
                class="close"
                onClick={() => {
                  props.sheet.hide()
                }}
              >
                ×
              </button>
              <div class="sheet-facts">
                <Portrait
                  atlas={props.bridge.portraits}
                  sheet={hero().sheet}
                  size="large"
                  status={hero().standing}
                />
                <div class="name">{hero().fullName}</div>
                <div class="meta">
                  {hero().stranger
                    ? sheetText.stranger
                    : `Lv ${hero().level} ${hero().className} · ${hero().personality}`}
                </div>
                <div class="xp" title={`${formatTokens(experience())} tokens`}>
                  <div class="xp-fill" style={{ width: `${(progress() * PERCENT).toFixed(1)}%` }} />
                </div>
                <div class="xp-label">
                  {`${formatTokens(experience())} ${sheetText.experience}`}
                </div>
                <div class={`badge standing-${hero().standing}`}>{hero().standing}</div>
                <Show when={hero().standing === 'dead' && hero().cause !== null}>
                  <div class="died">
                    {deathText(hero().cause, hero().diedAt, performance.now() + sim().clockOffset)}
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
              <Show when={hero().standing === 'dead'} fallback={<Terminal sheet={props.sheet} />}>
                <Fallen hero={hero()} />
              </Show>
            </section>
          </div>
        )
      }}
    </Show>
  )
}
