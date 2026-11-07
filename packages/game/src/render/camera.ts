import type { Container } from 'pixi.js'
import type { View } from './heroes.ts'

export type Camera = {
  x: number
  y: number
  zoom: number
  readonly keys: Set<string>
  targetX?: number | undefined
  targetY?: number | undefined
  onClick?: ((pointerX: number, pointerY: number) => void) | undefined
}

const MIN_ZOOM = 0.08
const MAX_ZOOM = 3
const PAN_SPEED = 900
const ZOOM_STEP = 1.1
const GLIDE_MS = 140
const CLICK_SLOP = 4

export const KEYBINDS = {
  panUp: ['w', 'ArrowUp'],
  panDown: ['s', 'ArrowDown'],
  panLeft: ['a', 'ArrowLeft'],
  panRight: ['d', 'ArrowRight'],
  zoomIn: ['=', '+'],
  zoomOut: ['-', '_'],
  attention: ['q', 'Q'],
  layout: ['l', 'L'],
  fit: ['f', 'F'],
} as const

const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

const matches = (keys: readonly string[], key: string): boolean => keys.includes(key)

const pressed = (camera: Camera, keys: readonly string[]): number =>
  keys.some((key) => camera.keys.has(key)) ? 1 : 0

export const attachCamera = (canvas: HTMLCanvasElement, camera: Camera): void => {
  const drag = { active: false, x: 0, y: 0, travel: 0 }
  canvas.addEventListener('pointerdown', (event) => {
    drag.active = true
    drag.x = event.clientX
    drag.y = event.clientY
    drag.travel = 0
  })
  window.addEventListener('pointerup', (event) => {
    if (drag.active && drag.travel <= CLICK_SLOP && event.target === canvas) {
      camera.onClick?.(event.clientX, event.clientY)
    }

    drag.active = false
  })
  window.addEventListener('pointermove', (event) => {
    if (!drag.active) {
      return
    }

    drag.travel += Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y)

    if (drag.travel > CLICK_SLOP) {
      camera.targetX = undefined
      camera.targetY = undefined
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
  const panX = pressed(camera, KEYBINDS.panRight) - pressed(camera, KEYBINDS.panLeft)
  const panY = pressed(camera, KEYBINDS.panDown) - pressed(camera, KEYBINDS.panUp)

  if (panX !== 0 || panY !== 0) {
    camera.targetX = undefined
    camera.targetY = undefined
  }

  if (camera.targetX !== undefined && camera.targetY !== undefined) {
    const blend = 1 - Math.exp(-dt / GLIDE_MS)
    camera.x += (camera.targetX - camera.x) * blend
    camera.y += (camera.targetY - camera.y) * blend
  }

  camera.x += panX * step
  camera.y += panY * step
  stage.scale.set(camera.zoom)
  stage.position.set(width / 2 - camera.x * camera.zoom, height / 2 - camera.y * camera.zoom)
  view.left = camera.x - width / 2 / camera.zoom
  view.right = camera.x + width / 2 / camera.zoom
  view.top = camera.y - height / 2 / camera.zoom
  view.bottom = camera.y + height / 2 / camera.zoom
}

export const glideTo = (camera: Camera, x: number, y: number): void => {
  camera.targetX = x
  camera.targetY = y
}

export const fitCamera = (camera: Camera, bounds: View, width: number, height: number): void => {
  camera.targetX = undefined
  camera.targetY = undefined
  camera.x = (bounds.left + bounds.right) / 2
  camera.y = (bounds.top + bounds.bottom) / 2
  camera.zoom = clampZoom(
    Math.min(width / (bounds.right - bounds.left), height / (bounds.bottom - bounds.top)) * 0.95,
  )
}
