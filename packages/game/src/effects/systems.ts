import wisps from '@tokenfall/data/effects/minion-wisps.json'
import dart from '@tokenfall/data/effects/wisp-dart.json'
import { addMember, removeMember } from '../core/dense-set.ts'
import { stateId } from '../core/fsm.ts'
import { NO_AURA } from '../core/sim.ts'
import type { System } from '../core/system.ts'
import { EMITTER_STRIDE, endEffect, followTargets, spawnEffect } from './emitters.ts'

export const LEVEL_UP_KIND = 0
export const AURA_KIND = 1
export const WARP_PORTAL_KIND = 2
export const WARP_FLARE_KIND = 3
export const MINION_KIND = 4
export const NECRO_KIND = 5
export const DUST_KIND = 6
export const BOLT_KIND = 7
export const SLASH_KIND = 8
export const CRIT_KIND = 9
export const FRENZY_KIND = 10
export const HEAL_KIND = 11
export const DART_KIND = 12
export const SKULL_BOLT_KIND = 13
export const MAX_WISPS = wisps.particles / wisps.params.trail
export const DART_REACH_MS = dart.lifetime * 500

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

export const minionSystem: System = {
  name: 'minion-wisps',
  complexity: 'O(heroes whose minions or life changed this frame)',
  run: (sim, now) => {
    const { minionCheck, wispsOf, swarmed } = sim
    const dying = stateId(sim.machine, 'dying')
    const dead = stateId(sim.machine, 'dead')

    while (minionCheck.size > 0) {
      const eid = minionCheck.dense[minionCheck.size - 1]!
      removeMember(minionCheck, eid)
      const state = sim.stores.behavior.state[eid]!
      const minions = state === dying || state === dead ? 0 : sim.stores.hero.minions[eid]!
      const current = wispsOf[eid]!

      if (minions > MAX_WISPS) {
        addMember(swarmed, eid)
      } else {
        removeMember(swarmed, eid)
      }

      if (minions === 0) {
        if (current !== NO_AURA) {
          endEffect(sim, current)
          wispsOf[eid] = NO_AURA
        }

        continue
      }

      const effect = current === NO_AURA ? spawnEffect(sim, MINION_KIND, eid, now) : current
      wispsOf[eid] = effect

      if (effect !== NO_AURA) {
        const kind = sim.effects[MINION_KIND]!
        kind.data[sim.stores.emitter.slot[effect]! * EMITTER_STRIDE + 4] = minions
        kind.dirty = true
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
