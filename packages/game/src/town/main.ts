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
import {
  BOARD,
  createAttentionQueue,
  nextInQueue,
  WAIT_INBOX,
  WAIT_PERMISSION,
  waitOf,
} from '../features/attention/queue.ts'
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
  glideTo,
  KEYBINDS,
  updateCamera,
  type Camera,
  type Screen,
} from '../render/camera.ts'
import { createHeroLayer, loadAtlas, setProps, syncHeroes, type View } from '../render/heroes.ts'
import { createBridge, NOBODY } from '../ui/bridge.ts'
import { createMenu } from '../features/selection/menu.ts'
import { createFollow } from '../features/selection/follow.ts'
import { routeKey } from '../features/selection/keys.ts'
import { createFitter } from '../features/town/fit.ts'
import { noteZoom, readZoom } from '../features/town/zoom.ts'
import { DEATH_CAUSES } from '@tokenfall/protocol/hero'
import death from '@tokenfall/data/death.json'
import { sceneLength } from '../core/death-scene.ts'
import { graveAt } from '../features/death/pick.ts'
import {
  loadHordeLayer,
  placeHorde,
  syncHorde,
  type HordeLayer,
} from '../features/death/horde-layer.ts'
import {
  loadMonsterLayer,
  placeMonsters,
  syncMonsters,
  type MonsterLayer,
} from '../features/combat/monster-layer.ts'
import { deathText } from '../features/death/text.ts'
import { loadFonts } from '../ui/fonts.ts'
import { mountUi } from '../ui/mount.tsx'
import { createChronicle } from '../features/chronicle/model.ts'
import { createInbox } from '../features/ravens/model.ts'
import { createSheet } from '../features/sheet/model.ts'
import { createFlock, ravenAt, syncFlock } from '../features/ravens/flock.ts'
import { createNoticeBoard } from '../features/notices/model.ts'
import { boardAt, createBoardBadge, ravenReach, syncBoardBadge } from '../features/notices/badge.ts'
import { threadUrl, type InboxState } from '@tokenfall/protocol/inbox'
import { createChests, syncChests } from '../features/loot/chests.ts'
import dungeonTuning from '@tokenfall/data/dungeon.json'
import { cellWorld, closeView, openView, tierInside } from '../core/dungeon.ts'
import { endEffect, spawnEffectAt } from '../effects/emitters.ts'
import { WARP_PORTAL_KIND } from '../effects/systems.ts'
import { stateFlags } from '../core/fsm.ts'
import { guildLabel } from '../core/groups.ts'
import { NONE } from '../core/hero-index.ts'
import { entranceSpot, NO_PLOT } from '../core/layout.ts'
import { createDungeonModel } from '../features/dungeon/model.ts'
import { createDungeonView, hideDungeon, showTier, stairsUnder } from '../features/dungeon/view.ts'
import { setAmbient, TOWN_AMBIENT } from '../features/light/light.ts'
import { groundX, groundY } from '../core/iso.ts'
import { createCrowns, syncCrowns } from '../features/crown/crowns.ts'
import { createCombatMarks, syncCombatMarks } from '../features/combat/marks.ts'
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
  readonly dungeon: number | undefined
  readonly deaths: boolean
  readonly combat: boolean
  readonly debug: boolean
}

type HordeView = { layer: HordeLayer | undefined; loading: boolean }

type MonsterView = { layer: MonsterLayer | undefined; loading: boolean }

const HUD_EVERY_MS = 250
const HORDE_ATLAS = '/sprites/horde-atlas'
const PICK_REACH = 60
const ROSTER_SPACE = 360
const SOUTH = 'S'
const FIT_AFTER_MS = 1500
const DEFAULT_REPLAY = 'ws://127.0.0.1:47330'
const LANTERN_LIT: ReadonlySet<string> = new Set(['lantern', 'notice_board'])
const ENTRANCE_REACH = 1.6
const TIER_KEYS = { up: 'PageUp', down: 'PageDown', leave: 'Escape' } as const

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
    dungeon: params.has('dungeon') ? Number(params.get('dungeon') ?? 0) : undefined,
    deaths: params.has('deaths'),
    combat: params.has('combat') || plan?.combat === true,
    debug: params.has('debug') || params.has('heroes') || plan !== undefined,
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
    : daemonSource(daemonUrl(), {
        chronicle: chronicle.add,
        inbox: (state: InboxState) => {
          inbox.set(state)
          noticeBoard.update(state)
        },
        frame: sheet.receive,
      })
}

