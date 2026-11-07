import { describe, expect, test } from 'bun:test'
import { createTimerHeap, peekDeadline, popInto, schedule } from '../src/core/timers.ts'

describe('timer heap', () => {
  test('pops in deadline order', () => {
    const heap = createTimerHeap(16)
    const deadlines = [50, 10, 40, 20, 30, 5]

    for (const [eid, deadline] of deadlines.entries()) {
      schedule(heap, deadline, eid, 0, 0)
    }

    const out = new Float64Array(3)
    const order: number[] = []

    while (heap.size > 0) {
      order.push(peekDeadline(heap))
      popInto(heap, out)
    }

    expect(order).toEqual([5, 10, 20, 30, 40, 50])
  })

  test('counts what it drops when full', () => {
    const heap = createTimerHeap(1)
    schedule(heap, 1, 0, 0, 0)

    expect(schedule(heap, 2, 1, 0, 0)).toBe(false)
    expect(heap.dropped).toBe(1)
  })
})
