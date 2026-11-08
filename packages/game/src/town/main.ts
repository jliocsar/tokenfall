import { Application, Container, WebGLRenderer } from 'pixi.js'
import worldTuning from '@tokenfall/data/world.json'
import type { HeroEvent } from '@tokenfall/protocol/events'
import { bootSim, EFFECT_DEFINITIONS } from '../core/boot.ts'
import { heroCount } from '../core/hero-index.ts'
import { screenX, screenY } from '../core/iso.ts'
import { push } from '../core/queue.ts'
import { createProfile, runSystems } from '../core/system.ts'
import { SIM_SYSTEMS } from '../core/systems/index.ts'
import { createEffectLayer, syncEffects } from '../effects/gpu.ts'
import { createAttentionQueue, nextInQueue } from '../features/attention/queue.ts'
import {
  createSelectionMarker,
  pickHero,
  syncSelectionMarker,
} from '../features/selection/marker.ts'
import {
  createLightLayer,
  lightSystem,
  renderLight,
  resizeLight,
  setStaticLights,
  type StaticLight,
} from '../features/light/light.ts'
import {
  badgeAt,
  createBadges,
  namesInside,
  overlapsBadge,
  syncBadges,
} from '../features/entrance/badges.ts'
import { createBubbles, syncBubbles } from '../features/narration/bubbles.ts'
import { createTownLayer, syncTown, townBounds } from '../features/town/ground.ts'
import { townProps } from '../features/town/props.ts'
import {
  attachCamera,
  fitCamera,
  glideTo,
  KEYBINDS,
  updateCamera,
  type Camera,
  type Screen,
} from '../render/camera.ts'
import { createHeroLayer, loadAtlas, setProps, syncHeroes, type View } from '../render/heroes.ts'
import { createBridge, NOBODY } from '../ui/bridge.ts'
import { loadFonts } from '../ui/fonts.ts'
import { mountUi } from '../ui/mount.tsx'
import { createChronicle } from '../features/chronicle/model.ts'
import { createInbox } from '../features/ravens/model.ts'
import {
  createTownMeasure,
  type MeasurePlan,
  measureFrame,
  measureLabel,
  recordRoster,
  readMeasurePlan,
  type TownMeasure,
} from './measure.ts'
import { daemonSource, daemonUrl, replaySource, syntheticSource, type Source } from './source.ts'

type Settings = {
  readonly heroes: number
  readonly seed: number
  readonly tempo: number
  readonly replay: string | undefined
  readonly synthetic: boolean
  readonly measure: MeasurePlan | undefined
}

const HUD_EVERY_MS = 250
const PICK_REACH = 60
const ROSTER_SPACE = 360
const SOUTH = 'S'
const FIT_AFTER_MS = 1500
const DEFAULT_REPLAY = 'ws://127.0.0.1:47330'

