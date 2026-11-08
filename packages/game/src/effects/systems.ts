import { removeMember } from '../core/dense-set.ts'
import { stateId } from '../core/fsm.ts'
import { NO_AURA } from '../core/sim.ts'
import type { System } from '../core/system.ts'
import { endEffect, followTargets, spawnEffect } from './emitters.ts'

export const LEVEL_UP_KIND = 0
export const AURA_KIND = 1

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

export const auraSystem: System = {
  name: 'aura',
  complexity: 'O(heroes whose level or life changed this frame)',
  run: (sim, now) => {
    const { auraCheck, auraOf } = sim
    const dying = stateId(sim.machine, 'dying')
    const dead = stateId(sim.machine, 'dead')
    const top = sim.config.curve.maxLevel

    while (auraCheck.size > 0) {
      const eid = auraCheck.dense[auraCheck.size - 1]!
      removeMember(auraCheck, eid)
      const state = sim.stores.behavior.state[eid]!
      const wants = sim.stores.hero.level[eid]! >= top && state !== dying && state !== dead
      const current = auraOf[eid]!

      if (wants && current === NO_AURA) {
        auraOf[eid] = spawnEffect(sim, AURA_KIND, eid, now)
      } else if (!wants && current !== NO_AURA) {
        endEffect(sim, current)
        auraOf[eid] = NO_AURA
      }
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
