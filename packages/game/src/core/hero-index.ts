export type HeroIndex = {
  readonly slotOf: Map<string, number>
  readonly idOf: string[]
  readonly entityOf: Int32Array
  readonly slotOfEntity: Int32Array
  readonly free: Uint32Array
  freeCount: number
  nextSlot: number
}

export const NONE = -1

export const createHeroIndex = (heroes: number, entities: number): HeroIndex => ({
  slotOf: new Map(),
  idOf: Array.from({ length: heroes }, () => ''),
  entityOf: new Int32Array(new SharedArrayBuffer(heroes * 4)).fill(NONE),
  slotOfEntity: new Int32Array(new SharedArrayBuffer(entities * 4)).fill(NONE),
  free: new Uint32Array(heroes),
  freeCount: 0,
  nextSlot: 0,
})

export const entityOfHero = (index: HeroIndex, id: string): number => {
  const slot = index.slotOf.get(id)

  return slot === undefined ? NONE : index.entityOf[slot]!
}

export const heroOfEntity = (index: HeroIndex, eid: number): string => {
  const slot = index.slotOfEntity[eid]!

  return slot === NONE ? '' : index.idOf[slot]!
}

const takeSlot = (index: HeroIndex): number => {
  if (index.freeCount > 0) {
    index.freeCount -= 1

    return index.free[index.freeCount]!
  }

  if (index.nextSlot >= index.entityOf.length) {
    return NONE
  }

  index.nextSlot += 1

  return index.nextSlot - 1
}

export const bindHero = (index: HeroIndex, id: string, eid: number): boolean => {
  if (index.slotOf.has(id) || eid >= index.slotOfEntity.length) {
    return false
  }

  const slot = takeSlot(index)

  if (slot === NONE) {
    return false
  }

  index.slotOf.set(id, slot)
  index.idOf[slot] = id
  index.entityOf[slot] = eid
  index.slotOfEntity[eid] = slot

  return true
}

export const unbindHero = (index: HeroIndex, id: string): number => {
  const slot = index.slotOf.get(id)

  if (slot === undefined) {
    return NONE
  }

  const eid = index.entityOf[slot]!
  index.slotOf.delete(id)
  index.idOf[slot] = ''
  index.entityOf[slot] = NONE
  index.slotOfEntity[eid] = NONE
  index.free[index.freeCount] = slot
  index.freeCount += 1

  return eid
}

export const rekeyHero = (index: HeroIndex, from: string, to: string): boolean => {
  const slot = index.slotOf.get(from)

  if (slot === undefined || index.slotOf.has(to)) {
    return false
  }

  index.slotOf.delete(from)
  index.slotOf.set(to, slot)
  index.idOf[slot] = to

  return true
}

export const heroCount = (index: HeroIndex): number => index.slotOf.size
