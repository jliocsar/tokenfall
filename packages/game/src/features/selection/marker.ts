import { Graphics } from 'pixi.js'
import { screenX, screenY } from '../../core/iso.ts'
import type { Sim } from '../../core/sim.ts'
import type { HeroLayer } from '../../render/heroes.ts'

export type SelectionMarker = { readonly ring: Graphics }

const RING_WIDTH = 46
const RING_HEIGHT = 20
const RING_COLOR = 0xe8_b8_4a

export const createSelectionMarker = (): SelectionMarker => {
  const ring = new Graphics()
  ring.ellipse(0, 0, RING_WIDTH, RING_HEIGHT).stroke({ width: 4, color: RING_COLOR })
  ring.visible = false

  return { ring }
}

export const syncSelectionMarker = (marker: SelectionMarker, sim: Sim, eid: number): void => {
  if (eid < 0) {
    marker.ring.visible = false

    return
  }

  const { x, y } = sim.stores.position
  marker.ring.visible = true
  marker.ring.position.set(screenX(x[eid]!, y[eid]!), screenY(x[eid]!, y[eid]!))
}

export const pickHero = (
  sim: Sim,
  layer: HeroLayer,
  worldX: number,
  worldY: number,
  reach: number,
): number => {
  const { x, y } = sim.stores.position
  let best = -1
  let bestDistance = reach

  for (let i = 0; i < layer.count; i++) {
    const eid = layer.order[i]!

    if (layer.hidden[sim.stores.behavior.state[eid]!] === 1) {
      continue
    }

    const dx = screenX(x[eid]!, y[eid]!) - worldX
    const dy = screenY(x[eid]!, y[eid]!) - 40 - worldY
    const distance = Math.hypot(dx, dy)

    if (distance < bestDistance) {
      best = eid
      bestDistance = distance
    }
  }

  return best
}
