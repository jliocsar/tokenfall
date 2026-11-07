export type Queue<T> = {
  readonly items: (T | undefined)[]
  head: number
  size: number
  dropped: number
}

export const createQueue = <T>(capacity: number): Queue<T> => ({
  items: Array.from<T | undefined>({ length: capacity }),
  head: 0,
  size: 0,
  dropped: 0,
})

export const push = <T>(queue: Queue<T>, item: T): boolean => {
  if (queue.size === queue.items.length) {
    queue.dropped += 1

    return false
  }

  queue.items[(queue.head + queue.size) % queue.items.length] = item
  queue.size += 1

  return true
}

export const peek = <T>(queue: Queue<T>): T | undefined =>
  queue.size === 0 ? undefined : queue.items[queue.head]

export const shift = <T>(queue: Queue<T>): T | undefined => {
  if (queue.size === 0) {
    return undefined
  }

  const item = queue.items[queue.head]
  queue.items[queue.head] = undefined
  queue.head = (queue.head + 1) % queue.items.length
  queue.size -= 1

  return item
}
