export type Notice = {
  readonly thread: string
  readonly project: string
  readonly host: string
  readonly count: number
  readonly since: number
}

export type InboxState = {
  readonly up: boolean
  readonly url: string | null
  readonly notices: readonly Notice[]
}

export const INBOX_DOWN: InboxState = { up: false, url: null, notices: [] }

export const threadUrl = (url: string, thread: string): string =>
  `${url.endsWith('/') ? url : `${url}/`}#thread=${encodeURIComponent(thread)}`
