import type { HeroEvent } from '@tokenfall/protocol/events'
import { NO_PLOT } from '@tokenfall/protocol/hero'
import { decodeTrusted } from '@tokenfall/protocol/json'
import {
  RECORDING_VERSION,
  type RecordingHeader,
  type RecordingLine,
} from '@tokenfall/protocol/wire'

export type Recording = {
  readonly header: RecordingHeader
  readonly events: readonly HeroEvent[]
}

const isHeader = (line: RecordingLine): line is RecordingHeader => line.kind === 'recording'

const sessionOf = (id: string): string | null => {
  const at = id.indexOf('/session/')

  return at === -1 ? null : id.slice(at + '/session/'.length)
}

const upgradeV1 = (event: HeroEvent): HeroEvent => {
  if (event.kind === 'hero.joined') {
    return { ...event, hero: { ...event.hero, session: sessionOf(event.hero.id), plot: NO_PLOT } }
  }

  if (event.kind === 'hero.moved') {
    return { ...event, plot: NO_PLOT }
  }

  if (event.kind === 'hero.linked') {
    return { ...event, session: sessionOf(event.to) ?? '' }
  }

  return event
}

export const parseRecording = (text: string): Recording => {
  const lines: RecordingLine[] = text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => decodeTrusted<RecordingLine>(line))
  const first = lines[0]

  if (first === undefined || !isHeader(first)) {
    throw new Error('a recording starts with a header line')
  }

  if (first.version !== RECORDING_VERSION && first.version !== 1) {
    throw new Error(`recording version ${first.version}, expected ${RECORDING_VERSION}`)
  }

  const events: HeroEvent[] = []

  for (const line of lines.slice(1)) {
    if (!isHeader(line)) {
      events.push(first.version === 1 ? upgradeV1(line) : line)
    }
  }

  return { header: first, events }
}

export const headerLine = (header: RecordingHeader): string => `${JSON.stringify(header)}\n`

export const eventLine = (event: HeroEvent): string => `${JSON.stringify(event)}\n`
