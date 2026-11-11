import world from '@tokenfall/data/world.json'

export const STACK_MENU = 0
export const STACK_RAVEN = 1
export const STACK_BUBBLE = 2

const { stack } = world

export const createStackOut = (): Float64Array => new Float64Array(3)

export const headBase = (zoom: number): number => stack.head * zoom

export const entranceBase = (zoom: number): number =>
  world.entrance.offsetY * zoom + world.bubbles.aboveBadge

export const stackAbove = (
  base: number,
  zoom: number,
  menu: boolean,
  raven: boolean,
  out: Float64Array,
): void => {
  const afterMenu = menu ? base + stack.gap + stack.menu : base
  const ravenSlot = stack.raven * zoom
  out[STACK_MENU] = base + stack.gap
  out[STACK_RAVEN] = afterMenu + stack.gap + ravenSlot / 2
  out[STACK_BUBBLE] = (raven ? afterMenu + stack.gap + ravenSlot : afterMenu) + stack.gap
}