const chronicle = createChronicle()
const inbox = createInbox()
const noticeBoard = createNoticeBoard()
const sheet = createSheet()
const source = pickSource()
const sim = bootSim(await source.ready, started, {})
sim.clockOffset = settings.synthetic ? 0 : performance.timeOrigin
const town = createTownLayer()
const heroes = createHeroLayer(sim, atlas, texture, ['succeeding'])
const dungeonView = createDungeonView(heroes.textures[0]!, heroes.propTextures)
const inside = stateFlags(sim.machine, ['warping-in', 'delving'])
const menu = createMenu()
const scene = {
  townX: 0,
  townY: 0,
  townZoom: 0.35,
  counts: new Uint16Array(dungeonTuning.tiers.length),
  portals: Array.from<number>({ length: 0 }),
  dungeonPortal: -1,
}
const effects = createEffectLayer(sim, EFFECT_DEFINITIONS)
const world = new Container({ label: 'world', isRenderGroup: true })
const chests = createChests(sim, heroes)
const flock = createFlock(sim, heroes)
world.addChild(town.container, heroes.container)

if (chests !== undefined) {
  world.addChild(chests.container)
}

world.addChild(town.labels)

const glow = new Container({ label: 'glow', isRenderGroup: true })
glow.addChild(effects.container)
const crowns = createCrowns()
glow.addChild(crowns.container)
const combatMarks = createCombatMarks(sim)
glow.addChild(combatMarks.container)

if (flock !== undefined) {
  glow.addChild(flock.container)
}

const light = createLightLayer(sim, app.screen.width, app.screen.height)
const heroLight = lightSystem(light, heroes)
const bubbles = createBubbles(sim)
bubbles.flock = flock
const badges = createBadges(sim)
const boardBadge = createBoardBadge()
bubbles.avoid = (x, y, halfWidth, halfHeight) => overlapsBadge(badges, x, y, halfWidth, halfHeight)
const overlay = new Container({ label: 'overlay', isRenderGroup: true })
overlay.addChild(badges.container, boardBadge.container, bubbles.container)
app.stage.addChild(world, light.overlay, glow, overlay)
const screen: Screen = { width: 0, height: 0, x: 0, y: 0, zoom: 1 }
const tip = element('tip')
const hover = { guild: -1, grave: NOBODY }
window.addEventListener('resize', () => {
  resizeLight(light, app.screen.width, app.screen.height)
})

const camera: Camera = { x: 0, y: 0, zoom: 0.35, keys: new Set() }
const view: View = { left: 0, top: 0, right: 0, bottom: 0 }
const profile = createProfile(SIM_SYSTEMS)
const events: HeroEvent[] = []
const hud = element('hud')
hud.hidden = !settings.debug
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
  atBoard: false,
}
const off: ReadonlySet<string> = settings.measure?.off ?? new Set()
const measure: TownMeasure | undefined =
  settings.measure === undefined ? undefined : createTownMeasure(gl, settings.measure, started)
const marker = createSelectionMarker()
const queue = createAttentionQueue(sim)
world.addChildAt(marker.ring, 1)
world.addChildAt(dungeonView.container, 0)
attachCamera(app.canvas, camera)

const countTiers = (guild: number): void => {
  const { index } = sim
  const { hero, behavior } = sim.stores
  scene.counts.fill(0)

  for (let slot = 0; slot < index.nextSlot; slot++) {
    const eid = index.entityOf[slot]!

    if (eid !== NONE && inside[behavior.state[eid]!] === 1 && hero.guild[eid] === guild) {
      const tier = tierInside(sim, eid)
      scene.counts[tier] = scene.counts[tier]! + 1
    }
  }
}

const deepestTier = (guild: number): number => {
  countTiers(guild)

  for (let tier = scene.counts.length - 1; tier > 0; tier--) {
    if (scene.counts[tier]! > 0) {
      return tier
    }
  }

  return 0
}

