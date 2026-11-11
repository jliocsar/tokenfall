import { describe, expect, test } from 'bun:test'
import { Container } from 'pixi.js'
import { createRoot } from 'solid-js'
import { hideMenu, placeMenu, createMenu } from '../src/features/selection/menu.ts'
import { updateCamera, type Camera } from '../src/render/camera.ts'

const fakeElement = () => {
  const writes = { transform: 0, visibility: 0 }
  const values = { transform: '', visibility: '' }
  const style = {
    get transform() {
      return values.transform
    },
    set transform(value: string) {
      values.transform = value
      writes.transform += 1
    },
    get visibility() {
      return values.visibility
    },
    set visibility(value: string) {
      values.visibility = value
      writes.visibility += 1
    },
  }

  return { writes, style }
}

describe('hero menu', () => {
  test('writes the DOM only when the spot or visibility changes', () => {
    createRoot((dispose) => {
      const menu = createMenu()
      const element = fakeElement()
      menu.element = element
      placeMenu(menu, 100.2, 50.4, false)
      placeMenu(menu, 100.4, 50.1, false)

      expect(element.writes).toEqual({ transform: 1, visibility: 1 })

      hideMenu(menu)
      hideMenu(menu)
      placeMenu(menu, 120, 50, true)

      expect(element.writes).toEqual({ transform: 2, visibility: 3 })
      expect(menu.delving()).toBe(true)

      dispose()
    })
  })
})

describe('follow', () => {
  test('panning with the keys stops following', () => {
    const camera: Camera = { x: 0, y: 0, zoom: 1, keys: new Set(['d']), follow: 4 }
    const view = { left: 0, top: 0, right: 0, bottom: 0 }
    updateCamera(camera, new Container(), 800, 600, 16, view)

    expect(camera.follow).toBeUndefined()
  })

  test('a still camera keeps following', () => {
    const camera: Camera = { x: 0, y: 0, zoom: 1, keys: new Set(), follow: 4 }
    const view = { left: 0, top: 0, right: 0, bottom: 0 }
    updateCamera(camera, new Container(), 800, 600, 16, view)

    expect(camera.follow).toBe(4)
  })
})
