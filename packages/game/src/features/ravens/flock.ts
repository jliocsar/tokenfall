import { Particle, ParticleContainer, type Texture } from 'pixi.js'
import tuning from '@tokenfall/data/ravens.json'
import { screenX, screenY } from '../../core/iso.ts'
import { NO_PLOT } from '../../core/layout.ts'
import type { Sim } from '../../core/sim.ts'
import type { HeroLayer } from '../../render/heroes.ts'

export type Flock = {
  readonly container: ParticleContainer
  readonly particles: Particle[]
  readonly frames: Texture[]
  readonly stamp: Uint32Array
  readonly owner: Int32Array
  frame: number
  used: number
}

const { flock: bird } = tuning

const OCTANT = Math.PI / 4
const GOLDEN = 2.399_963
const NO_OWNER = -1

const octant = (dx: number, dy: number): number =>
  (Math.round(Math.atan2(dy, dx) / OCTANT) + bird.directions) % bird.directions

export const createFlock = (sim: Sim, layer: HeroLayer): Flock | undefined => {
  const frames: Texture[] = []

  for (let direction = 0; direction < bird.directions; direction++) {
    for (let frame = 0; frame < bird.frames; frame++) {
      const texture = layer.propTextures.get(`raven_${direction}_${frame}`)

      if (texture === undefined) {
        return undefined
      }

      frames.push(texture)
    }
  }

  const container = new ParticleContainer({
    dynamicProperties: { position: true, vertex: false, uvs: true, color: true, rotation: false },
    texture: frames[0]!,
  })
  const particles = Array.from({ length: sim.config.budgets.ravens }, () => {
    const particle = new Particle({
      texture: frames[0]!,
      anchorX: frames[0]!.defaultAnchor?.x ?? 0.5,
      anchorY: frames[0]!.defaultAnchor?.y ?? 0.5,
      scaleX: bird.scale,
      scaleY: bird.scale,
      alpha: 0,
    })
    container.addParticle(particle)

    return particle
  })

  return {
    container,
    particles,
    frames,
    stamp: new Uint32Array(sim.config.budgets.guilds),
    owner: new Int32Array(sim.config.budgets.ravens).fill(NO_OWNER),
    frame: 0,
    used: 0,
  }
}

const place = (
  flock: Flock,
  index: number,
  eid: number,
  x: number,
  y: number,
  now: number,
): void => {
  const phase = eid * GOLDEN
  const angle = phase + (now / 1000) * bird.speed
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const direction = octant(-sin, cos * 0.5)
  const frame = Math.floor((now / 1000) * bird.flapFps + phase) % bird.frames
  const particle = flock.particles[index]!
  particle.texture = flock.frames[direction * bird.frames + frame]!
  particle.x = x + cos * bird.radius
  particle.y = y + sin * bird.radius * 0.5
  particle.alpha = 1
}

export const syncFlock = (flock: Flock, sim: Sim, layer: HeroLayer, now: number): void => {
  const { waiting, town } = sim
  const { position, behavior, hero } = sim.stores
  const previous = flock.used
  flock.frame += 1
  flock.used = 0

  for (let i = 0; i < waiting.size && flock.used < flock.particles.length; i++) {
    const eid = waiting.dense[i]!

    if (layer.hidden[behavior.state[eid]!] !== 1) {
      const x = position.x[eid]!
      const y = position.y[eid]!
      place(flock, flock.used, eid, screenX(x, y), screenY(x, y) - bird.height, now)
      flock.owner[flock.used] = eid
      flock.used += 1
      continue
    }

    const guild = hero.guild[eid]!
    const plot = town.plotOfGuild[guild]!

    if (plot === NO_PLOT || flock.stamp[guild] === flock.frame) {
      continue
    }

    flock.stamp[guild] = flock.frame
    const ex = town.entranceX[plot]!
    const ey = town.entranceY[plot]!
    place(flock, flock.used, guild, screenX(ex, ey), screenY(ex, ey) - bird.entranceLift, now)
    flock.owner[flock.used] = NO_OWNER
    flock.used += 1
  }

  for (let i = flock.used; i < previous; i++) {
    flock.particles[i]!.alpha = 0
  }
}

export const ravenAt = (flock: Flock, worldX: number, worldY: number, reach: number): number => {
  for (let i = 0; i < flock.used; i++) {
    const particle = flock.particles[i]!

    if (
      flock.owner[i] !== NO_OWNER &&
      Math.abs(particle.x - worldX) < reach &&
      Math.abs(particle.y - worldY) < reach
    ) {
      return flock.owner[i]!
    }
  }

  return NO_OWNER
}
