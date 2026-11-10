import { aimEffect, endEffect, spawnEffect, spawnEffectAt } from '../effects/emitters.ts'
import { BOLT_KIND, CRIT_KIND, FRENZY_KIND, HEAL_KIND, SLASH_KIND } from '../effects/systems.ts'
import { sceneLength } from './death-scene.ts'
import { roomDistance, startWalk, walkTo } from './delve.ts'
import { addMember, hasMember, removeMember } from './dense-set.ts'
import { dungeonSeed, walkable, type DungeonMap } from './dungeon-gen.ts'
import { cellAt, cellWorld, dungeonAt, roomCenter, slotOf } from './dungeon.ts'
import { directionOf, screenX, screenY } from './iso.ts'
import {
  MONSTER_ATTACK,
  MONSTER_CRUMBLE,
  MONSTER_FREE,
  MONSTER_IDLE,
  MONSTER_RISING,
  NO_EFFECT,
  NO_ROOM,
  NO_TARGET,
  intensityTier,
} from './monsters.ts'
import type { Sim } from './sim.ts'
import type { System } from './system.ts'

const UNCLAIMED = -1
const DIRECTIONS = 8
const FULL_TURN = Math.PI * 2
const ANGLE_JITTER = 0.6
const RADIUS_MIN = 0.45
const PLACE_TRIES = 3
const FIRST_SWING_SHARE = 0.5
const SWING_JITTER = 0.3
const UNIT = 4_294_967_296

const mix = (a: number, b: number): number => {
  let hash = Math.imul(a ^ Math.imul(b, 0x9e_37_79_b1), 0x85_eb_ca_6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2_b2_ae_35)

  return (hash ^ (hash >>> 16)) >>> 0
}

const lifeless = (sim: Sim, eid: number): boolean =>
  sim.lifeless[sim.stores.behavior.state[eid]!] === 1

const fights = (sim: Sim, eid: number): boolean => {
  const { behavior, delve, hero } = sim.stores
  const { view } = sim.dungeons

  return (
    behavior.state[eid] === sim.dungeons.delving &&
    delve.placed[eid] === 1 &&
    hero.guild[eid] === view.guild &&
    delve.tier[eid] === view.tier
  )
}

const heroesIn = (sim: Sim, room: number): number => {
  const { fighters } = sim.combat
  let count = 0

  for (let i = 0; i < fighters.size; i++) {
    if (sim.stores.delve.room[fighters.dense[i]!] === room) {
      count += 1
    }
  }

  return count
}

const freeSlot = (sim: Sim): number => {
  const { state } = sim.combat.monsters

  for (let slot = 0; slot < state.length; slot++) {
    if (state[slot] === MONSTER_FREE) {
      return slot
    }
  }

  return NO_TARGET
}

const placeMonster = (
  sim: Sim,
  map: DungeonMap,
  room: number,
  hash: number,
  angle: number,
  slot: number,
): void => {
  const { monsters, rooms } = sim.combat
  const { spread } = sim.config.combat.pack
  cellWorld(sim, map, rooms.guild, roomCenter(map, room), sim.scratch)
  const cx = sim.scratch[0]!
  const cy = sim.scratch[1]!
  let radius = spread * (RADIUS_MIN + (1 - RADIUS_MIN) * ((hash & 0xff_ff) / 0xff_ff))

  for (let attempt = 0; attempt < PLACE_TRIES; attempt++) {
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    const cell = cellAt(sim, map, rooms.guild, x, y)

    if (cell >= 0 && map.roomOf[cell] === room && walkable(map.cells[cell]!)) {
      monsters.x[slot] = x
      monsters.y[slot] = y

      return
    }

    radius /= 2
  }

  monsters.x[slot] = cx
  monsters.y[slot] = cy
}