const busiestGuild = (): number => {
  let best = 0
  let most = -1

  for (let guild = 0; guild < sim.groups.guildKeys.length; guild++) {
    countTiers(guild)
    const total = scene.counts.reduce((sum, count) => sum + count, 0)

    if (total > most) {
      most = total
      best = guild
    }
  }

  return best
}

const openRequestedDungeon = (): void => {
  if (sim.groups.guildKeys.length === 0) {
    return
  }

  const guild = busiestGuild()

  if (settings.dungeon !== undefined) {
    openDungeon(guild, settings.dungeon)
  } else if (settings.measure?.dungeon === true) {
    openDungeon(guild, deepestTier(guild))
  }
}

const refreshTierStrip = (): void => {
  if (dungeonView.open !== undefined) {
    countTiers(dungeonView.open.guild)
    dungeonModel.setCounts(scene.counts)
  }
}

const hideTown = (): void => {
  scene.townX = camera.x
  scene.townY = camera.y
  scene.townZoom = camera.zoom
  town.container.visible = false
  town.labels.visible = false
  badges.container.visible = false
  boardBadge.container.visible = false
  setProps(heroes, [])
  setStaticLights(light, [])
}

const endPortal = (eid: number): void => {
  if (eid > 0) {
    endEffect(sim, eid)
  }
}

const placeDungeonPortal = (guild: number): void => {
  const { map } = dungeonView
  endPortal(scene.dungeonPortal)
  scene.dungeonPortal = -1

  if (map !== undefined) {
    cellWorld(sim, map, guild, map.arrival, sim.scratch)
    scene.dungeonPortal = spawnEffectAt(
      sim,
      WARP_PORTAL_KIND,
      sim.scratch[0]!,
      sim.scratch[1]!,
      performance.now(),
    )
  }
}

const placeTownPortals = (): void => {
  for (const eid of scene.portals) {
    endPortal(eid)
  }

  scene.portals.length = 0

  for (let guild = 0; guild < sim.groups.guildKeys.length; guild++) {
    if (sim.town.plotOfGuild[guild] !== NO_PLOT) {
      entranceSpot(sim, guild, sim.scratch)
      scene.portals.push(
        spawnEffectAt(sim, WARP_PORTAL_KIND, sim.scratch[0]!, sim.scratch[1]!, performance.now()),
      )
    }
  }
}

const openDungeon = (guild: number, tier: number): void => {
  if (dungeonView.open === undefined) {
    hideTown()
  }

  const tuning = dungeonTuning.tiers[tier]!
  setAmbient(light, tuning.ambient, tuning.ambientLuminance)
  const dressing = showTier(dungeonView, sim, guild, tier)
  openView(sim, guild, tier)
  placeDungeonPortal(guild)
  setProps(heroes, off.has('props') ? [] : dressing.props)
  setStaticLights(light, dressing.lights)
  dungeonModel.show(guildLabel(sim.groups.guildKeys[guild] ?? ''), tier)
  countTiers(guild)
  dungeonModel.setCounts(scene.counts)
  fit.dungeon(true)
}

const leaveDungeonView = (): void => {
  if (dungeonView.open === undefined) {
    return
  }

  hideDungeon(dungeonView)
  dungeonModel.hide()
  closeView(sim)
  endPortal(scene.dungeonPortal)
  scene.dungeonPortal = -1
  town.container.visible = true
  town.labels.visible = true
  badges.container.visible = true
  boardBadge.container.visible = true
  setAmbient(light, TOWN_AMBIENT.color, TOWN_AMBIENT.luminance)
  furnishTown()
  camera.x = scene.townX
  camera.y = scene.townY
  camera.zoom = scene.townZoom
  camera.targetX = undefined
  camera.targetY = undefined
}

const stepTier = (delta: number): void => {
  const { open } = dungeonView

  if (open === undefined) {
    return
  }

  const tier = Math.min(dungeonTuning.tiers.length - 1, Math.max(0, open.tier + delta))
  camera.follow = undefined

  if (tier !== open.tier) {
    openDungeon(open.guild, tier)
  }
}

