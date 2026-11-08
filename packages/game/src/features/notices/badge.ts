import { BitmapText, Container, Graphics } from 'pixi.js'
import tuning from '@tokenfall/data/ravens.json'
import world from '@tokenfall/data/world.json'
import { screenX, screenY } from '../../core/iso.ts'
import type { Screen } from '../../render/camera.ts'
import type { Spot } from './model.ts'

export type BoardBadge = {
  readonly container: Container
  readonly back: Graphics
  readonly text: BitmapText
  shown: number
}

const { board: text, flock } = tuning

const PADDING_X = 8
const HEIGHT = 24
const STYLE = { fontFamily: world.fonts.pixel, fontSize: world.fonts.pixelSize, fill: '#eadfc4' }
const RAVEN = 0xd8_4a_3a

export const createBoardBadge = (): BoardBadge => {
  const container = new Container({ label: 'notice-board', isRenderGroup: true })
  const back = new Graphics()
  const label = new BitmapText({ text: '', style: STYLE })
  label.anchor.set(0.5, 0.5)
  label.position.y = -HEIGHT / 2
  container.addChild(back, label)
  container.alpha = 0

  return { container, back, text: label, shown: -1 }
}

const paint = (badge: BoardBadge, count: number): void => {
  badge.shown = count
  badge.text.text = text.badge.replace('{count}', String(count))
  const width = Math.ceil(badge.text.width) + PADDING_X * 2
  badge.back
    .clear()
    .roundRect(-width / 2, -HEIGHT, width, HEIGHT, 4)
    .fill({ color: 0x10_0d_16, alpha: 0.9 })
    .stroke({ width: 1, color: RAVEN })
}

export const syncBoardBadge = (
  badge: BoardBadge,
  spot: Spot,
  count: number,
  screen: Screen,
): void => {
  if (!spot.placed || count === 0) {
    badge.container.alpha = 0

    return
  }

  if (badge.shown !== count) {
    paint(badge, count)
  }

  const sx = (screenX(spot.x, spot.y) - screen.x) * screen.zoom + screen.width / 2
  const sy =
    (screenY(spot.x, spot.y) - screen.y) * screen.zoom +
    screen.height / 2 -
    text.offsetY * screen.zoom
  badge.container.position.set(Math.round(sx), Math.round(sy))
  badge.container.alpha = 1
}

export const boardAt = (spot: Spot, worldX: number, worldY: number, reach: number): boolean => {
  if (!spot.placed) {
    return false
  }

  const x = screenX(spot.x, spot.y)
  const y = screenY(spot.x, spot.y)

  return Math.abs(worldX - x) < reach && worldY < y + reach / 2 && worldY > y - text.height - reach
}

export const ravenReach = (zoom: number): number => tuning.reach / Math.min(1, zoom) + flock.radius
