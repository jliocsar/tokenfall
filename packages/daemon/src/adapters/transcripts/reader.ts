const NEWLINE = 10

const join = (parts: readonly Uint8Array[], tail: Uint8Array): Uint8Array => {
  if (parts.length === 0) {
    return tail
  }

  let length = tail.length

  for (const part of parts) {
    length += part.length
  }

  const out = new Uint8Array(length)
  let at = 0

  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }

  out.set(tail, at)

  return out
}

export const readLines = async (
  path: string,
  offset: number,
  onLine: (line: string) => void,
): Promise<number> => {
  const decoder = new TextDecoder()
  const parts: Uint8Array[] = []
  let consumed = offset
  let held = 0

  for await (const chunk of Bun.file(path).slice(offset).stream()) {
    let start = 0
    let newline = chunk.indexOf(NEWLINE)

    while (newline !== -1) {
      const line = join(parts, chunk.subarray(start, newline))
      onLine(decoder.decode(line))
      consumed += held + newline - start + 1
      parts.length = 0
      held = 0
      start = newline + 1
      newline = chunk.indexOf(NEWLINE, start)
    }

    if (start < chunk.length) {
      parts.push(chunk.slice(start))
      held += chunk.length - start
    }
  }

  return consumed
}
