import { entityExists } from 'bitecs'
import { scheduleWander, moveTo, sendInput } from '../behavior.ts'
import { hasMember } from '../dense-set.ts'
import { jitter } from '../layout.ts'
import { TIMER_EFFECT_END, TIMER_STATE, TIMER_WANDER, type Sim } from '../sim.ts'
import type { System } from '../system.ts'
import { peekDeadline, popInto } from '../timers.ts'
import { endEffect } from '../../effects/emitters.ts'

const wander = (sim: Sim, eid: number, now: number): void => {
  const { behavior, anchor } = sim.stores

  if (sim.wanders[behavior.state[eid]!] !== 1 || hasMember(sim.moving, eid)) {
    return
  }

  sim.scratch[0] = anchor.x[eid]!
  sim.scratch[1] = anchor.y[eid]!
  jitter(sim, sim.config.tuning.wanderRadius, sim.scratch)
  moveTo(sim, eid, sim.scratch[0], sim.scratch[1])
  scheduleWander(sim, eid, now)
}

const fire = (sim: Sim, eid: number, serial: number, kind: number, now: number): void => {
  if (!entityExists(sim.world, eid)) {
    return
  }

  if (kind === TIMER_EFFECT_END) {
    if (sim.stores.emitter.serial[eid] === serial) {
      endEffect(sim, eid)
    }

    return
  }

  if (sim.stores.behavior.serial[eid] !== serial) {
    return
  }

  if (kind === TIMER_STATE) {
    sendInput(sim, eid, sim.inputs['timer']!, now)
  } else if (kind === TIMER_WANDER) {
    wander(sim, eid, now)
  }
}

export const timerSystem: System = {
  name: 'timers',
  complexity: 'O(expired timers * log(scheduled timers))',
  run: (sim, now) => {
    const out = sim.scratch

    while (peekDeadline(sim.timers) <= now) {
      popInto(sim.timers, out)
      fire(sim, out[0]!, out[1]!, out[2]!, now)
    }
  },
}
