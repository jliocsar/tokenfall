import world from '@tokenfall/data/world.json'

const HALF_WIDTH = world.tileWidth / 2
const HALF_HEIGHT = world.tileHeight / 2

export const screenX = (x: number, y: number): number => (x - y) * HALF_WIDTH

export const screenY = (x: number, y: number): number => (x + y) * HALF_HEIGHT

export const directionOf = (dx: number, dy: number): number => {
  const sx = (dx - dy) * HALF_WIDTH
  const sy = (dx + dy) * HALF_HEIGHT
  const octant = Math.round(Math.atan2(sy, sx) / (Math.PI / 4))

  return (octant + 8) % 8
}
