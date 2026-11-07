import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'
import { parseSync } from 'vite'
import { join } from 'node:path'
import {
  functionCosts,
  startTrace,
  stopTrace,
  toChromeTrace,
  traceBegin,
  traceEnd,
  traceId,
  traceNextFrame,
} from '../src/core/trace.ts'
import { instrument } from '../trace-all.ts'

const SOURCE = join(import.meta.dir, '..', 'src')

describe('trace recorder', () => {
  test('records nested spans and splits self time from total', () => {
    const outer = traceId('test.outer')
    const inner = traceId('test.inner')
    startTrace()
    traceBegin(outer)
    traceBegin(inner)
    traceEnd()
    traceEnd()
    traceNextFrame()
    stopTrace()
    const spans = toChromeTrace().traceEvents.filter((event) => event.ph === 'X')
    const costs = functionCosts()
    const outerCost = costs.find((cost) => cost.name === 'test.outer')!

    expect(spans.map((span) => span.name)).toEqual(['test.outer', 'test.inner'])
    expect(outerCost.totalMsPerFrame).toBeGreaterThanOrEqual(outerCost.selfMsPerFrame)
  })

  test('records nothing while stopped', () => {
    startTrace()
    stopTrace()
    traceBegin(traceId('test.ignored'))
    traceEnd()

    expect(toChromeTrace().traceEvents.filter((event) => event.ph === 'X')).toEqual([])
  })
})

describe('trace-all transform', () => {
  test('wraps block bodies, expression bodies and nested arrows, and names them', () => {
    const source = [
      'const add = (a: number, b: number): number => a + b',
      'const make = () => ({ run: (x: number) => { return x * 2 } })',
      'function plain() { return add(1, 2) }',
      'const curried = (a: number) => (b: number) => a + b',
      'const later = async () => 1',
    ].join('\n')
    const output = instrument(source, '/repo/packages/game/src/example.ts')!

    expect(parseSync('out.ts', output, { lang: 'ts' }).errors).toEqual([])
    expect(output).toContain('example.ts:add')
    expect(output).toContain('example.ts:run')
    expect(output).toContain('example.ts:plain')
    expect(output).toContain('example.ts:curried')
    expect(output).not.toContain('example.ts:later')
    expect(output.split('\n')).toHaveLength(5)
  })

  test('every game source file still parses after instrumenting', async () => {
    for await (const path of new Glob('**/*.ts').scan(SOURCE)) {
      const file = join(SOURCE, path)
      const output = instrument(await Bun.file(file).text(), file)

      if (output !== undefined) {
        expect(parseSync(file, output, { lang: 'ts' }).errors).toEqual([])
      }
    }
  })
})
