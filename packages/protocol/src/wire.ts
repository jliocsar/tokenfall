import type { ChronicleLine } from './chronicle.ts'
import type { HeroEvent } from './events.ts'
import type { HeroInfo } from './hero.ts'
import type { InboxState } from './inbox.ts'
import type { Control, Frame } from './terminal.ts'

export type Snapshot = {
  readonly kind: 'snapshot'
  readonly version: number
  readonly seq: number
  readonly at: number
  readonly townSeed: number
  readonly heroes: readonly HeroInfo[]
  readonly chronicle: readonly ChronicleLine[]
  readonly inbox: InboxState
}

export type Delta = {
  readonly kind: 'delta'
  readonly seq: number
  readonly at: number
  readonly events: readonly HeroEvent[]
  readonly chronicle: readonly ChronicleLine[]
  readonly inbox?: InboxState
}

export type ServerMessage = Snapshot | Delta | Frame | Control

export type RecordingHeader = {
  readonly kind: 'recording'
  readonly version: number
  readonly startedAt: number
  readonly source: 'herdr' | 'synthetic'
  readonly note: string
}

export type RecordingLine = RecordingHeader | HeroEvent

export const PROTOCOL_VERSION = 9
export const RECORDING_VERSION = 5
