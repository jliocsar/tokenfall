import { decodeTrusted } from '@tokenfall/protocol/json'

export type InboxItem = {
  readonly id: string
  readonly message: string
  readonly thread: string
  readonly session: string | null
  readonly host: string
  readonly project: string
  readonly since: number
  readonly seq: number
}

export type ProjectInbox = {
  name: string
  readonly questions: Map<string, QuestionFacts>
  readonly messages: Map<string, MessageFacts>
}

type QuestionFacts = {
  readonly message: string
  readonly asker: string | null
  readonly seq: number
  readonly at: number
  readonly closed: boolean
  readonly awaitingResult: boolean
  readonly revision: number
  readonly sentRevision: number
  readonly sentReply: string | null
}

type MessageFacts = {
  readonly thread: string
  readonly seq: number
  readonly host: string
  readonly resolvedAt: string | null
  readonly resolvedSeq: number | null
}

type Line<Shape> = {
  readonly seq?: number
  readonly at?: string
  readonly id?: string
  readonly record?: Shape | null
}

type ActionResult = { readonly by?: string }

type QuestionRecord = {
  readonly message_id?: string
  readonly kind?: string
  readonly asked_by_agent_id?: string | null
  readonly superseded_by?: object | null
  readonly set_aside?: object | null
  readonly action_result?: ActionResult | null
  readonly revision?: number
  readonly sent_revision?: number
  readonly sent_reply_id?: string | null
}

type MessageRecord = {
  readonly thread_id?: string | null
  readonly resolved_at?: string | null
  readonly author?: { readonly host?: string | null } | null
}

type ProjectRecord = { readonly name?: string }

const UNKNOWN_HOST = 'unknown'
const ACTION = 'action'
const AGENT = 'agent'

const timeOf = (at: string | undefined): number => {
  const parsed = Date.parse(at ?? '')

  return Number.isNaN(parsed) ? 0 : parsed
}

const lineOf = <Shape>(raw: string): Line<Shape> | undefined => {
  try {
    return decodeTrusted<Line<Shape> | null>(raw) ?? undefined
  } catch {
    return undefined
  }
}

const closedBy = (record: QuestionRecord): boolean => {
  const result = record.action_result ?? null
  const byAgent = record.kind === ACTION && result !== null && result.by === AGENT

  return Boolean(record.superseded_by) || Boolean(record.set_aside) || byAgent
}

const factsOf = (
  record: QuestionRecord,
  message: string,
  first: { readonly seq: number; readonly at: number },
): QuestionFacts => ({
  message,
  asker: record.asked_by_agent_id ?? null,
  seq: first.seq,
  at: first.at,
  closed: closedBy(record),
  awaitingResult: record.kind === ACTION && (record.action_result ?? null) === null,
  revision: record.revision ?? 0,
  sentRevision: record.sent_revision ?? 0,
  sentReply: record.sent_reply_id ?? null,
})

const resolvedSeqOf = (
  previous: MessageFacts | undefined,
  resolvedAt: string | null,
  seq: number,
): number | null => {
  if (resolvedAt === null) {
    return null
  }

  return previous !== undefined && previous.resolvedAt === resolvedAt ? previous.resolvedSeq : seq
}

export const createProjectInbox = (name: string): ProjectInbox => ({
  name,
  questions: new Map(),
  messages: new Map(),
})

export const applyQuestion = (project: ProjectInbox, raw: string): boolean => {
  const line = lineOf<QuestionRecord>(raw)
  const record = line?.record ?? undefined
  const message = record?.message_id

  if (line?.id === undefined || record === undefined || message === undefined) {
    return false
  }

  const previous = project.questions.get(line.id)
  const first = previous ?? { seq: line.seq ?? 0, at: timeOf(line.at) }
  project.questions.set(line.id, factsOf(record, message, first))

  return true
}

export const applyMessage = (project: ProjectInbox, raw: string): boolean => {
  const line = lineOf<MessageRecord>(raw)
  const record = line?.record ?? undefined

  if (line?.id === undefined || record === undefined) {
    return false
  }

  const previous = project.messages.get(line.id)
  const seq = line.seq ?? 0
  const resolvedAt = record.resolved_at ?? null
  project.messages.set(line.id, {
    thread: record.thread_id ?? line.id,
    seq: previous?.seq ?? seq,
    host: record.author?.host ?? previous?.host ?? UNKNOWN_HOST,
    resolvedAt,
    resolvedSeq: resolvedSeqOf(previous, resolvedAt, seq),
  })

  return true
}

export const projectNameOf = (raw: string): string | undefined =>
  lineOf<ProjectRecord>(raw)?.record?.name

const archived = (project: ProjectInbox, message: MessageFacts): boolean => {
  const root = project.messages.get(message.thread)

  return (
    root?.resolvedSeq !== null && root?.resolvedSeq !== undefined && message.seq < root.resolvedSeq
  )
}

const sent = (project: ProjectInbox, question: QuestionFacts): boolean =>
  question.revision > 0 &&
  question.sentRevision === question.revision &&
  (question.sentReply === null || project.messages.has(question.sentReply))

const waiting = (project: ProjectInbox, question: QuestionFacts): MessageFacts | undefined => {
  const message = project.messages.get(question.message)

  if (question.closed || message === undefined || archived(project, message)) {
    return undefined
  }

  return question.awaitingResult || !sent(project, question) ? message : undefined
}

export const openItems = (projects: Iterable<ProjectInbox>): InboxItem[] => {
  const items: InboxItem[] = []

  for (const project of projects) {
    for (const [id, question] of project.questions) {
      const message = waiting(project, question)

      if (message !== undefined) {
        items.push({
          id,
          message: question.message,
          thread: message.thread,
          session: question.asker,
          host: message.host,
          project: project.name,
          since: question.at,
          seq: question.seq,
        })
      }
    }
  }

  return items
}

export const maxSeqOf = (projects: Iterable<ProjectInbox>): number => {
  let max = 0

  for (const project of projects) {
    for (const question of project.questions.values()) {
      max = Math.max(max, question.seq)
    }
  }

  return max
}
