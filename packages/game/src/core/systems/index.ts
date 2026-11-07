import { commitRemovals } from 'bitecs'
import { effectFollowSystem, levelUpBurstSystem } from '../../effects/systems.ts'
import type { System } from '../system.ts'
import { drainSystem } from './drain.ts'
import { movementSystem } from './movement.ts'
import { timerSystem } from './timers.ts'

const commitSystem: System = {
  name: 'commit-removals',
  complexity: 'O(entities removed since last frame)',
  run: (sim) => {
    commitRemovals(sim.world)
  },
}

export const SIM_SYSTEMS: readonly System[] = [
  drainSystem,
  commitSystem,
  timerSystem,
  movementSystem,
  levelUpBurstSystem,
  effectFollowSystem,
]