export const spawnPack = (
  sim: Sim,
  map: DungeonMap,
  room: number,
  rising: boolean,
  now: number,
): number => {
  const tuning = sim.config.combat
  const { monsters, rooms } = sim.combat
  const size = Math.min(
    tuning.pack.max,
    tuning.pack.base + tuning.pack.perHero * heroesIn(sim, room),
  )
  const seed = mix(
    mix(dungeonSeed(sim.config.seed, sim.groups.guildKeys[rooms.guild] ?? '', rooms.tier), room),
    rooms.packs[room]!,
  )
  rooms.packs[room] = rooms.packs[room]! + 1
  let spawned = 0

  for (let index = 0; index < size; index++) {
    const slot = freeSlot(sim)

    if (slot === NO_TARGET) {
      sim.combat.counters.skipped += size - index

      break
    }

    const hash = mix(seed, index)
    const kind = hash % tuning.monsters.length
    const angle = (index / size) * FULL_TURN + (mix(hash, 1) / UNIT) * ANGLE_JITTER
    placeMonster(sim, map, room, mix(hash, 2), angle, slot)
    monsters.kind[slot] = kind
    monsters.room[slot] = room
    monsters.state[slot] = rising ? MONSTER_RISING : MONSTER_IDLE
    monsters.since[slot] = now
    monsters.maxHp[slot] = tuning.monsterHp[rooms.tier]! * tuning.monsters[kind]!.hp
    monsters.hp[slot] = monsters.maxHp[slot]!
    monsters.dir[slot] = mix(hash, 3) % DIRECTIONS
    monsters.target[slot] = NO_TARGET
    monsters.nextSwing[slot] = 0
    monsters.hitAt[slot] = Number.NEGATIVE_INFINITY
    monsters.active += 1
    spawned += 1
  }

  rooms.alive[room] = rooms.alive[room]! + spawned

  return spawned
}

const freeMonster = (sim: Sim, slot: number): void => {
  const { monsters } = sim.combat
  monsters.state[slot] = MONSTER_FREE
  monsters.room[slot] = NO_ROOM
  monsters.target[slot] = NO_TARGET
  monsters.active -= 1
}

const endGlow = (sim: Sim, eid: number): void => {
  const { combat } = sim
  endEffect(sim, combat.glowOf[eid]!)
  combat.glowOf[eid] = NO_EFFECT
  removeMember(combat.glowing, eid)
}

const endGlows = (sim: Sim): void => {
  const { glowing } = sim.combat

  while (glowing.size > 0) {
    endGlow(sim, glowing.dense[glowing.size - 1]!)
  }
}

export const resetCombat = (sim: Sim): void => {
  const { monsters, rooms } = sim.combat
  endGlows(sim)

  for (let slot = 0; slot < monsters.state.length; slot++) {
    if (monsters.state[slot] !== MONSTER_FREE) {
      freeMonster(sim, slot)
    }
  }

  rooms.alive.fill(0)
  rooms.clearedAt.fill(0)
  rooms.refillAt.fill(0)
  rooms.holdUntil.fill(0)
  rooms.packs.fill(0)
  rooms.count = 0
  rooms.guild = NO_ROOM
  rooms.tier = NO_ROOM
}

export const openCombat = (sim: Sim, guild: number, tier: number, now: number): void => {
  resetCombat(sim)
  const map = dungeonAt(sim, guild, tier)
  const claims = sim.dungeons.claims[slotOf(sim, guild, tier)]

  if (map === undefined || claims === undefined) {
    return
  }

  const { rooms } = sim.combat
  rooms.guild = guild
  rooms.tier = tier
  rooms.count = Math.min(map.rooms, sim.config.combat.maxRooms)

  for (const claimed of [true, false]) {
    for (let room = 0; room < rooms.count; room++) {
      if ((claims[room] !== UNCLAIMED) === claimed) {
        spawnPack(sim, map, room, false, now)
      }
    }
  }
}

