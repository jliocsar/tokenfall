import { BitmapText, Container, Graphics } from 'pixi.js'
import budgets from '@tokenfall/data/budgets.json'
import lines from '@tokenfall/data/narration-placeholder.json'
import world from '@tokenfall/data/world.json'
import { clearSet } from '../../core/dense-set.ts'
import { screenX, screenY } from '../../core/iso.ts'
import type { Sim } from '../../core/sim.ts'
import type { Screen } from '../../render/camera.ts'
import type { HeroLayer } from '../../render/heroes.ts'

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
  nextSelected: number
  avoid: Obstacle | undefined
}

type Mood = keyof (typeof lines)['Brave']

const { bubbles: tuning, fonts } = world

const LINES = new Map(Object.entries(lines))
const MOODS: readonly Mood[] = ['idle', 'working', 'done', 'blocked', 'idle']
const NOBODY = -1
const PADDING = 6
const TAIL = 6
const PRIORITY = [3, 2, 1, 0, 4] as const

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
    nextSelected: 0,
    avoid: undefined,
  }
}

const lineFor = (sim: Sim, eid: number, now: number): string => {
  const personality = sim.config.characters.personalities[sim.stores.hero.personality[eid]!]!
  const mood = MOODS[sim.stores.hero.status[eid]!] ?? 'idle'
  const table = LINES.get(personality.name) ?? lines.Brave
  const pool = table[mood]

  return pool[Math.floor(now / 1000 + eid) % pool.length]!
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

const toScreen = (sim: Sim, screen: Screen, eid: number, out: Float64Array): void => {
  const { x, y } = sim.stores.position
  out[0] = (screenX(x[eid]!, y[eid]!) - screen.x) * screen.zoom + screen.width / 2
  out[1] = (screenY(x[eid]!, y[eid]!) - screen.y) * screen.zoom + screen.height / 2
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
  eid: number,
  now: number,
  out: Float64Array,
): void => {
  if (bubbles.speaking[eid] !== -1) {
    return
  }

  toScreen(sim, screen, eid, out)

  if (
    out[0]! < 0 ||
    out[0]! > screen.width - tuning.reserveRight ||
    out[1]! < 0 ||
    out[1]! > screen.height
  ) {
    return
  }

  const free = bubbles.pool.find((bubble) => bubble.eid === NOBODY)

  if (free === undefined) {
    return
  }

  const line = lineFor(sim, eid, now)
  const [width, height] = sizeOf(bubbles, line)
  const x = Math.round(out[0]!)
  const y = Math.round(out[1]! - tuning.offsetY * screen.zoom)

  if (crowded(bubbles, x, y, width, height)) {
    return
  }

  free.text.text = line
  free.eid = eid
  free.bornAt = now
  free.width = width
  free.height = height
  free.back.clear()
  console.count('graphics-clear')
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
  heroes: HeroLayer,
  screen: Screen,
  selected: number,
  now: number,
): number => {
  const out = sim.scratch
  const hidden = heroes.hidden

  if (selected >= 0 && now >= bubbles.nextSelected) {
    bubbles.nextSelected = now + tuning.selectedEveryMs
    speak(bubbles, sim, screen, selected, now, out)
  }

  for (const status of PRIORITY) {
    for (let i = 0; i < sim.statusChanged.size; i++) {
      const eid = sim.statusChanged.dense[i]!

      if (sim.stores.hero.status[eid] === status && hidden[sim.stores.behavior.state[eid]!] !== 1) {
        speak(bubbles, sim, screen, eid, now, out)
      }
    }
  }

  clearSet(sim.statusChanged)
  let active = 0

  for (const bubble of bubbles.pool) {
    if (bubble.eid === NOBODY) {
      continue
    }

    const age = now - bubble.bornAt

    if (age > tuning.lifeMs || hidden[sim.stores.behavior.state[bubble.eid]!] === 1) {
      release(bubbles, bubble)
      continue
    }

    toScreen(sim, screen, bubble.eid, out)

    if (out[0]! + bubble.width / 2 > screen.width - tuning.reserveRight) {
      release(bubbles, bubble)
      continue
    }

    bubble.box.position.set(Math.round(out[0]!), Math.round(out[1]! - tuning.offsetY * screen.zoom))
    bubble.box.alpha = Math.min(1, (tuning.lifeMs - age) / tuning.fadeMs)
    active += 1
  }

  return active
}
