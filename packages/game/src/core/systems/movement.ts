import { scheduleWander, sendInput } from '../behavior.ts'
import { removeMember } from '../dense-set.ts'
import { directionOf } from '../iso.ts'
import type { Sim } from '../sim.ts'
import type { System } from '../system.ts'

const arrive = (sim: Sim, eid: number, now: number): void => {
  removeMember(sim.moving, eid)

  if (
    !sendInput(sim, eid, sim.inputs['arrived']!, now) &&
    sim.wanders[sim.stores.behavior.state[eid]!] === 1
  ) {
    scheduleWander(sim, eid, now)
  }
}

export const movementSystem: System = {
  name: 'movement',
  complexity: 'O(moving heroes)',
  run: (sim, now, dt) => {
    const { position, motion } = sim.stores
    const { dense } = sim.moving

    for (let i = sim.moving.size - 1; i >= 0; i--) {
      const eid = dense[i]!
      const dx = motion.tx[eid]! - position.x[eid]!
      const dy = motion.ty[eid]! - position.y[eid]!
      const distance = Math.hypot(dx, dy)
      const step = (motion.speed[eid]! * dt) / 1000

      if (distance <= step) {
        position.x[eid] = motion.tx[eid]!
        position.y[eid] = motion.ty[eid]!
        arrive(sim, eid, now)
      } else {
        position.x[eid] = position.x[eid]! + (dx / distance) * step
        position.y[eid] = position.y[eid]! + (dy / distance) * step
        motion.dir[eid] = directionOf(dx, dy)
      }
    }
  },
}