export const heroDamage = (sim: Sim, eid: number): number => {
  const tuning = sim.config.combat
  const { tier } = sim.combat.rooms
  const tiers = sim.config.depthTiers
  const from = tiers[tier]?.fromLevel ?? 1
  const to = tiers[tier + 1]?.fromLevel ?? from + tuning.levelSpan
  const progress = Math.min(1, Math.max(0, (sim.stores.hero.level[eid]! - from) / (to - from)))

  return tuning.monsterHp[tier]! * tuning.packShare * (1 + tuning.levelBonus * progress)
}

const targetable = (sim: Sim, slot: number, room: number): boolean => {
  const { monsters } = sim.combat
  const state = monsters.state[slot]!

  return (
    slot !== NO_TARGET &&
    monsters.room[slot] === room &&
    (state === MONSTER_IDLE || state === MONSTER_ATTACK)
  )
}

const pickTarget = (sim: Sim, eid: number, room: number): number => {
  const { monsters } = sim.combat
  const hx = sim.stores.position.x[eid]!
  const hy = sim.stores.position.y[eid]!
  let best = NO_TARGET
  let bestDistance = Number.POSITIVE_INFINITY

  for (let slot = 0; slot < monsters.state.length; slot++) {
    if (targetable(sim, slot, room)) {
      const distance = Math.hypot(monsters.x[slot]! - hx, monsters.y[slot]! - hy)

      if (distance < bestDistance) {
        best = slot
        bestDistance = distance
      }
    }
  }

  return best
}

const reachOf = (sim: Sim, eid: number): number => {
  const { reach, rangedSheet } = sim.config.combat

  return rangedSheet[sim.stores.hero.sheet[eid]!] === 1 ? reach.ranged : reach.melee
}

const approach = (sim: Sim, eid: number, slot: number, map: DungeonMap): boolean => {
  const { monsters, rooms } = sim.combat
  const { reach } = sim.config.combat
  const hx = sim.stores.position.x[eid]!
  const hy = sim.stores.position.y[eid]!
  const mx = monsters.x[slot]!
  const my = monsters.y[slot]!
  const distance = Math.hypot(hx - mx, hy - my)
  let wanted = reachOf(sim, eid)

  if (distance <= wanted + reach.slack) {
    return false
  }

  const angle = Math.atan2(hy - my, hx - mx) + ((eid % 5) - 2) * reach.spread

  for (let attempt = 0; attempt < PLACE_TRIES; attempt++) {
    const x = mx + Math.cos(angle) * wanted
    const y = my + Math.sin(angle) * wanted
    const cell = cellAt(sim, map, rooms.guild, x, y)

    if (cell >= 0 && walkable(map.cells[cell]!)) {
      walkTo(sim, eid, x, y)

      return true
    }

    wanted /= 2
  }

  return false
}

const roomCleared = (sim: Sim, room: number, now: number): void => {
  const { combat } = sim
  const { fighters } = combat
  combat.rooms.clearedAt[room] = now
  combat.counters.cleared += 1

  for (let i = 0; i < fighters.size; i++) {
    const eid = fighters.dense[i]!

    if (sim.stores.delve.room[eid] === room) {
      combat.hp[eid] = 1
      spawnEffect(sim, HEAL_KIND, eid, now)
    }
  }
}

export const hitMonster = (
  sim: Sim,
  slot: number,
  damage: number,
  crit: boolean,
  eid: number,
  now: number,
): void => {
  const { monsters, rooms } = sim.combat
  monsters.hp[slot] = monsters.hp[slot]! - damage
  monsters.hitAt[slot] = now
  monsters.hitCrit[slot] = crit ? 1 : 0

  if (monsters.target[slot] === NO_TARGET) {
    monsters.target[slot] = eid
    monsters.nextSwing[slot] = now + sim.config.combat.monsterSwingMs * FIRST_SWING_SHARE
  }

  if (monsters.hp[slot] > 0) {
    return
  }

  const room = monsters.room[slot]!
  monsters.hp[slot] = 0
  monsters.state[slot] = MONSTER_CRUMBLE
  monsters.since[slot] = now
  monsters.target[slot] = NO_TARGET
  rooms.alive[room] = rooms.alive[room]! - 1

  if (rooms.alive[room] === 0) {
    roomCleared(sim, room, now)
  }
}

