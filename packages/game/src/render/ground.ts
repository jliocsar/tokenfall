import { Graphics } from 'pixi.js'
import { screenX, screenY } from '../core/iso.ts'

export const drawGround = (minX: number, maxX: number, minY: number, maxY: number): Graphics => {
  const ground = new Graphics()

  for (let x = minX; x <= maxX; x += 1) {
    ground.moveTo(screenX(x, minY), screenY(x, minY)).lineTo(screenX(x, maxY), screenY(x, maxY))
  }

  for (let y = minY; y <= maxY; y += 1) {
    ground.moveTo(screenX(minX, y), screenY(minX, y)).lineTo(screenX(maxX, y), screenY(maxX, y))
  }

  ground.stroke({ width: 1, color: 0x2a_22_36, alpha: 0.8 })

  return ground
}
