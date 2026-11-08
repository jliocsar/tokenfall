import tuning from '@tokenfall/data/chronicle.json'
import type { ChronicleLine } from '@tokenfall/protocol/chronicle'
import { displayName, nameOf, titleOf, type Characters } from '../../core/character.ts'

export type LineText = {
  readonly before: string
  readonly name: string
  readonly after: string
}

const NAME = '{name}'
const LEVEL = '{level}'

const templateOf = (line: ChronicleLine): string =>
  line.kind === 'died' ? tuning.died[line.cause ?? 'missing'] : tuning[line.kind]

export const lineText = (characters: Characters, line: ChronicleLine): LineText => {
  const template = templateOf(line).replace(LEVEL, String(line.level ?? 1))
  const at = template.indexOf(NAME)

  return {
    before: template.slice(0, at),
    name: displayName(nameOf(characters, line.hero), titleOf(line.title)),
    after: template.slice(at + NAME.length),
  }
}

export const timeOf = (at: number, now: number): string => {
  const date = new Date(at)
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return date.toDateString() === new Date(now).toDateString()
    ? time
    : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

export const AWAY = tuning.away
