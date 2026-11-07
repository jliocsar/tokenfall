import { removeMember } from '../core/dense-set.ts'
import type { System } from '../core/system.ts'
import { followTargets, spawnEffect } from './emitters.ts'

export const LEVEL_UP_KIND = 0

export const levelUpBurstSystem: System = {
  name: 'level-up-bursts',
  complexity: 'O(min(pending level ups, budgets.levelUpBurstsPerFrame))',
  run: (sim, now) => {
    const budget = sim.config.budgets.levelUpBurstsPerFrame
    let spawned = 0

    while (sim.levelUps.size > 0 && spawned < budget) {
      const eid = sim.levelUps.dense[sim.levelUps.size - 1]!
      removeMember(sim.levelUps, eid)

      if (spawnEffect(sim, LEVEL_UP_KIND, eid, now) === -1) {
        sim.counters.burstsSkipped += 1
      }

      spawned += 1
    }
  },
}

export const effectFollowSystem: System = {
  name: 'effect-follow',
  complexity: 'O(attached emitters alive)',
  run: (sim) => {
    followTargets(sim)
  },
}
