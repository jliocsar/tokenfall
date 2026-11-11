import { KEYBINDS } from '../../render/camera.ts'

export type HeroKey = 'follow' | 'fit' | 'sheet' | 'none'

export type KeyPress = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>

const NOBODY = -1

const bound = (keys: readonly string[], key: string): boolean => keys.includes(key)

const modified = (press: KeyPress): boolean => press.ctrlKey || press.metaKey || press.altKey

export const routeKey = (press: KeyPress, selected: number): HeroKey => {
  if (modified(press)) {
    return 'none'
  }

  if (bound(KEYBINDS.fit, press.key)) {
    return selected === NOBODY ? 'fit' : 'follow'
  }

  if (
    selected !== NOBODY &&
    (bound(KEYBINDS.sheet, press.key) || bound(KEYBINDS.character, press.key))
  ) {
    return 'sheet'
  }

  return 'none'
}

export const closesSheet = (press: KeyPress): boolean =>
  !modified(press) && bound(KEYBINDS.character, press.key)
