import { describe, expect, test } from 'bun:test'
import { appendFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLines } from '../src/adapters/transcripts/reader.ts'
import { usageOf } from '../src/adapters/transcripts/usage.ts'
import { migrate, openDatabase } from '../src/store/db.ts'
import { claimUsage, experienceOf, type Usage } from '../src/store/ledger.ts'
import { MIGRATIONS } from '../src/store/migrations/index.ts'

const assistant = (id: string, output: number): string =>
  JSON.stringify({
    type: 'assistant',
    message: {
      id,
      content: [{ type: 'text', text: 'never read' }],
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 1000,
        output_tokens: output,
      },
    },
  })

const usage = (id: string, output: number): Usage => usageOf(assistant(id, output))!

const ledger = () => {
  const db = openDatabase(':memory:')
  migrate(db, MIGRATIONS, undefined)

  return db
}

describe('usage lines', () => {
  test('an assistant line gives its id and four counts', () => {
    expect(usage('msg_1', 5)).toEqual({
      id: 'msg_1',
      input: 10,
      cacheWrite: 100,
      cacheRead: 1000,
      output: 5,
    })
  })

  test('other lines and broken lines give nothing', () => {
    expect(usageOf('{"type":"user","message":{"content":"usage"}}')).toBeUndefined()
    expect(usageOf('{"type":"assistant","usage":')).toBeUndefined()
    expect(usageOf('null')).toBeUndefined()
  })
})

describe('ledger', () => {
  test('streamed lines of one message keep the largest count of each field', () => {
    const db = ledger()
    claimUsage(db, 'hero-a', [usage('msg_1', 3), usage('msg_1', 40), usage('msg_1', 7)])

    expect(experienceOf(db, 'hero-a')).toBe(10 + 100 + 1000 + 40)
  })

  test("a message repeated in another Hero's file stays with its first claimant", () => {
    const db = ledger()
    claimUsage(db, 'parent', [usage('msg_1', 5)])
    claimUsage(db, 'fork', [usage('msg_1', 5), usage('msg_2', 5)])

    expect(experienceOf(db, 'parent')).toBe(1115)
    expect(experienceOf(db, 'fork')).toBe(1115)
  })
})

describe('reader', () => {
  test('reads only whole lines and resumes from the returned offset', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tokenfall-reader-'))
    const path = join(dir, 'session.jsonl')
    const first = assistant('msg_é', 1)
    await writeFile(path, `${first}\n{"type":"assist`)
    const seen: string[] = []
    const offset = await readLines(path, 0, (line) => {
      seen.push(line)
    })

    expect(seen).toEqual([first])
    expect(offset).toBe(Buffer.byteLength(first) + 1)

    await appendFile(path, 'ant"}\n')
    const more: string[] = []
    const end = await readLines(path, offset, (line) => {
      more.push(line)
    })

    expect(more).toEqual(['{"type":"assistant"}'])
    expect(end).toBe(Bun.file(path).size)
  })
})