const readSettings = (): Settings => {
  const params = new URLSearchParams(window.location.search)
  const replay = params.get('replay')
  const plan = readMeasurePlan(params)

  return {
    heroes: plan?.heroes ?? Number(params.get('heroes') ?? 100),
    seed: Number(params.get('seed') ?? 7),
    tempo: Number(params.get('tempo') ?? 4),
    replay: replay === null ? undefined : replay || DEFAULT_REPLAY,
    synthetic: plan !== undefined || params.has('heroes'),
    measure: plan,
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

if (!(app.renderer instanceof WebGLRenderer)) {
  throw new Error('the Town needs the WebGL renderer')
}

const { gl } = app.renderer

await loadFonts()

const { atlas, source: texture } = await loadAtlas('/sprites/heroes-atlas')
const started = performance.now()

const pickSource = (): Source => {
  if (settings.replay !== undefined) {
    return replaySource(settings.replay)
  }

  return settings.synthetic
    ? syntheticSource(settings, started)
    : daemonSource(daemonUrl(), chronicle.add, inbox.set)
}

const chronicle = createChronicle()
const inbox = createInbox()
const source = pickSource()
const sim = bootSim(await source.ready, started, {})
const town = createTownLayer()
const heroes = createHeroLayer(sim, atlas, texture, ['delving'])
const effects = createEffectLayer(sim, EFFECT_DEFINITIONS)
const world = new Container({ label: 'world', isRenderGroup: true })
world.addChild(town.container, heroes.container, town.labels)
const glow = new Container({ label: 'glow', isRenderGroup: true })
glow.addChild(effects.container)
const light = createLightLayer(sim, app.screen.width, app.screen.height)
const heroLight = lightSystem(light, heroes)
const bubbles = createBubbles(sim)
const badges = createBadges(sim)
bubbles.avoid = (x, y, halfWidth, halfHeight) => overlapsBadge(badges, x, y, halfWidth, halfHeight)
const overlay = new Container({ label: 'overlay', isRenderGroup: true })
overlay.addChild(badges.container, bubbles.container)
app.stage.addChild(world, light.overlay, glow, overlay)
const screen: Screen = { width: 0, height: 0, x: 0, y: 0, zoom: 1 }
const tip = element('tip')
const hover = { guild: -1 }
window.addEventListener('resize', () => {
  resizeLight(light, app.screen.width, app.screen.height)
})

const camera: Camera = { x: 0, y: 0, zoom: 0.35, keys: new Set() }
const view: View = { left: 0, top: 0, right: 0, bottom: 0 }
const profile = createProfile(SIM_SYSTEMS)
const events: HeroEvent[] = []
const hud = element('hud')
const loop = {
  last: started,
  nextHud: 0,
  nextRoster: 0,
  fitted: false,
  frames: 0,
  fpsAt: started,
  fps: 0,
  report: '',
  rosterPending: false,
}
const off: ReadonlySet<string> = settings.measure?.off ?? new Set()
const measure: TownMeasure | undefined =
  settings.measure === undefined ? undefined : createTownMeasure(gl, settings.measure, started)
const marker = createSelectionMarker()
const queue = createAttentionQueue(sim)
world.addChildAt(marker.ring, 1)
attachCamera(app.canvas, camera)

const focusHero = (eid: number): void => {
  const { x, y } = sim.stores.position
  glideTo(camera, screenX(x[eid]!, y[eid]!), screenY(x[eid]!, y[eid]!) - 40)
}

const south = atlas.directions.indexOf(SOUTH)
const bridge = createBridge(
  sim,
  {
    url: '/sprites/heroes-atlas.png',
    width: texture.width,
    height: texture.height,
    origins: atlas.cells.map((animations) => animations[0]![south]![0]!),
  },
  { glideTo: focusHero },
)
const ui = mountUi(bridge, source.label, chronicle, inbox, element('ui'))

camera.onClick = (pointerX, pointerY) => {
  const worldX = (pointerX - app.screen.width / 2) / camera.zoom + camera.x
  const worldY = (pointerY - app.screen.height / 2) / camera.zoom + camera.y
  bridge.select(pickHero(sim, heroes, worldX, worldY, PICK_REACH / Math.min(1, camera.zoom)))
}

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
    app.screen.width - ROSTER_SPACE,
    app.screen.height,
  )
  camera.x += ROSTER_SPACE / 2 / camera.zoom
}

window.addEventListener('keydown', (event) => {
  if (KEYBINDS.fit.some((key) => key === event.key)) {
    fitTown()
  }

  if (KEYBINDS.attention.some((key) => key === event.key)) {
    const next = nextInQueue(queue, sim, bridge.selected())

    if (next !== NOBODY) {
      bridge.focus(next)
    }
  }
})

app.canvas.addEventListener('pointermove', (event) => {
  const guild = badgeAt(badges, event.clientX, event.clientY)

  if (guild === hover.guild) {
    return
  }

  hover.guild = guild
  tip.hidden = guild < 0

  if (guild >= 0) {
    tip.textContent = namesInside(badges, sim, guild).join('\n')
    tip.style.left = `${event.clientX + 14}px`
    tip.style.top = `${event.clientY + 14}px`
  }
})

