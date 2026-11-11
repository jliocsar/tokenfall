import sheetText from '@tokenfall/data/sheet.json'
import type { PromptOutcome } from '@tokenfall/protocol/terminal'
import { createSignal, Show } from 'solid-js'
import { readHistory, recall, remember, saveHistory } from './history.ts'

type PromptBoxProps = {
  readonly name: string
  readonly live: boolean
  readonly blocked: boolean
  readonly send: (text: string) => Promise<PromptOutcome>
}

type Draft = { cursor: number; stash: string }

const ENTER = 'Enter'
const UP = 'ArrowUp'
const DOWN = 'ArrowDown'
const ESCAPE = 'Escape'
const LINE_PX = 20

const noteOf = (outcome: PromptOutcome): string =>
  outcome === 'sent' ? sheetText.prompt.sent : sheetText.prompt.outcomes[outcome]

const grow = (box: HTMLTextAreaElement): void => {
  box.style.height = 'auto'
  box.style.height = `${Math.min(box.scrollHeight, LINE_PX * sheetText.prompt.maxLines)}px`
}

export const PromptBox = (props: PromptBoxProps) => {
  const [text, setText] = createSignal('')
  const [note, setNote] = createSignal('')
  const [sending, setSending] = createSignal(false)
  const history = { entries: readHistory(localStorage) }
  const draft: Draft = { cursor: history.entries.length, stash: '' }
  const disabled = () => !props.live || props.blocked || sending()
  const reason = () => (props.live ? sheetText.prompt.blocked : sheetText.prompt.notLive)

  const submit = async (box: HTMLTextAreaElement): Promise<void> => {
    const value = text()

    if (value.trim() === '' || disabled()) {
      return
    }

    setSending(true)
    setNote(sheetText.prompt.sending)
    const outcome = await props.send(value)
    setSending(false)
    setNote(noteOf(outcome))

    if (outcome === 'sent') {
      history.entries = remember(history.entries, value)
      saveHistory(localStorage, history.entries)
      draft.cursor = history.entries.length
      setText('')
      box.value = ''
      grow(box)
    }

    box.focus()
  }

  const browse = (box: HTMLTextAreaElement, step: number): void => {
    if (draft.cursor === history.entries.length) {
      draft.stash = text()
    }

    draft.cursor = recall(history.entries, draft.cursor, step)
    const value = history.entries[draft.cursor] ?? draft.stash
    setText(value)
    box.value = value
    grow(box)
  }

  const onKey = (event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }): void => {
    const box = event.currentTarget

    if (event.key === ESCAPE) {
      return
    }

    event.stopPropagation()

    if (event.key === ENTER && !event.shiftKey) {
      event.preventDefault()
      void submit(box)
    } else if (event.key === UP && !box.value.slice(0, box.selectionStart).includes('\n')) {
      event.preventDefault()
      browse(box, -1)
    } else if (event.key === DOWN && !box.value.slice(box.selectionEnd).includes('\n')) {
      event.preventDefault()
      browse(box, 1)
    }
  }

  return (
    <div class="prompt-box" classList={{ disabled: !props.live || props.blocked }}>
      <textarea
        rows={1}
        value={text()}
        disabled={disabled()}
        placeholder={
          !props.live || props.blocked
            ? reason()
            : sheetText.prompt.placeholder.replace('{name}', props.name)
        }
        onInput={(event) => {
          setText(event.currentTarget.value)
          grow(event.currentTarget)
        }}
        onKeyDown={onKey}
        onKeyUp={(event) => {
          event.stopPropagation()
        }}
      />
      <Show when={note()}>
        <div class="prompt-note">{note()}</div>
      </Show>
    </div>
  )
}
