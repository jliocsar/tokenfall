import { Container, type Application } from 'pixi.js'
import type { HeroEvent } from '@tokenfall/protocol/events'
import { createSynthetic, type Synthetic } from '@tokenfall/replay/synthetic'
import { bootSim, EFFECT_DEFINITIONS } from '../core/boot.ts'
import { push } from '../core/queue.ts'
import type { Sim } from '../core/sim.ts'
import { createProfile, runSystems, type Profile } from '../core/system.ts'
import { SIM_SYSTEMS } from '../core/systems/index.ts'
import { traceBegin, traceEnd, traceId } from '../core/trace.ts'
import { spawnEffect } from '../effects/emitters.ts'
import { createEffectLayer, syncEffects, type EffectLayer } from '../effects/gpu.ts'
import { LEVEL_UP_KIND } from '../effects/systems.ts'
import { drawGround } from '../render/ground.ts'
import {
  createHeroLayer,
  syncHeroes,
  type Atlas,
  type HeroLayer,
  type View,
} from '../render/heroes.ts'
import type { TextureSource } from 'pixi.js'

export type Session = {
  readonly sim: Sim
  readonly synthetic: Synthetic
  readonly heroes: HeroLayer
  readonly effects: EffectLayer
  readonly world: Container
  readonly profile: Profile
  readonly events: HeroEvent[]
  readonly heroCount: number
  storm: number
  nextFeed: number
  visible: number
  particles: number
}

const FEED_EVERY_MS = 100
const AURA_EXPERIENCE = 4_500_000_000
const STORM_SPAWNS_PER_FRAME = 32
const TEMPO = 6
const SPAN_FEED = traceId('bench.feed')
const SPAN_STORM = traceId('bench.storm')
const SPAN_SYSTEMS = traceId('sim.systems')
const SPAN_HEROES = traceId('render.heroes')
const SPAN_EFFECTS = traceId('render.effects')

export const createSession = (
  app: Application,
  atlas: Atlas,
  source: TextureSource,
  heroCount: number,
  storm: number,
  auras: number,
): Session => {
  const now = performance.now()
  const sim = bootSim(heroCount, now, {})
  const synthetic = createSynthetic({
    seed: heroCount,
    heroes: heroCount,
    guilds: Math.max(1, Math.round(heroCount / 12)),
    workspacesPerGuild: 3,
    tempo: TEMPO,
    startAt: now,
  })

  for (const [i, hero] of synthetic.heroes.entries()) {
    const top = i < auras ? { ...hero, experience: AURA_EXPERIENCE } : hero
    push(sim.inbound, { kind: 'hero.joined', at: now, hero: top })
  }

  const heroes = createHeroLayer(sim, atlas, source)
  const effects = createEffectLayer(sim, EFFECT_DEFINITIONS)
  const world = new Container({ label: 'world' })
  world.addChild(drawGround(-90, 180, -90, 90), heroes.container, effects.container)
  app.stage.addChild(world)

  return {
    sim,
    synthetic,
    heroes,
    effects,
    world,
    profile: createProfile(SIM_SYSTEMS),
    events: [],
    heroCount,
    storm,
    nextFeed: now,
    visible: 0,
    particles: 0,
  }
}

export const destroySession = (session: Session): void => {
  session.world.removeFromParent()
  session.world.destroy({ children: true })
}

const feed = (session: Session, now: number): void => {
  if (now < session.nextFeed) {
    return
  }

  session.nextFeed = now + FEED_EVERY_MS
  session.events.length = 0
  session.synthetic.step(now, session.events)

  for (const event of session.events) {
    push(session.sim.inbound, event)
  }
}

const keepStorming = (session: Session, now: number): void => {
  const kind = session.sim.effects[LEVEL_UP_KIND]!
  const alive = session.heroes.count

  if (alive === 0) {
    return
  }

  for (let i = 0; i < STORM_SPAWNS_PER_FRAME && kind.active < session.storm; i++) {
    const eid = session.heroes.order[Math.floor(session.sim.random() * alive)]!
    spawnEffect(session.sim, LEVEL_UP_KIND, eid, now)
  }
}

export const stepSession = (
  session: Session,
  atlas: Atlas,
  view: View,
  now: number,
  dt: number,
): void => {
  traceBegin(SPAN_FEED)
  feed(session, now)
  traceEnd()

  if (session.storm > 0) {
    traceBegin(SPAN_STORM)
    keepStorming(session, now)
    traceEnd()
  }

  traceBegin(SPAN_SYSTEMS)
  runSystems(SIM_SYSTEMS, session.profile, session.sim, now, dt)
  traceEnd()
  traceBegin(SPAN_HEROES)
  session.visible = syncHeroes(session.heroes, session.sim, atlas, view, now)
  traceEnd()
  traceBegin(SPAN_EFFECTS)
  session.particles = syncEffects(session.effects, session.sim, now)
  traceEnd()
}

export const heroBounds = (session: Session, out: View): void => {
  const { x, y } = session.sim.stores.position
  out.left = Number.POSITIVE_INFINITY
  out.right = Number.NEGATIVE_INFINITY
  out.top = Number.POSITIVE_INFINITY
  out.bottom = Number.NEGATIVE_INFINITY

  for (let i = 0; i < session.heroes.count; i++) {
    const eid = session.heroes.order[i]!
    const sx = (x[eid]! - y[eid]!) * 64
    const sy = (x[eid]! + y[eid]!) * 32
    out.left = Math.min(out.left, sx - 64)
    out.right = Math.max(out.right, sx + 64)
    out.top = Math.min(out.top, sy - 110)
    out.bottom = Math.max(out.bottom, sy + 30)
  }
}
