import tuning from '@tokenfall/data/ravens.json'

const { age } = tuning

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const ageText = (now: number, since: number): string => {
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