const attackEffects = (sim: Sim, eid: number, slot: number, crit: boolean, now: number): void => {
  const { monsters } = sim.combat
  const hx = sim.stores.position.x[eid]!
  const hy = sim.stores.position.y[eid]!
  const mx = monsters.x[slot]!
  const my = monsters.y[slot]!
  const ranged = sim.config.combat.rangedSheet[sim.stores.hero.sheet[eid]!] === 1
  const effect = spawnEffect(sim, ranged ? BOLT_KIND : SLASH_KIND, eid, now)

  if (effect !== -1) {
    aimEffect(sim, effect, screenX(mx, my) - screenX(hx, hy), screenY(mx, my) - screenY(hx, hy))
  }

  if (crit) {
    spawnEffectAt(sim, CRIT_KIND, mx, my, now)
  }
}

const swing = (sim: Sim, eid: number, slot: number, now: number): void => {
  const { combat } = sim
  const tuning = sim.config.combat
  const tier = tuning.tiers[intensityTier(sim, eid, now)]!
  const regular = now >= combat.nextSwing[eid]!
  const bonus = combat.bonus[eid]! > 0 && now - combat.swingAt[eid]! >= tuning.bonusGapMs

  if (regular) {
    combat.nextSwing[eid] = now + tier.swingMs
  } else if (bonus) {
    combat.bonus[eid] = combat.bonus[eid]! - 1
  } else {
    return
  }

  const crit = sim.random() < tier.crit
  combat.swingAt[eid] = now
  combat.swingCrit[eid] = crit ? 1 : 0
  combat.counters.swings += 1
  combat.counters.crits += crit ? 1 : 0
  attackEffects(sim, eid, slot, crit, now)
  hitMonster(sim, slot, heroDamage(sim, eid) * (crit ? tuning.critMultiplier : 1), crit, eid, now)
}

const strike = (sim: Sim, eid: number, slot: number, now: number): void => {
  const { combat } = sim
  const tuning = sim.config.combat

  if (combat.strikes[eid] === 0 || now - combat.strikeAt[eid]! < tuning.minionGapMs) {
    return
  }

  combat.strikes[eid] = combat.strikes[eid]! - 1
  combat.strikeAt[eid] = now
  combat.counters.strikes += 1
  hitMonster(sim, slot, heroDamage(sim, eid) * tuning.minionShare, false, eid, now)
}

const face = (sim: Sim, eid: number, slot: number): void => {
  const { monsters } = sim.combat
  sim.stores.motion.dir[eid] = directionOf(
    monsters.x[slot]! - sim.stores.position.x[eid]!,
    monsters.y[slot]! - sim.stores.position.y[eid]!,
  )
}

const dropFighter = (sim: Sim, eid: number, now: number): void => {
  const { combat } = sim
  const { monsters, rooms } = combat
  const room = sim.stores.delve.room[eid]!
  removeMember(combat.fighters, eid)
  combat.target[eid] = NO_TARGET

  for (let slot = 0; slot < monsters.target.length; slot++) {
    if (monsters.target[slot] === eid) {
      monsters.target[slot] = NO_TARGET
    }
  }

  if (lifeless(sim, eid) && room < rooms.count) {
    rooms.holdUntil[room] = now + sceneLength(sim.config.death.scene)
  }
}

const fight = (sim: Sim, eid: number, map: DungeonMap, now: number): void => {
  const { combat } = sim
  const room = sim.stores.delve.room[eid]!
  const { rooms } = combat
  const waiting = room >= rooms.count || rooms.alive[room] === 0 || now < rooms.holdUntil[room]!

  if (waiting || sim.stores.delve.walking[eid] !== 0) {
    combat.target[eid] = NO_TARGET

    return
  }

  let slot = combat.target[eid]!

  if (!targetable(sim, slot, room)) {
    slot = pickTarget(sim, eid, room)
    combat.target[eid] = slot
  }

  if (slot === NO_TARGET || hasMember(sim.moving, eid) || approach(sim, eid, slot, map)) {
    return
  }

  face(sim, eid, slot)
  swing(sim, eid, slot, now)

  if (targetable(sim, slot, room)) {
    strike(sim, eid, slot, now)
  }
}

