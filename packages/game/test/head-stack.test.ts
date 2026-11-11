import { describe, expect, test } from 'bun:test'
import world from '@tokenfall/data/world.json'
import { routeKey, closesSheet } from '../src/features/selection/keys.ts'
import {
  createStackOut,
  headBase,
  STACK_BUBBLE,
  STACK_MENU,
  STACK_RAVEN,
  stackAbove,
} from '../src/features/selection/stack.ts'
import { noteZoom, readZoom } from '../src/features/town/zoom.ts'

const press = (key: string, ctrlKey: boolean) => ({ key, ctrlKey, metaKey: false, altKey: false })

const memory = () => {
  const values = new Map<string, string>()

  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe('head stack', () => {
  test('menu, raven, bubble from the head up, with even gaps at every zoom', () => {
    const out = createStackOut()
    const { gap, menu, raven } = world.stack

    for (const zoom of [0.2, 1, 2.5]) {
      stackAbove(headBase(zoom), zoom, true, true, out)
      const menuTop = out[STACK_MENU]! + menu
      const ravenBottom = out[STACK_RAVEN]! - (raven * zoom) / 2
      const ravenTop = out[STACK_RAVEN]! + (raven * zoom) / 2

      expect(out[STACK_MENU]! - headBase(zoom)).toBeCloseTo(gap)
      expect(ravenBottom - menuTop).toBeCloseTo(gap)
      expect(out[STACK_BUBBLE]! - ravenTop).toBeCloseTo(gap)
    }
  })

  test('without a menu or a raven the rest close up', () => {
    const out = createStackOut()
    stackAbove(100, 1, false, false, out)

    expect(out[STACK_BUBBLE]).toBe(100 + world.stack.gap)

    stackAbove(100, 1, false, true, out)

    expect(out[STACK_RAVEN]! - world.stack.raven / 2).toBeCloseTo(100 + world.stack.gap)
  })
})

describe('hero keys', () => {
  test('F follows a selected Hero and fits with nobody selected', () => {
    expect(routeKey(press('f', false), 3)).toBe('follow')
    expect(routeKey(press('F', false), -1)).toBe('fit')
    expect(routeKey(press('f', true), 3)).toBe('none')
  })

  test('C and Enter open the sheet of the selected Hero; C closes it', () => {
    expect(routeKey(press('c', false), 3)).toBe('sheet')
    expect(routeKey(press('Enter', false), 3)).toBe('sheet')
    expect(routeKey(press('c', false), -1)).toBe('none')
    expect(routeKey(press('c', true), 3)).toBe('none')
    expect(closesSheet(press('C', false))).toBe(true)
    expect(closesSheet(press('c', true))).toBe(false)
  })
})

describe('zoom memory', () => {
  test('Town and Dungeon zooms survive a reload, and a broken save is ignored', () => {
    const storage = memory()
    const first = readZoom(storage)
    noteZoom(first, false, 0.5, 0)
    noteZoom(first, true, 1.4, 1)
    noteZoom(first, true, 1.4, 10_000)
    const second = readZoom(storage)

    expect(second.town).toBe(0.5)
    expect(second.dungeon).toBe(1.4)

    storage.setItem('tokenfall.zoom', '{oops')

    expect(readZoom(storage).town).toBeUndefined()
  })

  test('saves are throttled', () => {
    const storage = memory()
    const zoom = readZoom(storage)
    noteZoom(zoom, false, 0.5, 0)
    noteZoom(zoom, false, 0.6, 1)

    expect(readZoom(storage).town).toBe(0.5)

    noteZoom(zoom, false, 0.6, world.zoom.saveEveryMs)

    expect(readZoom(storage).town).toBe(0.6)
  })
})
