import { Application, Container } from 'pixi.js'
import type { HeroEvent } from '@tokenfall/protocol/events'
import { relayoutTown } from '../core/behavior.ts'
import { bootSim, EFFECT_DEFINITIONS } from '../core/boot.ts'
import { heroCount } from '../core/hero-index.ts'
import { screenX, screenY } from '../core/iso.ts'
import { TOWN_KINDS, type TownKind } from '../core/layout.ts'
import { push } from '../core/queue.ts'
import { createProfile, runSystems } from '../core/system.ts'
import { SIM_SYSTEMS } from '../core/systems/index.ts'
import { createEffectLayer, syncEffects } from '../effects/gpu.ts'
import { createTownLayer, syncTown, townBounds } from '../features/town/ground.ts'
import { attachCamera, fitCamera, updateCamera, type Camera } from '../render/camera.ts'
import { createHeroLayer, loadAtlas, syncHeroes, type View } from '../render/heroes.ts'
import { replaySource, syntheticSource, type Source } from './source.ts'

type Settings = {
  readonly heroes: number
  readonly seed: number
  readonly tempo: number
  readonly replay: string | undefined
  readonly layout: TownKind
}

const HUD_EVERY_MS = 250
const FIT_AFTER_MS = 1500
const DEFAULT_REPLAY = 'ws://127.0.0.1:47330'
const KEYS = { layout: 'l', fit: 'f' } as const

const readSettings = (): Settings => {
  const params = new URLSearchParams(window.location.search)
  const layout = TOWN_KINDS.find((kind) => kind === params.get('layout')) ?? 'ring'
  const replay = params.get('replay')

  return {
    heroes: Number(params.get('heroes') ?? 100),
    seed: Number(params.get('seed') ?? 7),
    tempo: Number(params.get('tempo') ?? 4),
    replay: replay === null ? undefined : replay || DEFAULT_REPLAY,
    layout,
  }
}

const element = (id: string): HTMLElement => {
  const found = document.getElementById(id)

  if (found === null) {
    throw new Error(`index.html is missing #${id}`)
  }

  return found
}

const settings = readSettings()
const app = new Application()
await app.init({
  preference: 'webgl',
  resizeTo: window,
  background: '#0d0b14',
  antialias: false,
  autoStart: false,
  powerPreference: 'high-performance',
})
document.body.prepend(app.canvas)

const { atlas, source: texture } = await loadAtlas('/sprites/heroes-atlas')
const started = performance.now()
const sim = bootSim(settings.seed, started, {}, settings.layout)
const source: Source =
  settings.replay === undefined ? syntheticSource(settings, started) : replaySource(settings.replay)
const town = createTownLayer()
const heroes = createHeroLayer(sim, atlas, texture, ['delving'])
const effects = createEffectLayer(sim, EFFECT_DEFINITIONS)
const world = new Container({ label: 'world' })
world.addChild(town.container, heroes.container, effects.container, town.labels)
app.stage.addChild(world)

const camera: Camera = { x: 0, y: 0, zoom: 0.35, keys: new Set() }
const view: View = { left: 0, top: 0, right: 0, bottom: 0 }
const profile = createProfile(SIM_SYSTEMS)
const events: HeroEvent[] = []
const hud = element('hud')
const loop = { last: started, nextHud: 0, fitted: false, frames: 0, fpsAt: started, fps: 0 }
attachCamera(app.canvas, camera)

const fitTown = (): void => {
  const bounds = townBounds(sim)
  const corners = [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
    [bounds.minX, bounds.maxY],
  ] as const
  const xs = corners.map(([x, y]) => screenX(x, y))
  const ys = corners.map(([x, y]) => screenY(x, y))
  fitCamera(
    camera,
    {
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys),
    },
    app.screen.width,
    app.screen.height,
  )
}

window.addEventListener('keydown', (event) => {
  if (event.key === KEYS.layout) {
    const next = sim.town.kind === 'ring' ? 'road' : 'ring'
    relayoutTown(sim, next, performance.now())
    fitTown()
  }

  if (event.key === KEYS.fit) {
    fitTown()
  }
})

const paintHud = (now: number): void => {
  hud.textContent = [
    `${loop.fps.toFixed(0)} fps`,
    `${heroCount(sim.index)} heroes · ${sim.groups.guildKeys.length} guilds · ${sim.groups.partyWorkspace.length} parties`,
    `town: ${sim.town.kind} (seed ${sim.town.seed}) · ${source.label}`,
    `[${KEYS.layout}] layout  [${KEYS.fit}] fit  wasd/drag pan  wheel zoom`,
  ].join('\n')
  loop.nextHud = now + HUD_EVERY_MS
}

const frame = (now: number): void => {
  const dt = Math.min(100, now - loop.last)
  loop.last = now
  loop.frames += 1

  if (now - loop.fpsAt >= 1000) {
    loop.fps = (loop.frames * 1000) / (now - loop.fpsAt)
    loop.frames = 0
    loop.fpsAt = now
  }

  events.length = 0
  source.poll(now, events)

  for (const event of events) {
    push(sim.inbound, event)
  }

  runSystems(SIM_SYSTEMS, profile, sim, now, dt)
  syncTown(town, sim)

  if (!loop.fitted && now - started > FIT_AFTER_MS) {
    loop.fitted = true
    fitTown()
  }

  updateCamera(camera, world, app.screen.width, app.screen.height, dt, view)
  syncHeroes(heroes, sim, atlas, view, now)
  syncEffects(effects, sim, now)
  app.render()

  if (now >= loop.nextHud) {
    paintHud(now)
  }

  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
