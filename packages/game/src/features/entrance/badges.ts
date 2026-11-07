import { BitmapText, Container, Graphics, GraphicsContext } from 'pixi.js'
import world from '@tokenfall/data/world.json'
import { displayName, titleOf } from '../../core/character.ts'
import { stateFlags } from '../../core/fsm.ts'
import { NONE } from '../../core/hero-index.ts'
import { NO_PLOT } from '../../core/layout.ts'
import type { Sim } from '../../core/sim.ts'
import { screenX, screenY } from '../../core/iso.ts'
import type { Screen } from '../../render/camera.ts'

export type Badge = {
  readonly box: Container
  readonly pips: readonly Graphics[]
  readonly count: BitmapText
  shown: number
}

export type Badges = {
  readonly container: Container
  readonly back: GraphicsContext
  readonly pip: GraphicsContext
  readonly badges: Badge[]
  readonly counts: Uint16Array
  readonly inside: Uint8Array
  readonly sx: Float32Array
  readonly sy: Float32Array
  nextCount: number
}

const { entrance: tuning, fonts } = world

const TIER_COLORS = [0x8a_9b_b5, 0xa8_7a_4a, 0xd9_cf_b0, 0xd8_4a_3a] as const
const WIDTH = 92
const HEIGHT = 34
const HOVER_REACH = 40
const UNLIT = 0x2a_24_30

export const createBadges = (sim: Sim): Badges => {
  const guilds = sim.config.budgets.guilds

  return {
    container: new Container({ label: 'entrance-badges' }),
    back: new GraphicsContext()
      .roundRect(-WIDTH / 2, -HEIGHT, WIDTH, HEIGHT, 4)
      .fill({ color: 0x10_0d_16, alpha: 0.85 })
      .stroke({ width: 1, color: 0x4a_3f_55 }),
    pip: new GraphicsContext().circle(0, 0, tuning.pip / 2).fill(0xff_ff_ff),
    badges: [],
    counts: new Uint16Array(guilds * tuning.tiers),
    inside: stateFlags(sim.machine, ['warping-in', 'delving']),
    sx: new Float32Array(guilds),
    sy: new Float32Array(guilds),
    nextCount: 0,
  }
}

const tierOf = (level: number): number =>
  Math.min(tuning.tiers - 1, Math.floor((level - 1) / tuning.tierLevels))

const count = (badges: Badges, sim: Sim): void => {
  const { index } = sim
  const { hero, behavior } = sim.stores
  badges.counts.fill(0)

  for (let slot = 0; slot < index.nextSlot; slot++) {
    const eid = index.entityOf[slot]!

    if (eid !== NONE && badges.inside[behavior.state[eid]!] === 1) {
      const cell = hero.guild[eid]! * tuning.tiers + tierOf(hero.level[eid]!)
      badges.counts[cell] = badges.counts[cell]! + 1
    }
  }
}

const badgeFor = (badges: Badges, guild: number): Badge => {
  while (badges.badges.length <= guild) {
    const box = new Container()
    const back = new Graphics(badges.back)
    const pips = Array.from({ length: tuning.tiers }, (_slot, tier) => {
      const pip = new Graphics(badges.pip)
      pip.position.set(-((tuning.tiers - 1) * tuning.pip) / 2 + tier * tuning.pip * 1.6 - 4, -7)
      pip.tint = UNLIT

      return pip
    })
    const label = new BitmapText({
      text: '',
      style: { fontFamily: fonts.pixel, fontSize: fonts.pixelSize, fill: '#eadfc4' },
    })
    label.anchor.set(0.5, 0)
    label.position.set(0, -HEIGHT + 3)
    box.addChild(back, label, ...pips)
    box.visible = false
    badges.container.addChild(box)
    badges.badges.push({ box, pips, count: label, shown: -1 })
  }

  return badges.badges[guild]!
}

const paint = (badge: Badge, total: number, lit: number): void => {
  if (badge.shown >> 4 !== total) {
    badge.count.text = `${total} inside`
  }

  badge.shown = total * 16 + lit

  for (let tier = 0; tier < tuning.tiers; tier++) {
    badge.pips[tier]!.tint = (lit >> tier) & 1 ? TIER_COLORS[tier]! : UNLIT
  }
}

export const syncBadges = (badges: Badges, sim: Sim, screen: Screen, now: number): void => {
  if (now >= badges.nextCount) {
    badges.nextCount = now + tuning.everyMs
    count(badges, sim)
  }

  const { town } = sim

  for (let guild = 0; guild < sim.groups.guildKeys.length; guild++) {
    const plot = town.plotOfGuild[guild]!
    const badge = badgeFor(badges, guild)
    let total = 0
    let lit = 0

    for (let tier = 0; tier < tuning.tiers; tier++) {
      const inside = badges.counts[guild * tuning.tiers + tier]!
      total += inside
      lit |= inside > 0 ? 1 << tier : 0
    }

    if (plot === NO_PLOT || total === 0) {
      badge.box.visible = false
      continue
    }

    if (badge.shown !== total * 16 + lit) {
      paint(badge, total, lit)
    }

    const ex = town.entranceX[plot]!
    const ey = town.entranceY[plot]!
    const sx = (screenX(ex, ey) - screen.x) * screen.zoom + screen.width / 2
    const sy =
      (screenY(ex, ey) - screen.y) * screen.zoom + screen.height / 2 - tuning.offsetY * screen.zoom
    badges.sx[guild] = sx
    badges.sy[guild] = sy
    badge.box.visible =
      sx > -WIDTH && sx < screen.width + WIDTH && sy > 0 && sy < screen.height + HEIGHT
    badge.box.position.set(Math.round(sx), Math.round(sy))
  }
}

export const overlapsBadge = (
  badges: Badges,
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
): boolean => {
  for (let guild = 0; guild < badges.badges.length; guild++) {
    if (
      badges.badges[guild]!.box.visible &&
      Math.abs(badges.sx[guild]! - x) < halfWidth + WIDTH / 2 &&
      Math.abs(badges.sy[guild]! - HEIGHT / 2 - y) < halfHeight + HEIGHT / 2
    ) {
      return true
    }
  }

  return false
}

export const badgeAt = (badges: Badges, pointerX: number, pointerY: number): number => {
  for (let guild = 0; guild < badges.badges.length; guild++) {
    const badge = badges.badges[guild]!

    if (
      badge.box.visible &&
      Math.abs(badges.sx[guild]! - pointerX) < HOVER_REACH &&
      Math.abs(badges.sy[guild]! - HEIGHT / 2 - pointerY) < HOVER_REACH / 2
    ) {
      return guild
    }
  }

  return NONE
}

export const namesInside = (badges: Badges, sim: Sim, guild: number): string[] => {
  const { index } = sim
  const names: string[] = []

  for (let slot = 0; slot < index.nextSlot; slot++) {
    const eid = index.entityOf[slot]!

    if (
      eid !== NONE &&
      sim.stores.hero.guild[eid] === guild &&
      badges.inside[sim.stores.behavior.state[eid]!] === 1
    ) {
      names.push(
        `${displayName(sim.text.name[eid]!, titleOf(sim.text.title[eid]!))} · Lv ${sim.stores.hero.level[eid]!}`,
      )
    }
  }

  return names
}
