import { BitmapText, Container, Graphics } from 'pixi.js'
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
  readonly back: Graphics
  readonly count: BitmapText
  shown: number
}

export type Badges = {
  readonly container: Container
  readonly badges: Badge[]
  readonly counts: Uint16Array
  readonly inside: Uint8Array
  readonly sx: Float32Array
  readonly sy: Float32Array
  nextCount: number
}

const { entrance: tuning } = world

const TIER_COLORS = [0x8a_9b_b5, 0xa8_7a_4a, 0xd9_cf_b0, 0xd8_4a_3a] as const
const WIDTH = 92
const HEIGHT = 34
const HOVER_REACH = 40

export const createBadges = (sim: Sim): Badges => {
  const guilds = sim.config.budgets.guilds

  return {
    container: new Container({ label: 'entrance-badges' }),
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
    const back = new Graphics()
    const label = new BitmapText({
      text: '',
      style: { fontFamily: 'monospace', fontSize: 14, fill: '#eadfc4' },
    })
    label.anchor.set(0.5, 0)
    label.position.set(0, -HEIGHT + 3)
    box.addChild(back, label)
    box.visible = false
    badges.container.addChild(box)
    badges.badges.push({ box, back, count: label, shown: -1 })
  }

  return badges.badges[guild]!
}

const paint = (badges: Badges, badge: Badge, guild: number, total: number): void => {
  badge.shown = total
  badge.count.text = `${total} inside`
  badge.back
    .clear()
    .roundRect(-WIDTH / 2, -HEIGHT, WIDTH, HEIGHT, 4)
    .fill({ color: 0x10_0d_16, alpha: 0.85 })
  badge.back.stroke({ width: 1, color: 0x4a_3f_55 })

  for (let tier = 0; tier < tuning.tiers; tier++) {
    const lit = badges.counts[guild * tuning.tiers + tier]! > 0
    badge.back
      .circle(
        -((tuning.tiers - 1) * tuning.pip) / 2 + tier * tuning.pip * 1.6 - 4,
        -7,
        tuning.pip / 2,
      )
      .fill({ color: lit ? TIER_COLORS[tier]! : 0x2a_24_30 })
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

    for (let tier = 0; tier < tuning.tiers; tier++) {
      total += badges.counts[guild * tuning.tiers + tier]!
    }

    if (plot === NO_PLOT || total === 0) {
      badge.box.visible = false
      continue
    }

    if (badge.shown !== total) {
      paint(badges, badge, guild, total)
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
