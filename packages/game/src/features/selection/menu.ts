import { createSignal, type Accessor, type Setter } from 'solid-js'
import { NOBODY } from '../../ui/bridge.ts'

export type MenuElement = { readonly style: { transform: string; visibility: string } }

export type MenuModel = {
  element: MenuElement | undefined
  readonly delving: Accessor<boolean>
  readonly setDelving: Setter<boolean>
  readonly following: Accessor<number>
  readonly setFollowing: Setter<number>
  readonly last: Float64Array
}

export type MenuActions = {
  readonly sheet: (eid: number) => void
  readonly follow: (eid: number) => void
  readonly dungeon: (eid: number) => void
}

const SHOWN = 1
const HIDDEN = 0

export const createMenu = (): MenuModel => {
  const [delving, setDelving] = createSignal(false)
  const [following, setFollowing] = createSignal(NOBODY)

  return {
    element: undefined,
    delving,
    setDelving,
    following,
    setFollowing,
    last: new Float64Array([Number.NaN, Number.NaN, HIDDEN]),
  }
}

export const hideMenu = (menu: MenuModel): void => {
  if (menu.element !== undefined && menu.last[2] !== HIDDEN) {
    menu.last[2] = HIDDEN
    menu.element.style.visibility = 'hidden'
  }
}

export const placeMenu = (menu: MenuModel, x: number, y: number, delving: boolean): void => {
  const element = menu.element

  if (element === undefined) {
    return
  }

  const px = Math.round(x)
  const py = Math.round(y)

  if (px !== menu.last[0] || py !== menu.last[1]) {
    menu.last[0] = px
    menu.last[1] = py
    element.style.transform = `translate(${px}px, ${py}px) translate(-50%, -100%)`
  }

  if (menu.last[2] !== SHOWN) {
    menu.last[2] = SHOWN
    element.style.visibility = 'visible'
  }

  if (menu.delving() !== delving) {
    menu.setDelving(delving)
  }
}

export const noteFollowing = (menu: MenuModel, eid: number): void => {
  if (menu.following() !== eid) {
    menu.setFollowing(eid)
  }
}
