export type TimerHeap = {
  readonly deadline: Float64Array
  readonly eid: Uint32Array
  readonly serial: Uint32Array
  readonly kind: Uint8Array
  size: number
  dropped: number
}

export const createTimerHeap = (capacity: number): TimerHeap => ({
  deadline: new Float64Array(capacity),
  eid: new Uint32Array(capacity),
  serial: new Uint32Array(capacity),
  kind: new Uint8Array(capacity),
  size: 0,
  dropped: 0,
})

const swap = (heap: TimerHeap, a: number, b: number): void => {
  const deadline = heap.deadline[a]!
  const eid = heap.eid[a]!
  const serial = heap.serial[a]!
  const kind = heap.kind[a]!
  heap.deadline[a] = heap.deadline[b]!
  heap.eid[a] = heap.eid[b]!
  heap.serial[a] = heap.serial[b]!
  heap.kind[a] = heap.kind[b]!
  heap.deadline[b] = deadline
  heap.eid[b] = eid
  heap.serial[b] = serial
  heap.kind[b] = kind
}

export const schedule = (
  heap: TimerHeap,
  deadline: number,
  eid: number,
  serial: number,
  kind: number,
): boolean => {
  if (heap.size >= heap.deadline.length) {
    heap.dropped += 1

    return false
  }

  let child = heap.size
  heap.deadline[child] = deadline
  heap.eid[child] = eid
  heap.serial[child] = serial
  heap.kind[child] = kind
  heap.size += 1

  while (child > 0) {
    const parent = (child - 1) >> 1

    if (heap.deadline[parent]! <= heap.deadline[child]!) {
      break
    }

    swap(heap, parent, child)
    child = parent
  }

  return true
}

export const peekDeadline = (heap: TimerHeap): number =>
  heap.size === 0 ? Number.POSITIVE_INFINITY : heap.deadline[0]!

export const popInto = (heap: TimerHeap, out: Float64Array): void => {
  out[0] = heap.eid[0]!
  out[1] = heap.serial[0]!
  out[2] = heap.kind[0]!
  heap.size -= 1
  swap(heap, 0, heap.size)
  let parent = 0

  while (true) {
    const left = parent * 2 + 1
    const right = left + 1
    let smallest = parent

    if (left < heap.size && heap.deadline[left]! < heap.deadline[smallest]!) {
      smallest = left
    }

    if (right < heap.size && heap.deadline[right]! < heap.deadline[smallest]!) {
      smallest = right
    }

    if (smallest === parent) {
      return
    }

    swap(heap, parent, smallest)
    parent = smallest
  }
}
