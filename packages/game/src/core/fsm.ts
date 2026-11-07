export type MachineDefinition = {
  readonly states: readonly string[]
  readonly inputs: readonly string[]
  readonly initial: string
  readonly transitions: readonly {
    readonly from: string
    readonly on: string
    readonly to: string
  }[]
  readonly timers: Readonly<Partial<Record<string, number>>>
  readonly onEnter: Readonly<Partial<Record<string, string>>>
}

export type Machine = {
  readonly states: readonly string[]
  readonly inputs: readonly string[]
  readonly initial: number
  readonly next: Uint8Array
  readonly timeoutMs: Float64Array
  readonly onEnter: readonly string[]
}

export type MachineState = {
  readonly state: Uint8Array
  readonly serial: Uint32Array
  readonly since: Float64Array
}

export const NO_TRANSITION = 255
export const ANY_STATE = '*'

const indexIn = (names: readonly string[], name: string, what: string): number => {
  const index = names.indexOf(name)

  if (index === -1) {
    throw new Error(`unknown ${what} "${name}"`)
  }

  return index
}

export const compileMachine = (definition: MachineDefinition): Machine => {
  const { states, inputs } = definition

  if (states.length >= NO_TRANSITION) {
    throw new Error(`a machine holds at most ${NO_TRANSITION - 1} states`)
  }

  const next = new Uint8Array(states.length * inputs.length).fill(NO_TRANSITION)
  const wildcards = definition.transitions.filter((rule) => rule.from === ANY_STATE)
  const specific = definition.transitions.filter((rule) => rule.from !== ANY_STATE)

  for (const rule of wildcards) {
    const input = indexIn(inputs, rule.on, 'input')
    const to = indexIn(states, rule.to, 'state')

    for (let from = 0; from < states.length; from++) {
      next[from * inputs.length + input] = to
    }
  }

  for (const rule of specific) {
    const from = indexIn(states, rule.from, 'state')
    next[from * inputs.length + indexIn(inputs, rule.on, 'input')] = indexIn(
      states,
      rule.to,
      'state',
    )
  }

  const timeoutMs = new Float64Array(states.length)
  const onEnter = states.map(() => '')

  for (const [state, ms] of Object.entries(definition.timers)) {
    timeoutMs[indexIn(states, state, 'state')] = ms ?? 0
  }

  for (const [state, action] of Object.entries(definition.onEnter)) {
    onEnter[indexIn(states, state, 'state')] = action ?? ''
  }

  return {
    states,
    inputs,
    initial: indexIn(states, definition.initial, 'state'),
    next,
    timeoutMs,
    onEnter,
  }
}

export const inputId = (machine: Machine, name: string): number =>
  indexIn(machine.inputs, name, 'input')

export const stateId = (machine: Machine, name: string): number =>
  indexIn(machine.states, name, 'state')

export const stateFlags = (machine: Machine, names: readonly string[]): Uint8Array => {
  const flags = new Uint8Array(machine.states.length)

  for (const name of names) {
    flags[indexIn(machine.states, name, 'state')] = 1
  }

  return flags
}

export const nextState = (machine: Machine, from: number, input: number): number =>
  machine.next[from * machine.inputs.length + input]!

export const enterState = (
  store: MachineState,
  eid: number,
  state: number,
  now: number,
): number => {
  store.state[eid] = state
  store.since[eid] = now
  store.serial[eid] = (store.serial[eid]! + 1) >>> 0

  return store.serial[eid]
}

const mermaidId = (name: string): string => name.replaceAll('-', '_')

export const toMermaid = (machine: Machine): string => {
  const lines = ['stateDiagram-v2', `  [*] --> ${mermaidId(machine.states[machine.initial]!)}`]

  for (let from = 0; from < machine.states.length; from++) {
    for (let input = 0; input < machine.inputs.length; input++) {
      const to = nextState(machine, from, input)

      if (to !== NO_TRANSITION && to !== from) {
        lines.push(
          `  ${mermaidId(machine.states[from]!)} --> ${mermaidId(machine.states[to]!)}: ${machine.inputs[input]!}`,
        )
      }
    }
  }

  return lines.join('\n')
}
