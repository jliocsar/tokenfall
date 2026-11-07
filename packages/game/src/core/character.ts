import { hashString, mulberry32 } from './random.ts'

export type Personality = {
  readonly name: string
  readonly class: string
  readonly sheet: string
}

export type NameTable = {
  readonly first: readonly string[]
  readonly second: readonly string[]
}

export type Characters = {
  readonly personalities: readonly Personality[]
  readonly sheetOfPersonality: Uint8Array
  readonly names: NameTable
}

const NAME_SALT = 0x9e_37_79_b9

export const createCharacters = (
  personalities: readonly Personality[],
  names: NameTable,
  sheets: readonly string[],
): Characters => ({
  personalities,
  sheetOfPersonality: new Uint8Array(
    personalities.map((personality) => {
      const sheet = sheets.indexOf(personality.sheet)

      if (sheet < 0) {
        throw new Error(
          `personality ${personality.name} names a missing sheet: ${personality.sheet}`,
        )
      }

      return sheet
    }),
  ),
  names,
})

export const personalityOf = (characters: Characters, id: string): number =>
  hashString(id) % characters.personalities.length

export const nameOf = (characters: Characters, id: string): string => {
  const random = mulberry32(hashString(id) ^ NAME_SALT)
  const { first, second } = characters.names

  return `${first[Math.floor(random() * first.length)]!}${second[Math.floor(random() * second.length)]!}`
}

export const titleOf = (raw: string): string =>
  raw
    .split(/[-_\s]+/u)
    .filter((word) => word !== '')
    .map((word) => `${word[0]!.toUpperCase()}${word.slice(1)}`)
    .join(' ')

export const displayName = (name: string, title: string): string =>
  title === '' ? name : `${name} the ${title}`
