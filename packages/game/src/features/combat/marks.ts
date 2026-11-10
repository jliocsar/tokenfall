import { BitmapFontManager, Container, Particle, ParticleContainer, Texture } from 'pixi.js'
import world from '@tokenfall/data/world.json'
import { backOffset, fights } from '../../core/combat.ts'
import { screenX, screenY } from '../../core/iso.ts'
import {
  DAMAGE_CRIT,
  DAMAGE_WISP,
  MONSTER_ATTACK,
  MONSTER_IDLE,
  NO_ROOM,
} from '../../core/monsters.ts'
import type { Sim } from '../../core/sim.ts'

export type CombatMarks = {
  readonly container: Container
  readonly bars: ParticleContainer
  readonly numbers: ParticleContainer
  readonly barPool: readonly Particle[]
  readonly glyphPool: readonly Particle[]
  readonly digits: readonly Texture[]
  readonly advance: number
  readonly glyphScale: number
  readonly offsetY: number
  readonly colors: Uint32Array
  readonly back: number
  readonly heroFill: number
  readonly monsterFill: number
}

const { fonts } = world

const FONT = 'damage-digits'
const OUTLINE = 2
const SPREAD = 5
const FADE_FROM = 0.6
const POP_SHARE = 0.18
const POP = 0.4
const RADIX = 10
const BACK = new Float64Array(2)

const bgr = ([red, green, blue]: readonly number[]): number => (blue! << 16) | (green! << 8) | red!

const withAlpha = (color: number, alpha: number): number =>
  ((Math.round(alpha * 255) << 24) | color) >>> 0

const container = (texture: Texture): ParticleContainer =>
  new ParticleContainer({
    dynamicProperties: { position: true, vertex: true, uvs: true, color: true, rotation: false },
    texture,
  })

export const createCombatMarks = (sim: Sim): CombatMarks => {
  const tuning = sim.config.combat
  const { budgets } = sim.config
  const font = BitmapFontManager.install({
    name: FONT,
    style: {
      fontFamily: fonts.pixel,
      fontSize: fonts.pixelSize,
      fill: 0xff_ff_ff,
      stroke: { color: 0x00_00_00, width: OUTLINE },
    },
    chars: [['0', '9']],
  })
  const zero = font.chars['0']!
  const glyphScale = fonts.pixelSize / font.baseMeasurementFontSize
  const digits = Array.from(
    { length: RADIX },
    (_unused, digit) => font.chars[String(digit)]?.texture ?? Texture.EMPTY,
  )
  const bars = container(Texture.WHITE)
  digits[0]!.source.scaleMode = 'nearest'
  const numbers = container(digits[0]!)
  const marks = new Container({ label: 'combat-marks', isRenderGroup: true })
  marks.addChild(bars, numbers)

  return {
    container: marks,
    bars,
    numbers,
    barPool: Array.from({ length: budgets.hpBars * 2 }, () => new Particle(Texture.WHITE)),
    glyphPool: Array.from(
      { length: budgets.damageNumbers * tuning.numbers.digits },
      () => new Particle(digits[0]!),
    ),
    digits,
    advance: zero.xAdvance * glyphScale,
    glyphScale,
    offsetY: zero.yOffset * glyphScale,
    colors: new Uint32Array(tuning.numbers.colors.map(bgr)),
    back: withAlpha(bgr(tuning.bars.back), 0.85),
    heroFill: withAlpha(bgr(tuning.bars.hero), 1),
    monsterFill: withAlpha(bgr(tuning.bars.monster), 1),
  }
}

const bar = (
  marks: CombatMarks,
  sim: Sim,
  used: number,
  x: number,
  y: number,
  share: number,
  fill: number,
): number => {
  const { width, height } = sim.config.combat.bars
  const back = marks.barPool[used]!
  const front = marks.barPool[used + 1]!
  const left = Math.round(x - width / 2)
  const top = Math.round(y)
  back.x = left - 1
  back.y = top - 1
  back.scaleX = width + 2
  back.scaleY = height + 2
  back.color = marks.back
  front.x = left
  front.y = top
  front.scaleX = Math.max(1, width * share)
  front.scaleY = height
  front.color = fill
  marks.bars.particleChildren[used] = back
  marks.bars.particleChildren[used + 1] = front

  return used + 2
}

