import { isStranger } from '../../core/character.ts'
import { BitmapText, Container, Graphics } from 'pixi.js'
import budgets from '@tokenfall/data/budgets.json'
import world from '@tokenfall/data/world.json'
import { clearSet } from '../../core/dense-set.ts'
import { atEntrance } from '../../core/dungeon.ts'
import { screenX, screenY } from '../../core/iso.ts'
import { NO_PLOT } from '../../core/layout.ts'
import type { Sim } from '../../core/sim.ts'
import type { Screen } from '../../render/camera.ts'
import { hasRaven, type Flock } from '../ravens/flock.ts'
import {
  createStackOut,
  entranceBase,
  headBase,
  STACK_BUBBLE,
  stackAbove,
} from '../selection/stack.ts'
import { statusLine, toolLine, type Mood } from './lines.ts'

export type Bubble = {
  readonly box: Container
  readonly back: Graphics
  readonly text: BitmapText
  eid: number
  bornAt: number
  width: number
  height: number
}

export type Obstacle = (x: number, y: number, halfWidth: number, halfHeight: number) => boolean

export type Bubbles = {
  readonly container: Container
  readonly pool: Bubble[]
  readonly speaking: Int32Array
  readonly ruler: BitmapText
  readonly sizes: Map<string, readonly [number, number]>
  readonly speaker: Speaker
  nextSelected: number
  avoid: Obstacle | undefined
  flock: Flock | undefined
  selected: number
}

type Speaker = { eid: number; inside: boolean; reason: Reason }

type Reason = 'status' | 'tool'

const { bubbles: tuning, fonts } = world

const MOODS: readonly Mood[] = ['idle', 'working', 'done', 'blocked', 'idle']
const NOBODY = -1
const PADDING = 6
const TAIL = 6
const PRIORITY = [3, 2, 1, 0, 4] as const

const lifts = createStackOut()

const createText = (): BitmapText =>
  new BitmapText({
    text: '',
    style: {
      fontFamily: fonts.read,
      fontSize: tuning.fontSize,
      fill: '#2b2014',
      wordWrap: true,
      wordWrapWidth: tuning.maxWidth,
    },
  })

const createBubble = (): Bubble => {
  const box = new Container()
  const back = new Graphics()
  const text = createText()
  text.position.set(PADDING, PADDING)
  box.addChild(back, text)
  box.visible = false

  return { box, back, text, eid: NOBODY, bornAt: 0, width: 0, height: 0 }
}

export const createBubbles = (sim: Sim): Bubbles => {
  const pool = Array.from({ length: budgets.bubbles }, createBubble)
  const container = new Container({ label: 'bubbles', isRenderGroup: true })
  container.addChild(...pool.map((bubble) => bubble.box))

  return {
    container,
    pool,
    speaking: new Int32Array(sim.config.budgets.entities).fill(-1),
    ruler: createText(),
    sizes: new Map(),
    speaker: { eid: NOBODY, inside: false, reason: 'status' },
    nextSelected: 0,
    avoid: undefined,
    flock: undefined,
    selected: NOBODY,
  }
}

const lineFor = (sim: Sim, eid: number, now: number, reason: Reason): string => {
  const personality = sim.config.characters.personalities[sim.stores.hero.personality[eid]!]!
  const seed = Math.floor(now / 1000) + eid
  const tool = sim.text.tool[eid]!

  if (reason === 'tool' && tool !== '') {
    return toolLine(personality.name, tool, seed)
  }

  return statusLine(personality.name, MOODS[sim.stores.hero.status[eid]!] ?? 'idle', seed)
}

const sizeOf = (bubbles: Bubbles, line: string): readonly [number, number] => {
  const known = bubbles.sizes.get(line)

  if (known !== undefined) {
    return known
  }

  bubbles.ruler.text = line
  const size = [bubbles.ruler.width + PADDING * 2, bubbles.ruler.height + PADDING * 2] as const
  bubbles.sizes.set(line, size)

  return size
}

const toScreen = (screen: Screen, x: number, y: number, lift: number, out: Float64Array): void => {
  out[0] = (screenX(x, y) - screen.x) * screen.zoom + screen.width / 2
  out[1] = (screenY(x, y) - screen.y) * screen.zoom + screen.height / 2 - lift
}

const liftOf = (bubbles: Bubbles, sim: Sim, zoom: number, eid: number, inside: boolean): number => {
  const raven = bubbles.flock !== undefined && hasRaven(bubbles.flock, sim, eid, inside)
  stackAbove(
    inside ? entranceBase(zoom) : headBase(zoom),
    zoom,
    eid === bubbles.selected,
    raven,
    lifts,
  )

  return lifts[STACK_BUBBLE]!
}

const anchor = (
  bubbles: Bubbles,
  sim: Sim,
  screen: Screen,
  eid: number,
  inside: boolean,
  out: Float64Array,
): boolean => {
  const lift = liftOf(bubbles, sim, screen.zoom, eid, inside)

  if (!inside) {
    const { x, y } = sim.stores.position
    toScreen(screen, x[eid]!, y[eid]!, lift, out)

    return true
  }

  const plot = sim.town.plotOfGuild[sim.stores.hero.guild[eid]!]!

  if (plot === NO_PLOT) {
    return false
  }

  toScreen(screen, sim.town.entranceX[plot]!, sim.town.entranceY[plot]!, lift, out)

  return true
}

