import { BitmapFontManager, Container, Graphics, GraphicsContext, Sprite, Texture } from 'pixi.js'
import world from '@tokenfall/data/world.json'
import { screenX, screenY } from '../../core/iso.ts'
import type { Sim } from '../../core/sim.ts'
import { MAX_WISPS } from '../../effects/systems.ts'

type Count = { readonly box: Container; readonly glyphs: readonly Sprite[] }

export type Crowns = {
  readonly container: Container
  readonly crown: GraphicsContext
  readonly crowns: Graphics[]
  readonly counts: Count[]
  readonly textures: readonly Texture[]
  readonly advance: number
  readonly scale: number
  readonly offsetY: number
}

const { marks, fonts } = world

const GOLD = 0xf2_c1_4e
const RIM = 0x5a_3d_10
const JEWEL = 0xd8_4a_3a
const PLUS = 10
const COUNT_GLYPHS = 3
const MAX_COUNT = 99

const crownContext = (): GraphicsContext =>
  new GraphicsContext()
    .poly([-7, 0, -8, -9, -3.5, -4, 0, -11, 3.5, -4, 8, -9, 7, 0])
    .fill(GOLD)
    .stroke({ color: RIM, width: 1.5 })
    .circle(0, -3, 1.6)
    .fill(JEWEL)

const crownAt = (crowns: Crowns, index: number): Graphics => {
  const existing = crowns.crowns[index]

  if (existing !== undefined) {
    return existing
  }

  const crown = new Graphics(crowns.crown)
  crown.scale.set(marks.crownScale)
  crowns.crowns.push(crown)
  crowns.container.addChild(crown)

  return crown
}

const countAt = (crowns: Crowns, index: number): Count => {
  const existing = crowns.counts[index]

  if (existing !== undefined) {
    return existing
  }

  const box = new Container()
  const glyphs = Array.from({ length: COUNT_GLYPHS }, (_unused, place) => {
    const glyph = new Sprite(crowns.textures[PLUS])
    glyph.scale.set(crowns.scale)
    glyph.position.set(place * crowns.advance, crowns.offsetY)

    return glyph
  })
  box.addChild(...glyphs)
  const count = { box, glyphs }
  crowns.counts.push(count)
  crowns.container.addChild(box)

  return count
}

const writeCount = (crowns: Crowns, count: Count, extra: number): void => {
  const shown = Math.min(MAX_COUNT, extra)
  const digits = shown >= 10 ? 2 : 1
  count.glyphs[0]!.texture = crowns.textures[PLUS]!
  count.glyphs[1]!.texture = crowns.textures[digits === 2 ? Math.floor(shown / 10) : shown]!
  count.glyphs[2]!.texture = crowns.textures[shown % 10]!
  count.glyphs[2]!.alpha = digits === 2 ? 1 : 0
  count.box.pivot.x = ((digits + 1) * crowns.advance) / 2
}

export const createCrowns = (): Crowns => {
  const font = BitmapFontManager.install({
    name: 'minion-count',
    style: { fontFamily: fonts.pixel, fontSize: fonts.pixelSize, fill: marks.countColor },
    chars: [['0', '9'], '+'],
  })
  const zero = font.chars['0']!
  const scale = (fonts.pixelSize / font.baseMeasurementFontSize) * marks.countScale

  return {
    container: new Container({ label: 'crowns', isRenderGroup: true }),
    crown: crownContext(),
    crowns: [],
    counts: [],
    textures: [
      ...Array.from(
        { length: 10 },
        (_unused, digit) => font.chars[String(digit)]?.texture ?? Texture.EMPTY,
      ),
      font.chars['+']?.texture ?? Texture.EMPTY,
    ],
    advance: zero.xAdvance * scale,
    scale,
    offsetY: zero.yOffset * scale,
  }
}

export const syncCrowns = (crowns: Crowns, sim: Sim): void => {
  const { x, y } = sim.stores.position
  const { state } = sim.stores.behavior
  let used = 0

  for (let i = 0; i < sim.crowned.size; i++) {
    const eid = sim.crowned.dense[i]!

    if (sim.lifeless[state[eid]!] !== 1) {
      const crown = crownAt(crowns, used)
      crown.alpha = 1
      crown.position.set(screenX(x[eid]!, y[eid]!), screenY(x[eid]!, y[eid]!) - marks.crownLift)
      used += 1
    }
  }

  for (let i = used; i < crowns.crowns.length; i++) {
    crowns.crowns[i]!.alpha = 0
  }

  used = 0

  for (let i = 0; i < sim.swarmed.size; i++) {
    const eid = sim.swarmed.dense[i]!
    const count = countAt(crowns, used)
    writeCount(crowns, count, sim.stores.hero.minions[eid]! - MAX_WISPS)
    count.box.alpha = 1
    count.box.position.set(screenX(x[eid]!, y[eid]!), screenY(x[eid]!, y[eid]!) - marks.countLift)
    used += 1
  }

  for (let i = used; i < crowns.counts.length; i++) {
    crowns.counts[i]!.box.alpha = 0
  }
}
