import { commitRemovals } from 'bitecs'
import {
  auraSystem,
  effectFollowSystem,
  levelUpBurstSystem,
  minionSystem,
} from '../../effects/systems.ts'
import type { System } from '../system.ts'
import { delveSystem } from './delve.ts'
import { drainSystem } from './drain.ts'
import { movementSystem } from './movement.ts'
import { graveSystem, hordeSystem, releaseSystem } from './release.ts'
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
  delveSystem,
  movementSystem,
  levelUpBurstSystem,
  auraSystem,
  minionSystem,
  hordeSystem,
  graveSystem,
  releaseSystem,
  effectFollowSystem,
]
