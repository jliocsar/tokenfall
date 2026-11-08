import { describe, expect, test } from 'bun:test'
import machineDefinition from '@tokenfall/data/hero-states.json'
import {
  compileMachine,
  inputId,
  NO_TRANSITION,
  nextState,
  stateId,
  toMermaid,
} from '../src/core/fsm.ts'

const machine = compileMachine(machineDefinition)

const go = (from: string, input: string): string => {
  const to = nextState(machine, stateId(machine, from), inputId(machine, input))

  return to === NO_TRANSITION ? 'none' : machine.states[to]!
}

describe('hero state machine', () => {
  test('a working hero walks to the dungeon and warps in', () => {
    expect(go('camp', 'working')).toBe('to-dungeon')
    expect(go('to-dungeon', 'arrived')).toBe('warping-in')
    expect(go('warping-in', 'timer')).toBe('delving')
  })

  test('finishing warps out with loot, and being seen settles at camp', () => {
    expect(go('delving', 'done')).toBe('warping-out-with-loot')
    expect(go('warping-out-with-loot', 'timer')).toBe('looting')
    expect(go('looting', 'idle')).toBe('opening')
    expect(go('opening', 'timer')).toBe('camp')
    expect(go('opening', 'working')).toBe('to-dungeon')
  })

  test('any state can die, and only the dead can rise', () => {
    for (const state of machine.states.filter((name) => name !== 'dead')) {
      expect(go(state, 'died')).toBe('dying')
    }

    expect(go('dead', 'resurrected')).toBe('rising')
    expect(go('camp', 'resurrected')).toBe('none')
  })

  test('unknown names fail at compile time, not in the frame loop', () => {
    expect(() =>
      compileMachine({
        ...machineDefinition,
        transitions: [{ from: 'camp', on: 'flying', to: 'camp' }],
      }),
    ).toThrow('unknown input "flying"')
  })

  test('the table draws as a mermaid diagram', () => {
    expect(toMermaid(machine)).toContain('camp --> to_dungeon: working')
  })
})