const glowFrenzy = (sim: Sim, now: number): void => {
  const { combat } = sim
  const { fighters, glowing, glowOf } = combat
  const top = sim.config.combat.tiers.length - 1

  for (let i = glowing.size - 1; i >= 0; i--) {
    const eid = glowing.dense[i]!

    if (!hasMember(fighters, eid) || lifeless(sim, eid) || intensityTier(sim, eid, now) < top) {
      endGlow(sim, eid)
    }
  }

  for (let i = 0; i < fighters.size; i++) {
    const eid = fighters.dense[i]!

    if (glowOf[eid] !== NO_EFFECT || lifeless(sim, eid) || intensityTier(sim, eid, now) < top) {
      continue
    }

    const effect = spawnEffect(sim, FRENZY_KIND, eid, now)

    if (effect !== -1) {
      glowOf[eid] = effect
      addMember(glowing, eid)
    }
  }
}

const heroesFight = (sim: Sim, map: DungeonMap, now: number): void => {
  const { fighters } = sim.combat

  for (let i = fighters.size - 1; i >= 0; i--) {
    const eid = fighters.dense[i]!

    if (fights(sim, eid)) {
      fight(sim, eid, map, now)
    } else {
      dropFighter(sim, eid, now)
    }
  }
}

const monsterSwing = (sim: Sim, slot: number, now: number): void => {
  const { combat } = sim
  const { monsters } = combat
  const tuning = sim.config.combat
  const eid = monsters.target[slot]!
  const [low, high] = tuning.monsterHit
  monsters.dir[slot] = directionOf(
    sim.stores.position.x[eid]! - monsters.x[slot]!,
    sim.stores.position.y[eid]! - monsters.y[slot]!,
  )

  if (now < monsters.nextSwing[slot]!) {
    return
  }

  monsters.nextSwing[slot] =
    now + tuning.monsterSwingMs * (1 - SWING_JITTER / 2 + sim.random() * SWING_JITTER)
  monsters.state[slot] = MONSTER_ATTACK
  monsters.since[slot] = now
  const hit = low! + sim.random() * (high! - low!)
  combat.hp[eid] = Math.max(tuning.hpFloor, combat.hp[eid]! - hit)
}

const monsterStep = (sim: Sim, slot: number, now: number): void => {
  const { combat } = sim
  const { monsters, rooms } = combat
  const tuning = sim.config.combat
  const state = monsters.state[slot]!
  const elapsed = now - monsters.since[slot]!

  if (state === MONSTER_RISING && elapsed >= tuning.riseMs) {
    monsters.state[slot] = MONSTER_IDLE
  } else if (state === MONSTER_CRUMBLE && elapsed >= tuning.crumbleMs) {
    freeMonster(sim, slot)
  } else if (state === MONSTER_IDLE || state === MONSTER_ATTACK) {
    if (state === MONSTER_ATTACK && elapsed >= tuning.attackMs) {
      monsters.state[slot] = MONSTER_IDLE
    }

    const room = monsters.room[slot]!
    const eid = monsters.target[slot]!

    if (eid === NO_TARGET) {
      return
    }

    const gone = !hasMember(combat.fighters, eid) || sim.stores.delve.room[eid] !== room

    if (gone || now < rooms.holdUntil[room]!) {
      monsters.target[slot] = NO_TARGET
    } else {
      monsterSwing(sim, slot, now)
    }
  }
}

