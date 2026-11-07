import { relative } from 'node:path'
import { parseSync, Visitor, type Plugin } from 'vite'

type Insertion = { readonly at: number; readonly text: string; readonly order: number }

type Found = {
  readonly start: number
  readonly bodyStart: number
  readonly bodyEnd: number
  readonly expression: boolean
}

type FunctionNode = {
  readonly start: number
  readonly async: boolean
  readonly generator: boolean
  readonly expression?: boolean
  readonly id?: { readonly name: string } | null
  readonly body?: { readonly start: number; readonly end: number } | null
}

const TRACE_MODULE = new URL('src/core/trace.ts', import.meta.url).pathname
const ROOT = new URL('../..', import.meta.url).pathname

const lineOf = (source: string, offset: number): number =>
  source.slice(0, offset).split('\n').length

const collect = (source: string, file: string) => {
  const program = parseSync(file, source, { lang: 'ts' }).program
  const names = new Map<number, string>()
  const found: Found[] = []

  const take = (node: FunctionNode): void => {
    if (node.async || node.generator || node.body === undefined || node.body === null) {
      return
    }

    if (node.id !== undefined && node.id !== null) {
      names.set(node.start, node.id.name)
    }

    found.push({
      start: node.start,
      bodyStart: node.body.start,
      bodyEnd: node.body.end,
      expression: node.expression === true,
    })
  }

  new Visitor({
    VariableDeclarator: (node) => {
      if (node.init !== null && node.id.type === 'Identifier') {
        names.set(node.init.start, node.id.name)
      }
    },
    Property: (node) => {
      if (node.key.type === 'Identifier') {
        names.set(node.value.start, node.key.name)
      }
    },
    ArrowFunctionExpression: take,
    FunctionExpression: take,
    FunctionDeclaration: take,
  }).visit(program)

  return { names, found }
}

export const instrument = (source: string, file: string): string | undefined => {
  const { names, found } = collect(source, file)

  if (found.length === 0) {
    return undefined
  }

  const label = relative(ROOT, file)
  const insertions: Insertion[] = []
  const spanNames = found.map(
    (fn) => `${label}:${names.get(fn.start) ?? `anonymous@${lineOf(source, fn.start)}`}`,
  )

  for (const [index, fn] of found.entries()) {
    const open = `__tb(__tid+${index});try{`

    if (fn.expression) {
      insertions.push({ at: fn.bodyStart, text: `{${open}return (`, order: fn.start })
      insertions.push({ at: fn.bodyEnd, text: ')}finally{__te()}}', order: -fn.start })
    } else {
      insertions.push({ at: fn.bodyStart + 1, text: open, order: fn.start })
      insertions.push({ at: fn.bodyEnd - 1, text: '}finally{__te()}', order: -fn.start })
    }
  }

  insertions.sort((a, b) => a.at - b.at || a.order - b.order)
  const parts: string[] = [
    `import { traceBegin as __tb, traceEnd as __te, traceIds as __tids } from '${TRACE_MODULE}';const __tid=__tids(${JSON.stringify(spanNames)});`,
  ]
  let cursor = 0

  for (const insertion of insertions) {
    parts.push(source.slice(cursor, insertion.at), insertion.text)
    cursor = insertion.at
  }

  parts.push(source.slice(cursor))

  return parts.join('')
}

export const traceAll = (): Plugin => ({
  name: 'tokenfall-trace-all',
  apply: 'serve',
  enforce: 'pre',
  transform: (code, id) => {
    const file = id.split('?')[0] ?? id

    if (!file.endsWith('.ts') || file.includes('node_modules') || file === TRACE_MODULE) {
      return undefined
    }

    if (!file.startsWith(ROOT) || file.endsWith('.d.ts')) {
      return undefined
    }

    const instrumented = instrument(code, file)

    return instrumented === undefined ? undefined : { code: instrumented, map: null }
  },
})
