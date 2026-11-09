import { clearSet, removeMember } from '../dense-set.ts'
import { checkTier, toolStep } from '../delve.ts'
import type { System } from '../system.ts'

export const delveSystem: System = {
  name: 'delve',
  complexity: 'O(heroes with a tool use or a level up this frame)',
  run: (sim) => {
    const { toolSteps, tierCheck } = sim

    for (let i = 0; i < toolSteps.size; i++) {
      toolStep(sim, toolSteps.dense[i]!)
    }

    clearSet(toolSteps)

    while (tierCheck.size > 0) {
      const eid = tierCheck.dense[tierCheck.size - 1]!
      removeMember(tierCheck, eid)
      checkTier(sim, eid)
    }
  },
}