const focusHero = (eid: number): void => {
  const { x, y } = sim.stores.position

  if (inside[sim.stores.behavior.state[eid]!] === 1) {
    const guild = sim.stores.hero.guild[eid]!
    const tier = tierInside(sim, eid)
    const { open } = dungeonView

    if (open?.guild !== guild || open.tier !== tier) {
      openDungeon(guild, tier)
    }

    if (sim.stores.delve.placed[eid] === 1) {
      glideTo(camera, screenX(x[eid]!, y[eid]!), screenY(x[eid]!, y[eid]!) - 40)
    }

    return
  }

  leaveDungeonView()
  glideTo(camera, screenX(x[eid]!, y[eid]!), screenY(x[eid]!, y[eid]!) - 40)
}

const entranceAt = (pixelX: number, pixelY: number): number => {
  const wx = groundX(pixelX, pixelY)
  const wy = groundY(pixelX, pixelY)

  for (let guild = 0; guild < sim.groups.guildKeys.length; guild++) {
    if (sim.town.plotOfGuild[guild] !== NO_PLOT) {
      entranceSpot(sim, guild, sim.scratch)

      if (Math.hypot(sim.scratch[0]! - wx, sim.scratch[1]! - wy) <= ENTRANCE_REACH) {
        return guild
      }
    }
  }

  return -1
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

const focusBoard = (): void => {
  const { spot } = noticeBoard

  if (spot.placed) {
    glideTo(camera, screenX(spot.x, spot.y), screenY(spot.x, spot.y) - 40)
  }

  bridge.select(NOBODY)
  loop.atBoard = true
  noticeBoard.show()
}

const dungeonModel = createDungeonModel({
  pick: (tier) => {
    const { open } = dungeonView

    if (open !== undefined) {
      openDungeon(open.guild, tier)
    }
  },
  leave: leaveDungeonView,
})
sheet.connect(sim, source.watch, source.prompt)
const zoomMemory = readZoom(localStorage)
const fit = createFitter({
  sim,
  camera,
  dungeon: dungeonView,
  screen: app.screen,
  roster: ROSTER_SPACE,
  zoom: zoomMemory,
})

const fitView = (keepZoom: boolean): void => {
  if (dungeonView.open === undefined) {
    fit.town(keepZoom)
  } else {
    fit.dungeon(keepZoom)
  }
}

const follow = createFollow({
  sim,
  camera,
  view,
  menu,
  dungeon: dungeonView,
  hidden: heroes.hidden,
  inside,
  selected: bridge.selected,
  sheetOpen: sheet.open,
  screen: app.screen,
  openDungeon,
  leaveDungeon: leaveDungeonView,
  showSheet: sheet.show,
  focus: focusHero,
})

const ui = mountUi(
  bridge,
  { source: source.label, debug: settings.debug },
  {
    chronicle,
    inbox,
    sheet,
    board: noticeBoard,
    onBoard: focusBoard,
    dungeon: dungeonModel,
    menu,
    actions: follow.actions,
  },
  element('ui'),
)

const answerRaven = (eid: number): void => {
  const wait = waitOf(sim, eid)
  const { url } = inbox.state()
  const thread = sim.text.ravenThread[eid] ?? ''
  bridge.select(eid)

  if (wait === WAIT_PERMISSION) {
    sheet.show(eid)
  } else if (wait === WAIT_INBOX && url !== null && thread !== '') {
    window.open(threadUrl(url, thread), '_blank', 'noopener')
  }
}

camera.onClick = (pointerX, pointerY) => {
  const worldX = (pointerX - app.screen.width / 2) / camera.zoom + camera.x
  const worldY = (pointerY - app.screen.height / 2) / camera.zoom + camera.y
  const reach = PICK_REACH / Math.min(1, camera.zoom)

  if (dungeonView.open !== undefined) {
    const stairs = stairsUnder(dungeonView, sim, worldX, worldY)

    if (stairs === 0) {
      bridge.select(pickHero(sim, heroes, worldX, worldY, reach))
    } else {
      stepTier(stairs)
    }

    return
  }

  const raven =
    flock === undefined ? NOBODY : ravenAt(flock, worldX, worldY, ravenReach(camera.zoom))

  if (raven !== NOBODY) {
    answerRaven(raven)

    return
  }

  if (boardAt(noticeBoard.spot, worldX, worldY, PICK_REACH / Math.min(1, camera.zoom))) {
    noticeBoard.toggle()

    return
  }

  const grave = graveAt(sim, worldX, worldY, reach)

  if (grave !== NOBODY) {
    bridge.select(grave)
    sheet.show(grave)

    return
  }

  const picked = pickHero(sim, heroes, worldX, worldY, reach)
  const badge = badgeAt(badges, pointerX, pointerY)
  const guild = badge >= 0 ? badge : entranceAt(worldX, worldY)

  if (picked === NOBODY && guild >= 0) {
    camera.follow = undefined
    openDungeon(guild, deepestTier(guild))

    return
  }

  bridge.select(picked)
}

const heroKey = (event: KeyboardEvent): void => {
  const action = routeKey(event, bridge.selected())

  if (action === 'fit') {
    fitView(false)
  } else if (action === 'follow') {
    follow.actions.follow(camera.follow === bridge.selected() ? NOBODY : bridge.selected())
  } else if (action === 'sheet') {
    sheet.show(bridge.selected())
  }
}

window.addEventListener('keydown', (event) => {
  heroKey(event)

  if (event.key === TIER_KEYS.leave) {
    if (camera.follow === undefined) {
      leaveDungeonView()
    } else {
      camera.follow = undefined
    }
  }

  if (event.key === TIER_KEYS.up || event.key === TIER_KEYS.down) {
    event.preventDefault()
    stepTier(event.key === TIER_KEYS.up ? -1 : 1)
  }

  if (KEYBINDS.attention.some((key) => key === event.key)) {
    const current = loop.atBoard && bridge.selected() === NOBODY ? BOARD : bridge.selected()
    const next = nextInQueue(queue, sim, noticeBoard.board, current)
    loop.atBoard = false

    if (next === BOARD) {
      focusBoard()
    } else if (next !== NOBODY) {
      bridge.focus(next)
    }
  }
})

const wave = { next: 0, cursor: 0 }

const deathWave = (now: number): void => {
  if (settings.measure?.deaths !== true || now < wave.next) {
    return
  }

  wave.next = now + sceneLength(death.scene)
  let killed = 0

  while (killed < death.measureWave && wave.cursor < sim.index.nextSlot) {
    const id = sim.index.idOf[wave.cursor]!
    wave.cursor += 1

    if (id !== '') {
      push(sim.inbound, { kind: 'hero.died', at: now, hero: id, cause: 'killed' })
      killed += 1
    }
  }
}

const hordeView: HordeView = { layer: undefined, loading: false }

const monsterView: MonsterView = { layer: undefined, loading: false }

const syncMonsterView = (now: number): void => {
  if (monsterView.layer !== undefined) {
    syncMonsters(monsterView.layer, sim, now)

    return
  }

  if (sim.combat.monsters.active > 0 && !monsterView.loading) {
    monsterView.loading = true
    void loadMonsterLayer(sim, HORDE_ATLAS).then((layer) => {
      placeMonsters(layer, world, heroes.container)
      monsterView.layer = layer

      return layer
    })
  }
}

const syncHordeView = (now: number): void => {
  if (hordeView.layer !== undefined) {
    syncHorde(hordeView.layer, sim, now)

    return
  }

  if (sim.horde.active > 0 && !hordeView.loading) {
    hordeView.loading = true
    void loadHordeLayer(sim, HORDE_ATLAS).then((layer) => {
      placeHorde(layer, world, heroes.container)
      hordeView.layer = layer

      return layer
    })
  }
}

const graveTip = (eid: number): string => {
  const { hero } = sim.stores
  const died = deathText(
    DEATH_CAUSES[hero.cause[eid]!] ?? null,
    hero.diedAt[eid]!,
    performance.now() + sim.clockOffset,
  )

  return `${sim.text.name[eid]!} · Lv ${hero.level[eid]!}\n${died}`
}

const graveUnder = (pointerX: number, pointerY: number): number => {
  if (dungeonView.open !== undefined) {
    return NOBODY
  }

  const worldX = (pointerX - app.screen.width / 2) / camera.zoom + camera.x
  const worldY = (pointerY - app.screen.height / 2) / camera.zoom + camera.y

  return graveAt(sim, worldX, worldY, PICK_REACH / Math.min(1, camera.zoom))
}

app.canvas.addEventListener('pointermove', (event) => {
  const guild = badgeAt(badges, event.clientX, event.clientY)
  const grave = guild >= 0 ? NOBODY : graveUnder(event.clientX, event.clientY)

  if (guild === hover.guild && grave === hover.grave) {
    return
  }

  hover.guild = guild
  hover.grave = grave
  tip.hidden = guild < 0 && grave === NOBODY

  if (!tip.hidden) {
    tip.textContent = guild >= 0 ? namesInside(badges, sim, guild).join('\n') : graveTip(grave)
    tip.style.left = `${event.clientX + 14}px`
    tip.style.top = `${event.clientY + 14}px`
  }
})

const furnishTown = (): void => {
  if (dungeonView.open !== undefined) {
    return
  }

  const placements = townProps(sim, townBounds(sim))
  const board = placements.find((placement) => placement.name === 'notice_board')
  noticeBoard.spot.placed = board !== undefined
  noticeBoard.spot.x = board?.x ?? 0
  noticeBoard.spot.y = board?.y ?? 0
  setProps(heroes, off.has('props') ? [] : placements)
  setStaticLights(
    light,
    placements.flatMap((placement): StaticLight[] => {
      if (placement.name === 'campfire') {
        return [{ x: placement.x, y: placement.y, kind: 'fire' }]
      }

      return LANTERN_LIT.has(placement.name)
        ? [{ x: placement.x, y: placement.y, kind: 'lantern' }]
        : []
    }),
  )
  placeTownPortals()
}

const paintHud = (now: number): void => {
  loop.nextHud = now + HUD_EVERY_MS

  if (!settings.debug) {
    return
  }

  hud.textContent = [
    `${loop.fps.toFixed(0)} fps`,
    `${heroCount(sim.index)} heroes · ${sim.groups.guildKeys.length} guilds · ${sim.groups.partyWorkspace.length} parties`,
    `town seed ${sim.town.seed} · ${source.label}`,
    `[q] next who needs you  [f] fit/follow  [c] sheet  wasd/drag pan  wheel zoom  click an entrance to go in`,
    ...(measure === undefined ? [] : [measureLabel(measure), loop.report]),
  ].join('\n')
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

const syncAttention = (now: number): void => {
  if (chests !== undefined) {
    syncChests(chests, sim, now)
  }

  if (flock !== undefined) {
    syncFlock(flock, sim, now, bridge.selected(), camera.zoom)
  }
}

const settleCamera = (now: number): void => {
  if (loop.fitted) {
    noteZoom(zoomMemory, dungeonView.open !== undefined, camera.zoom, now)
  } else if (now - started > FIT_AFTER_MS) {
    loop.fitted = true
    fit.town(true)
    openRequestedDungeon()
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

  settleCamera(now)

  follow.follow()
  updateCamera(camera, world, app.screen.width, app.screen.height, dt, view)
  glow.position.copyFrom(world.position)
  glow.scale.copyFrom(world.scale)
  syncHeroes(heroes, sim, atlas, view, now)
  syncHordeView(now)
  syncMonsterView(now)
  deathWave(now)
  syncSelectionMarker(marker, sim, bridge.selected())
  follow.menu()
  syncAttention(now)

  syncEffects(effects, sim, now)
  syncCrowns(crowns, sim)
  syncCombatMarks(combatMarks, sim, now)
  screen.width = app.screen.width
  screen.height = app.screen.height
  screen.x = camera.x
  screen.y = camera.y
  screen.zoom = camera.zoom

  const overlaid = !off.has('overlay')
  overlay.visible = overlaid

  if (overlaid) {
    syncBadges(badges, sim, screen, now)
    syncBoardBadge(boardBadge, noticeBoard.spot, noticeBoard.board.count, screen)
  }

  const speaking = overlaid ? syncBubbles(bubbles, sim, screen, bridge.selected(), now) : 0
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
    refreshTierStrip()
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