const release = (bubbles: Bubbles, bubble: Bubble): void => {
  if (bubble.eid !== NOBODY) {
    bubbles.speaking[bubble.eid] = -1
  }

  bubble.eid = NOBODY
  bubble.box.visible = false
}

const crowded = (
  bubbles: Bubbles,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean => {
  if (
    bubbles.avoid?.(x, y - TAIL - height / 2, width / 2 + tuning.gap, height / 2 + tuning.gap) ===
    true
  ) {
    return true
  }

  for (const other of bubbles.pool) {
    if (
      other.eid !== NOBODY &&
      Math.abs(other.box.x - x) * 2 < other.width + width + tuning.gap * 2 &&
      Math.abs(other.box.y - other.height / 2 - (y - height / 2)) * 2 <
        other.height + height + tuning.gap * 2
    ) {
      return true
    }
  }

  return false
}

const speak = (
  bubbles: Bubbles,
  sim: Sim,
  screen: Screen,
  speaker: Speaker,
  now: number,
  out: Float64Array,
): void => {
  const { eid } = speaker

  if (bubbles.speaking[eid] !== -1 || !anchor(bubbles, sim, screen, eid, speaker.inside, out)) {
    return
  }

  if (
    out[0]! < 0 ||
    out[0]! > screen.width - tuning.reserveRight ||
    out[1]! < 0 ||
    out[1]! > screen.height
  ) {
    return
  }

  const free = bubbles.pool.find((bubble) => bubble.eid === NOBODY)

  if (free === undefined || isStranger(sim.config.characters, sim.stores.hero.sheet[eid]!)) {
    return
  }

  const line = lineFor(sim, eid, now, speaker.reason)
  const [width, height] = sizeOf(bubbles, line)
  const x = Math.round(out[0]!)
  const y = Math.round(out[1]!)

  if (crowded(bubbles, x, y, width, height)) {
    return
  }

  free.text.text = line
  free.eid = eid
  free.bornAt = now
  free.width = width
  free.height = height
  free.back.clear()
  free.back
    .roundRect(-width / 2, -height - TAIL, width, height, 4)
    .fill({ color: 0xf1_e4_c4, alpha: 0.95 })
    .stroke({ width: 1, color: 0x2b_20_14 })
    .poly([-TAIL, -TAIL, TAIL, -TAIL, 0, 0])
    .fill({ color: 0xf1_e4_c4, alpha: 0.95 })
  free.text.position.set(-width / 2 + PADDING, -height - TAIL + PADDING)
  free.box.position.set(x, y)
  free.box.visible = true
  bubbles.speaking[eid] = bubbles.pool.indexOf(free)
}

export const syncBubbles = (
  bubbles: Bubbles,
  sim: Sim,
  screen: Screen,
  selected: number,
  now: number,
): number => {
  const out = sim.scratch
  const { speaker } = bubbles
  const insideOf = (eid: number): boolean => atEntrance(sim, eid)
  bubbles.selected = selected

  if (selected >= 0 && now >= bubbles.nextSelected) {
    bubbles.nextSelected = now + tuning.selectedEveryMs
    speaker.eid = selected
    speaker.inside = insideOf(selected)
    speaker.reason = 'tool'
    speak(bubbles, sim, screen, speaker, now, out)
  }

  speaker.reason = 'status'

  for (const status of PRIORITY) {
    for (let i = 0; i < sim.statusChanged.size; i++) {
      speaker.eid = sim.statusChanged.dense[i]!

      if (sim.stores.hero.status[speaker.eid] === status) {
        speaker.inside = insideOf(speaker.eid)
        speak(bubbles, sim, screen, speaker, now, out)
      }
    }
  }

  clearSet(sim.statusChanged)
  speaker.reason = 'tool'

  for (let i = 0; i < sim.toolChanged.size; i++) {
    speaker.eid = sim.toolChanged.dense[i]!
    speaker.inside = insideOf(speaker.eid)
    speak(bubbles, sim, screen, speaker, now, out)
  }

  clearSet(sim.toolChanged)
  let active = 0

  for (const bubble of bubbles.pool) {
    if (bubble.eid === NOBODY) {
      continue
    }

    const age = now - bubble.bornAt

    if (
      age > tuning.lifeMs ||
      !anchor(bubbles, sim, screen, bubble.eid, insideOf(bubble.eid), out)
    ) {
      release(bubbles, bubble)
      continue
    }

    if (out[0]! + bubble.width / 2 > screen.width - tuning.reserveRight) {
      release(bubbles, bubble)
      continue
    }

    bubble.box.position.set(Math.round(out[0]!), Math.round(out[1]!))
    bubble.box.alpha = Math.min(1, (tuning.lifeMs - age) / tuning.fadeMs)
    active += 1
  }

  return active
}
