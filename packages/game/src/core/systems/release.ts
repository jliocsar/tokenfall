import { removeEntity } from 'bitecs'
import { addMember, clearSet, removeMember, type DenseSet } from '../dense-set.ts'
import { freeGrave, expireGraves } from '../graves.ts'
import { heroOfEntity, unbindHero } from '../hero-index.ts'
import { dismissHorde } from '../horde.ts'
import { leaveGroups } from '../membership.ts'
import type { Sim } from '../sim.ts'
import type { System } from '../system.ts'

const memberships = (sim: Sim): readonly DenseSet[] => [
  sim.moving,
  sim.levelUps,
  sim.auraCheck,
  sim.minionCheck,
  sim.swarmed,
  sim.crowned,
  sim.changed,
  sim.statusChanged,
  sim.toolChanged,
  sim.toolSteps,
  sim.tierCheck,
  sim.waiting,
]

const release = (sim: Sim, sets: readonly DenseSet[], eid: number): void => {
  unbindHero(sim.index, heroOfEntity(sim.index, eid))
  leaveGroups(sim, eid)
  freeGrave(sim, eid)

  for (const set of sets) {
    removeMember(set, eid)
  }

  sim.stores.behavior.serial[eid] = sim.stores.behavior.serial[eid]! + 1
  removeEntity(sim.world, eid)
  addMember(sim.forgotten, eid)
}

export const hordeSystem: System = {
  name: 'horde',
  complexity: 'O(budgets.horde) while any skeleton is out, else O(1)',
  run: (sim, now) => {
    dismissHorde(sim, now)
  },
}

export const graveSystem: System = {
  name: 'graves',
  complexity: 'O(1) per frame, O(graves) when one crumbles',
  run: (sim, now) => {
    expireGraves(sim, now)
  },
}

export const releaseSystem: System = {
  name: 'release',
  complexity: 'O(heroes released this frame)',
  run: (sim) => {
    if (sim.releasing.size === 0) {
      return
    }

    const sets = memberships(sim)

    for (let i = 0; i < sim.releasing.size; i++) {
      release(sim, sets, sim.releasing.dense[i]!)
    }

    clearSet(sim.releasing)
  },
}
