import death from '@tokenfall/data/death.json'
import sheetText from '@tokenfall/data/sheet.json'
import { threadUrl } from '@tokenfall/protocol/inbox'
import type { Grid } from '@tokenfall/protocol/terminal'
import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { NOBODY, type Bridge } from '../../ui/bridge.ts'
import { closesSheet, releasesTerminal } from '../selection/keys.ts'
import type { InboxModel } from '../ravens/model.ts'
import { resumeCommand } from '../death/text.ts'
import type { HeroRow, Roster } from '../roster/model.ts'
import { Facts } from './Facts.tsx'
import type { Box } from './font.ts'
import type { SheetModel, Typing } from './model.ts'
import { mountTerminal, type TerminalView } from './terminal.ts'

type SheetProps = {
  readonly bridge: Bridge
  readonly roster: Roster
  readonly inbox: InboxModel
  readonly sheet: SheetModel
}

type SheetHeadProps = {
  readonly name: string
  readonly onClose: () => void
}

type TerminalProps = {
  readonly sheet: SheetModel
  readonly name: string
}

type TerminalRefs = {
  current: TerminalView | undefined
  frame: HTMLDivElement | undefined
}

const ESCAPE = 'Escape'
const FRAME_PAD_X = 14
const FRAME_PAD_Y = 10

const inTerminal = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('.terminal') !== null

const hint = (typing: Typing, name: string): string =>
  sheetText.typing[typing].replace('{name}', name)

const Terminal = (props: TerminalProps) => {
  const view: TerminalRefs = {
    current: undefined,
    frame: undefined,
  }
  const wheel = { rest: 0 }

  const room = (): Box | undefined =>
    view.frame === undefined
      ? undefined
      : {
          width: view.frame.clientWidth - FRAME_PAD_X,
          height: view.frame.clientHeight - FRAME_PAD_Y,
        }

  const grid = (): Grid | undefined => {
    const box = room()

    return box === undefined ? undefined : view.current?.grid(box)
  }

  const refit = (): void => {
    const box = room()

    if (box !== undefined) {
      view.current?.fit(box)
    }
  }

  const relayout = (): void => {
    refit()
    props.sheet.resize(grid())
  }

  createEffect(() => {
    if (props.sheet.typing() === 'busy') {
      view.current?.blur()
    }
  })

  const onWheel = (event: WheelEvent): void => {
    event.stopPropagation()

    if (props.sheet.typing() !== 'held') {
      return
    }

    event.preventDefault()
    wheel.rest += event.deltaY / sheetText.wheelLinePx
    const lines = Math.trunc(wheel.rest)

    if (lines !== 0) {
      wheel.rest -= lines
      props.sheet.scroll(lines < 0 ? 'up' : 'down', Math.abs(lines))
    }
  }

  const start = async (host: HTMLDivElement): Promise<void> => {
    host.addEventListener('wheel', onWheel, { capture: true, passive: false })
    const mounted = await mountTerminal(host, props.sheet.input)
    view.current = mounted
    host.addEventListener('focusin', () => {
      props.sheet.focus(grid())
    })
    host.addEventListener('focusout', (event) => {
      if (!(event.relatedTarget instanceof Node && host.contains(event.relatedTarget))) {
        props.sheet.blur()
      }
    })
    props.sheet.listen((frame) => {
      if (mounted.write(frame)) {
        refit()
      }
    })
    refit()
  }

  const watcher = new ResizeObserver(relayout)

  onCleanup(() => {
    watcher.disconnect()
    props.sheet.listen(undefined)
    view.current?.destroy()
  })

  return (
    <>
      <div
        class={`terminal-frame typing-${props.sheet.typing()}`}
        ref={(frame) => {
          view.frame = frame
          watcher.observe(frame)
          frame.addEventListener('keydown', (event) => {
            event.stopPropagation()
          })
        }}
      >
        <div
          class="terminal"
          ref={(host) => {
            void start(host)
          }}
        />
        <Show when={!props.sheet.live}>
          <div class="terminal-note">{sheetText.noTerminal}</div>
        </Show>
        <Show when={props.sheet.live && props.sheet.terminal() === 'waiting'}>
          <div class="terminal-note">{sheetText.loading}</div>
        </Show>
        <Show when={props.sheet.terminal() === 'fallen'}>
          <div class="terminal-note">{sheetText.fallen}</div>
        </Show>
      </div>
      <Show when={props.sheet.live && props.sheet.terminal() === 'alive'}>
        <div class={`typing-hint typing-${props.sheet.typing()}`}>
          {hint(props.sheet.typing(), props.name)}
        </div>
      </Show>
    </>
  )
}

const sheetKeys =
  (sheet: SheetModel) =>
  (event: KeyboardEvent): void => {
    if (sheet.open() === NOBODY) {
      return
    }

    if (inTerminal(event.target)) {
      if (releasesTerminal(event)) {
        event.preventDefault()
        event.stopImmediatePropagation()

        if (event.target instanceof HTMLElement) {
          event.target.blur()
        }
      }

      return
    }

    event.stopImmediatePropagation()

    if (event.key === ESCAPE || closesSheet(event)) {
      sheet.hide()
    }
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
    <button type="button" class="tool close" aria-label={sheetText.close} onClick={props.onClose}>
      ×
    </button>
  </header>
)

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

  const onKey = sheetKeys(props.sheet)

  window.addEventListener('keydown', onKey, { capture: true })
  onCleanup(() => {
    window.removeEventListener('keydown', onKey, { capture: true })
  })

  return (
    <Show when={row()}>
      {(hero) => {
        return (
          <div class="sheet-backdrop">
            <section class="sheet panel" role="dialog" aria-label={hero().fullName}>
              <SheetHead
                name={hero().fullName}
                onClose={() => {
                  props.sheet.hide()
                }}
              />
              <div class="sheet-body">
                <Facts
                  hero={hero()}
                  sim={sim()}
                  portraits={props.bridge.portraits}
                  inbox={inboxLink(hero().ravenThread)}
                />
                <Show
                  when={hero().standing === 'dead'}
                  fallback={
                    <div class="terminal-column">
                      <Terminal sheet={props.sheet} name={hero().name} />
                    </div>
                  }
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
