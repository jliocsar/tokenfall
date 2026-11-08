import tuning from '@tokenfall/data/ravens.json'
import { threadUrl, type Notice } from '@tokenfall/protocol/inbox'
import { createSignal, For, onCleanup, Show } from 'solid-js'
import type { InboxModel } from '../ravens/model.ts'
import type { NoticeBoard } from './model.ts'

type NoticeListProps = {
  readonly board: NoticeBoard
  readonly inbox: InboxModel
}

const { board: text, age } = tuning

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const ageText = (now: number, since: number): string => {
  const elapsed = Math.max(0, now - since)

  if (elapsed < MINUTE) {
    return age.now
  }

  if (elapsed < HOUR) {
    return age.minutes.replace('{n}', String(Math.floor(elapsed / MINUTE)))
  }

  return elapsed < DAY
    ? age.hours.replace('{n}', String(Math.floor(elapsed / HOUR)))
    : age.days.replace('{n}', String(Math.floor(elapsed / DAY)))
}

const countText = (count: number): string =>
  count === 1 ? text.noticeOne : text.noticeMany.replace('{count}', String(count))

export const NoticeList = (props: NoticeListProps) => {
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => {
    setNow(Date.now())
  }, text.ageEveryMs)
  onCleanup(() => {
    clearInterval(timer)
  })

  const link = (notice: Notice): string | undefined => {
    const { url } = props.inbox.state()

    return url === null ? undefined : threadUrl(url, notice.thread)
  }

  return (
    <Show when={props.board.open()}>
      <aside class="notice-board panel">
        <button
          type="button"
          class="close"
          onClick={() => {
            props.board.hide()
          }}
        >
          ×
        </button>
        <div class="title">{text.title}</div>
        <Show when={props.board.notices().length > 0} fallback={<p class="empty">{text.empty}</p>}>
          <ul>
            <For each={props.board.notices()}>
              {(notice) => (
                <li>
                  <span class="project">{notice.project}</span>
                  <span class="meta">
                    {`${notice.host} · ${countText(notice.count)} · ${ageText(now(), notice.since)}`}
                  </span>
                  <Show when={link(notice)}>
                    {(href) => (
                      <a class="inbox-link" href={href()} target="_blank" rel="noopener">
                        {tuning.openInbox}
                      </a>
                    )}
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </aside>
    </Show>
  )
}
