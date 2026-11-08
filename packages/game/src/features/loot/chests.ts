import { Particle, ParticleContainer, type Texture } from 'pixi.js'
import tuning from '@tokenfall/data/ravens.json'
import {
  addMember,
  createDenseSet,
  hasMember,
  removeMember,
  type DenseSet,
} from '../../core/dense-set.ts'
import { stateId } from '../../core/fsm.ts'
import { screenX, screenY } from '../../core/iso.ts'
import type { Sim } from '../../core/sim.ts'
import type { HeroLayer } from '../../render/heroes.ts'

export type Chests = {
  readonly container: ParticleContainer
  readonly particles: Particle[]
  readonly closed: Texture
  readonly open: Texture
  readonly members: DenseSet
  readonly looting: number
  readonly opening: number
  used: number
}

const { chests: tune } = tuning

export const createChests = (sim: Sim, layer: HeroLayer): Chests | undefined => {
  const closed = layer.propTextures.get('chest')
  const open = layer.propTextures.get('chest_open')

  if (closed === undefined || open === undefined) {
    return undefined
  }

  const container = new ParticleContainer({
    dynamicProperties: { position: true, vertex: true, uvs: true, color: true, rotation: false },
    texture: closed,
  })
  const particles = Array.from({ length: sim.config.budgets.chests }, () => {
    const particle = new Particle({
      texture: closed,
      anchorX: closed.defaultAnchor?.x ?? 0.5,
      anchorY: closed.defaultAnchor?.y ?? 0.5,
      scaleX: tune.scale,
      scaleY: tune.scale,
      alpha: 0,
    })
    container.addParticle(particle)

    return particle
  })

  return {
    container,
    particles,
    closed,
    open,
    members: createDenseSet(sim.config.budgets.entities),
    looting: stateId(sim.machine, 'looting'),
    opening: stateId(sim.machine, 'opening'),
    used: 0,
  }
}

const track = (chests: Chests, sim: Sim): void => {
  const { transitions } = sim

  for (let i = 0; i < transitions.count; i++) {
    const eid = transitions.eid[i]!
    const to = transitions.to[i]!

    if (to === chests.looting || to === chests.opening) {
      addMember(chests.members, eid)
    } else if (hasMember(chests.members, eid)) {
      removeMember(chests.members, eid)
    }
  }
}

export const syncChests = (chests: Chests, sim: Sim, now: number): void => {
  track(chests, sim)
  const { anchor, behavior } = sim.stores
  const { members } = chests
  const previous = chests.used
  chests.used = Math.min(members.size, chests.particles.length)

  for (let i = 0; i < chests.used; i++) {
    const eid = members.dense[i]!
    const particle = chests.particles[i]!
    const opening = behavior.state[eid] === chests.opening
    const x = anchor.x[eid]!
    const y = anchor.y[eid]!
    particle.texture = opening ? chests.open : chests.closed
    particle.alpha = opening ? Math.max(0, 1 - (now - behavior.since[eid]!) / tune.openMs) : 1
    particle.x = screenX(x, y) + tune.offsetX
    particle.y = screenY(x, y) + tune.offsetY
  }

  for (let i = chests.used; i < previous; i++) {
    chests.particles[i]!.alpha = 0
  }
}
