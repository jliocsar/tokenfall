export type DenseSet = {
  readonly dense: Uint32Array
  readonly sparse: Int32Array
  size: number
}

export const createDenseSet = (capacity: number): DenseSet => ({
  dense: new Uint32Array(capacity),
  sparse: new Int32Array(capacity).fill(-1),
  size: 0,
})

export const hasMember = (set: DenseSet, value: number): boolean => set.sparse[value]! !== -1

export const addMember = (set: DenseSet, value: number): void => {
  if (set.sparse[value]! !== -1) {
    return
  }

  set.sparse[value] = set.size
  set.dense[set.size] = value
  set.size += 1
}

export const removeMember = (set: DenseSet, value: number): void => {
  const index = set.sparse[value]!

  if (index === -1) {
    return
  }

  set.size -= 1
  const last = set.dense[set.size]!
  set.dense[index] = last
  set.sparse[last] = index
  set.sparse[value] = -1
}
