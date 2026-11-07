import type { Container } from 'pixi.js'
import type { View } from './heroes.ts'

export type Camera = {
  x: number
  y: number
  zoom: number
  readonly keys: Set<string>
}

const MIN_ZOOM = 0.08
const MAX_ZOOM = 3
const PAN_SPEED = 900
const ZOOM_STEP = 1.1

export const KEYBINDS = {
  panUp: ['w', 'ArrowUp'],
  panDown: ['s', 'ArrowDown'],
  panLeft: ['a', 'ArrowLeft'],
  panRight: ['d', 'ArrowRight'],
  zoomIn: ['=', '+'],
  zoomOut: ['-', '_'],
} as const

const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

const matches = (keys: readonly string[], key: string): boolean => keys.includes(key)

const pressed = (camera: Camera, keys: readonly string[]): number =>
  keys.some((key) => camera.keys.has(key)) ? 1 : 0

export const attachCamera = (canvas: HTMLCanvasElement, camera: Camera): void => {
  const drag = { active: false, x: 0, y: 0 }
  canvas.addEventListener('pointerdown', (event) => {
    drag.active = true
    drag.x = event.clientX
    drag.y = event.clientY
  })
  window.addEventListener('pointerup', () => {
    drag.active = false
  })
  window.addEventListener('pointermove', (event) => {
    if (!drag.active) {
      return
    }

    camera.x -= (event.clientX - drag.x) / camera.zoom
    camera.y -= (event.clientY - drag.y) / camera.zoom
    drag.x = event.clientX
    drag.y = event.clientY
  })
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      camera.zoom = clampZoom(camera.zoom * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP))
    },
    { passive: false },
  )
  window.addEventListener('keydown', (event) => {
    camera.keys.add(event.key)

    if (matches(KEYBINDS.zoomIn, event.key)) {
      camera.zoom = clampZoom(camera.zoom * ZOOM_STEP)
    }

    if (matches(KEYBINDS.zoomOut, event.key)) {
      camera.zoom = clampZoom(camera.zoom / ZOOM_STEP)
    }
  })
  window.addEventListener('keyup', (event) => {
    camera.keys.delete(event.key)
  })
}

export const updateCamera = (
  camera: Camera,
  stage: Container,
  width: number,
  height: number,
  dt: number,
  view: View,
): void => {
  const step = (PAN_SPEED * dt) / 1000 / camera.zoom
  camera.x += (pressed(camera, KEYBINDS.panRight) - pressed(camera, KEYBINDS.panLeft)) * step
  camera.y += (pressed(camera, KEYBINDS.panDown) - pressed(camera, KEYBINDS.panUp)) * step
  stage.scale.set(camera.zoom)
  stage.position.set(width / 2 - camera.x * camera.zoom, height / 2 - camera.y * camera.zoom)
  view.left = camera.x - width / 2 / camera.zoom
  view.right = camera.x + width / 2 / camera.zoom
  view.top = camera.y - height / 2 / camera.zoom
  view.bottom = camera.y + height / 2 / camera.zoom
}

export const fitCamera = (camera: Camera, bounds: View, width: number, height: number): void => {
  camera.x = (bounds.left + bounds.right) / 2
  camera.y = (bounds.top + bounds.bottom) / 2
  camera.zoom = clampZoom(
    Math.min(width / (bounds.right - bounds.left), height / (bounds.bottom - bounds.top)) * 0.95,
  )
}
