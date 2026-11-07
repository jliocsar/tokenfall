import { describe, expect, test } from 'bun:test'
import {
  bindHero,
  createHeroIndex,
  entityOfHero,
  heroOfEntity,
  NONE,
  rekeyHero,
  unbindHero,
} from '../src/core/hero-index.ts'

describe('hero index', () => {
  test('maps a hero id to its entity and back', () => {
    const index = createHeroIndex(4, 16)
    bindHero(index, 'local/session/a', 7)

    expect(entityOfHero(index, 'local/session/a')).toBe(7)
    expect(heroOfEntity(index, 7)).toBe('local/session/a')
    expect(entityOfHero(index, 'local/session/b')).toBe(NONE)
  })

  test('reuses freed slots and refuses past capacity', () => {
    const index = createHeroIndex(2, 16)

    expect(bindHero(index, 'a', 1)).toBe(true)
    expect(bindHero(index, 'b', 2)).toBe(true)
    expect(bindHero(index, 'c', 3)).toBe(false)

    unbindHero(index, 'a')

    expect(bindHero(index, 'c', 3)).toBe(true)
    expect(entityOfHero(index, 'a')).toBe(NONE)
  })

  test('a pane placeholder is rekeyed to its session id', () => {
    const index = createHeroIndex(2, 16)
    bindHero(index, 'local/pane/w1:p1', 5)
    rekeyHero(index, 'local/pane/w1:p1', 'local/session/s1')

    expect(entityOfHero(index, 'local/session/s1')).toBe(5)
    expect(entityOfHero(index, 'local/pane/w1:p1')).toBe(NONE)
  })
})
