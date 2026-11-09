import death from '@tokenfall/data/death.json'
import type { DeathCause } from '@tokenfall/protocol/hero'
import { ageText } from '../../ui/age.ts'

export const resumeCommand = (session: string): string => `claude --resume ${session}`

export const deathText = (cause: DeathCause | null, diedAt: number, clock: number): string =>
  death.text.died
    .replace('{cause}', cause === null ? '' : death.text.causes[cause])
    .replace('{ago}', ageText(clock, diedAt))
    .trim()