const moveParty = (sim: Sim, map: DungeonMap, room: number): void => {
  const { combat } = sim
  const { rooms, fighters } = combat
  const claims = sim.dungeons.claims[slotOf(sim, rooms.guild, rooms.tier)]!
  const party = claims[room]!
  let best = NO_ROOM
  let bestDistance = Number.POSITIVE_INFINITY

  for (let next = 0; next < rooms.count; next++) {
    if (next !== room && rooms.alive[next]! > 0 && claims[next] === UNCLAIMED) {
      const distance = roomDistance(sim, rooms.guild, map, room, next)

      if (distance >= 0 && distance < bestDistance) {
        best = next
        bestDistance = distance
      }
    }
  }

  if (best === NO_ROOM) {
    return
  }

  claims[room] = UNCLAIMED
  claims[best] = party

  for (let i = 0; i < fighters.size; i++) {
    const eid = fighters.dense[i]!

    if (sim.stores.delve.room[eid] === room && sim.stores.hero.party[eid] === party) {
      sim.stores.delve.room[eid] = best
      combat.target[eid] = NO_TARGET
      startWalk(sim, eid, best)
    }
  }
}

const roomFlow = (sim: Sim, map: DungeonMap, now: number): void => {
  const { rooms } = sim.combat
  const tuning = sim.config.combat
  const claims = sim.dungeons.claims[slotOf(sim, rooms.guild, rooms.tier)]!

  for (let room = 0; room < rooms.count; room++) {
    if (rooms.alive[room]! > 0) {
      continue
    }

    if (rooms.clearedAt[room]! > 0 && now - rooms.clearedAt[room]! >= tuning.moveOnMs) {
      rooms.clearedAt[room] = 0
      rooms.refillAt[room] = now + tuning.refillMs

      if (claims[room] !== UNCLAIMED) {
        moveParty(sim, map, room)
      }
    }

    const due = rooms.refillAt[room]! > 0 && now >= rooms.refillAt[room]!
    const stuck = now >= rooms.refillAt[room]! + tuning.refillMs

    if (due && (claims[room] === UNCLAIMED || stuck)) {
      rooms.refillAt[room] = spawnPack(sim, map, room, true, now) > 0 ? 0 : now + tuning.refillMs
    }
  }
}

export const combatSystem: System = {
  name: 'combat',
  complexity: 'O(fighting heroes + budgets.monsters) while a Dungeon is open, else O(1)',
  run: (sim, now) => {
    const { view } = sim.dungeons
    const { rooms, monsters } = sim.combat

    if (view.guild < 0) {
      if (rooms.guild !== NO_ROOM) {
        resetCombat(sim)
      }

      return
    }

    if (rooms.guild !== view.guild || rooms.tier !== view.tier) {
      openCombat(sim, view.guild, view.tier, now)
    }

    const map = dungeonAt(sim, view.guild, view.tier)

    if (map === undefined || rooms.count === 0) {
      return
    }

    heroesFight(sim, map, now)
    glowFrenzy(sim, now)

    for (let slot = 0; slot < monsters.state.length; slot++) {
      if (monsters.state[slot] !== MONSTER_FREE) {
        monsterStep(sim, slot, now)
      }
    }

    roomFlow(sim, map, now)
  },
}

export const lungeOffset = (sim: Sim, eid: number, now: number, out: Float64Array): void => {
  const { combat } = sim
  const tuning = sim.config.combat
  const elapsed = now - combat.swingAt[eid]!
  const slot = combat.target[eid]!
  out[0] = 0
  out[1] = 0

  if (elapsed >= tuning.lungeMs || slot === NO_TARGET || !hasMember(combat.fighters, eid)) {
    return
  }

  const dx = combat.monsters.x[slot]! - sim.stores.position.x[eid]!
  const dy = combat.monsters.y[slot]! - sim.stores.position.y[eid]!
  const distance = Math.hypot(dx, dy)

  if (distance === 0) {
    return
  }

  const push = Math.sin((elapsed / tuning.lungeMs) * Math.PI) * tuning.lunge
  out[0] = (dx / distance) * push
  out[1] = (dy / distance) * push
}
