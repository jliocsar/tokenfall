import { screenX, screenY } from '../../core/iso.ts'
import { NO_GRAVE } from '../../core/graves.ts'
import type { Sim } from '../../core/sim.ts'

const GRAVE_LIFT = 18

export const graveAt = (sim: Sim, worldX: number, worldY: number, reach: number): number => {
  const { occupant } = sim.graves
  const { x, y } = sim.stores.position
  let best = NO_GRAVE
  let bestDistance = reach

  for (let slot = 0; slot < occupant.length; slot++) {
    const eid = occupant[slot]!

    if (eid === NO_GRAVE) {
      continue
    }

    const distance = Math.hypot(
      screenX(x[eid]!, y[eid]!) - worldX,
      screenY(x[eid]!, y[eid]!) - GRAVE_LIFT - worldY,
    )

    if (distance < bestDistance) {
      best = eid
      bestDistance = distance
    }
  }

  return best
}