const heroBars = (marks: CombatMarks, sim: Sim, used: number): number => {
  const { combat } = sim
  const { fighters } = combat
  const { x, y } = sim.stores.position
  const lift = sim.config.combat.bars.heroLift
  let next = used

  for (let i = 0; i < fighters.size && next < marks.barPool.length; i++) {
    const eid = fighters.dense[i]!
    const hp = combat.hp[eid]!

    if (hp < 1 && fights(sim, eid) && sim.lifeless[sim.stores.behavior.state[eid]!] !== 1) {
      const sx = screenX(x[eid]!, y[eid]!)
      const sy = screenY(x[eid]!, y[eid]!) - lift
      next = bar(marks, sim, next, sx, sy, hp, marks.heroFill)
    }
  }

  return next
}

const monsterBars = (marks: CombatMarks, sim: Sim, used: number, now: number): number => {
  const { monsters } = sim.combat
  const lift = sim.config.combat.bars.monsterLift
  let next = used

  for (let slot = 0; slot < monsters.state.length && next < marks.barPool.length; slot++) {
    const state = monsters.state[slot]!
    const hp = monsters.hp[slot]!
    const max = monsters.maxHp[slot]!

    if ((state === MONSTER_IDLE || state === MONSTER_ATTACK) && hp < max) {
      backOffset(sim, slot, now, BACK)
      const mx = monsters.x[slot]! + BACK[0]!
      const my = monsters.y[slot]! + BACK[1]!
      next = bar(
        marks,
        sim,
        next,
        screenX(mx, my),
        screenY(mx, my) - lift,
        hp / max,
        marks.monsterFill,
      )
    }
  }

  return next
}

const digitCount = (value: number): number => {
  let count = 1
  let rest = Math.floor(value / RADIX)

  while (rest > 0) {
    count += 1
    rest = Math.floor(rest / RADIX)
  }

  return count
}

const scaleOf = (sim: Sim, style: number, t: number): number => {
  const tuning = sim.config.combat.numbers

  if (style === DAMAGE_CRIT) {
    return tuning.critScale * (1 + POP * Math.max(0, 1 - t / POP_SHARE))
  }

  return style === DAMAGE_WISP ? tuning.wispScale : tuning.scale
}

const number = (marks: CombatMarks, sim: Sim, index: number, used: number, now: number): number => {
  const { damage } = sim.combat
  const tuning = sim.config.combat.numbers
  const t = (now - damage.at[index]!) / tuning.lifeMs
  const value = Math.max(1, Math.round(damage.value[index]!))
  const count = Math.min(tuning.digits, digitCount(value))

  if (used + count > marks.glyphPool.length) {
    return used
  }

  const style = damage.style[index]!
  const scale = scaleOf(sim, style, t)
  const advance = marks.advance * scale
  const x = damage.x[index]!
  const y = damage.y[index]!
  const rise = 1 - (1 - t) * (1 - t)
  const shift = ((index % SPREAD) - (SPREAD - 1) / 2) * tuning.jitter
  const left = screenX(x, y) - (advance * count) / 2 + shift
  const top = screenY(x, y) - tuning.lift - tuning.rise * rise + marks.offsetY * scale
  const alpha = t < FADE_FROM ? 1 : 1 - (t - FADE_FROM) / (1 - FADE_FROM)
  const color = withAlpha(marks.colors[style]!, alpha)
  let rest = value

  for (let place = count - 1; place >= 0; place--) {
    const glyph = marks.glyphPool[used + place]!
    glyph.texture = marks.digits[rest % RADIX]!
    glyph.x = left + place * advance
    glyph.y = top
    glyph.scaleX = marks.glyphScale * scale
    glyph.scaleY = marks.glyphScale * scale
    glyph.color = color
    marks.numbers.particleChildren[used + place] = glyph
    rest = Math.floor(rest / RADIX)
  }

  return used + count
}

const damageNumbers = (marks: CombatMarks, sim: Sim, now: number): number => {
  const { damage } = sim.combat
  const life = sim.config.combat.numbers.lifeMs
  const size = damage.at.length
  let used = 0

  for (let step = 1; step <= size; step++) {
    const index = (damage.head - step + size) % size
    const age = now - damage.at[index]!

    if (age >= 0 && age < life) {
      used = number(marks, sim, index, used, now)
    }
  }

  return used
}

export const syncCombatMarks = (marks: CombatMarks, sim: Sim, now: number): void => {
  const open = sim.combat.rooms.guild !== NO_ROOM
  const bars = open ? monsterBars(marks, sim, heroBars(marks, sim, 0), now) : 0
  marks.bars.particleChildren.length = bars
  marks.numbers.particleChildren.length = damageNumbers(marks, sim, now)
}