const furnishTown = (): void => {
  const placements = townProps(sim, townBounds(sim))
  setProps(heroes, off.has('props') ? [] : placements)
  setStaticLights(
    light,
    placements.flatMap((placement): StaticLight[] => {
      if (placement.name === 'campfire') {
        return [{ x: placement.x, y: placement.y, kind: 'fire' }]
      }

      return placement.name === 'lantern'
        ? [{ x: placement.x, y: placement.y, kind: 'lantern' }]
        : []
    }),
  )
}

const paintHud = (now: number): void => {
  hud.textContent = [
    `${loop.fps.toFixed(0)} fps`,
    `${heroCount(sim.index)} heroes · ${sim.groups.guildKeys.length} guilds · ${sim.groups.partyWorkspace.length} parties`,
    `town seed ${sim.town.seed} · ${source.label}`,
    `[q] next who needs you  [f] fit  wasd/drag pan  wheel zoom`,
    ...(measure === undefined ? [] : [measureLabel(measure), loop.report]),
  ].join('\n')
  loop.nextHud = now + HUD_EVERY_MS
}

const report = (text: string): void => {
  loop.report = text
}

const measureExtra = () => ({
  guilds: sim.groups.guildKeys.length,
  parties: sim.groups.partyWorkspace.length,
})

const flushRoster = (): void => {
  const start = performance.now()
  ui.roster.flush(performance.now())
  loop.rosterPending = false

  if (measure !== undefined) {
    recordRoster(measure, performance.now() - start)
  }
}

const frame = (now: number): void => {
  const frameStart = performance.now()
  const interval = now - loop.last
  const dt = Math.min(100, interval)
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
  const simEnd = performance.now()

  if (syncTown(town, sim)) {
    furnishTown()
  }

  heroLight.run(sim, now, dt)

  if (!loop.fitted && now - started > FIT_AFTER_MS) {
    loop.fitted = true
    fitTown()
  }

  updateCamera(camera, world, app.screen.width, app.screen.height, dt, view)
  glow.position.copyFrom(world.position)
  glow.scale.copyFrom(world.scale)
  syncHeroes(heroes, sim, atlas, view, now)
  syncSelectionMarker(marker, sim, bridge.selected())
  syncEffects(effects, sim, now)
  screen.width = app.screen.width
  screen.height = app.screen.height
  screen.x = camera.x
  screen.y = camera.y
  screen.zoom = camera.zoom
  const overlaid = !off.has('overlay')
  overlay.visible = overlaid

  if (overlaid) {
    syncBadges(badges, sim, screen, now)
  }

  const speaking = overlaid ? syncBubbles(bubbles, sim, heroes, screen, bridge.selected(), now) : 0
  const syncEnd = performance.now()
  measure?.gpu.begin()
  light.overlay.visible = !off.has('light')

  if (light.overlay.visible) {
    renderLight(light, sim, heroes, app.renderer, world, view, now)
  }

  app.render()
  measure?.gpu.end()
  const renderEnd = performance.now()

  if (now >= loop.nextHud) {
    paintHud(now)
  }

  if (now >= loop.nextRoster && !loop.rosterPending) {
    loop.nextRoster = now + worldTuning.roster.rowsEveryMs
    loop.rosterPending = true
    requestIdleCallback(flushRoster, { timeout: worldTuning.roster.rowsEveryMs })
  }

  if (measure !== undefined) {
    const { cost } = measure
    cost.interval = interval
    cost.sim = simEnd - frameStart
    cost.sync = syncEnd - simEnd
    cost.render = renderEnd - syncEnd
    cost.bubbles = speaking
    measureFrame(measure, gl, profile, now, measureExtra, report)
  }

  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
