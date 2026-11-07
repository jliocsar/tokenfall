export type FieldKind = 'f32' | 'f64' | 'u8' | 'u16' | 'u32' | 'i32'

type ArrayOf = {
  readonly f32: Float32Array
  readonly f64: Float64Array
  readonly u8: Uint8Array
  readonly u16: Uint16Array
  readonly u32: Uint32Array
  readonly i32: Int32Array
}

export type Schema = Readonly<Record<string, FieldKind>>
export type Store<S extends Schema> = { readonly [K in keyof S]: ArrayOf[S[K]] }

export type Allocation = {
  readonly name: string
  readonly bytes: number
  readonly capacity: number
}

export type Arena = {
  readonly allocations: Allocation[]
}

const BYTES = { f32: 4, f64: 8, u8: 1, u16: 2, u32: 4, i32: 4 } as const satisfies Record<
  FieldKind,
  number
>

const VIEWS = {
  f32: (buffer: SharedArrayBuffer, offset: number, length: number) =>
    new Float32Array(buffer, offset, length),
  f64: (buffer: SharedArrayBuffer, offset: number, length: number) =>
    new Float64Array(buffer, offset, length),
  u8: (buffer: SharedArrayBuffer, offset: number, length: number) =>
    new Uint8Array(buffer, offset, length),
  u16: (buffer: SharedArrayBuffer, offset: number, length: number) =>
    new Uint16Array(buffer, offset, length),
  u32: (buffer: SharedArrayBuffer, offset: number, length: number) =>
    new Uint32Array(buffer, offset, length),
  i32: (buffer: SharedArrayBuffer, offset: number, length: number) =>
    new Int32Array(buffer, offset, length),
} as const

const ALIGN = 8

const align = (offset: number): number => Math.ceil(offset / ALIGN) * ALIGN

export const createArena = (): Arena => ({ allocations: [] })

export const createStore = <S extends Schema>(
  arena: Arena,
  name: string,
  schema: S,
  capacity: number,
): Store<S> => {
  const fields = Object.keys(schema)
  let bytes = 0

  for (const field of fields) {
    bytes = align(bytes) + BYTES[schema[field]!] * capacity
  }

  const buffer = new SharedArrayBuffer(align(bytes))
  const store: Record<string, ArrayOf[FieldKind]> = {}
  let offset = 0

  for (const field of fields) {
    const kind = schema[field]!
    offset = align(offset)
    store[field] = VIEWS[kind](buffer, offset, capacity)
    offset += BYTES[kind] * capacity
  }

  arena.allocations.push({ name, bytes: buffer.byteLength, capacity })

  // SAFETY: every key of `schema` was assigned a view of the kind the schema names, just above.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, begone-slop/no-known-value-widening
  return store as Store<S>
}

export const arenaBytes = (arena: Arena): number =>
  arena.allocations.reduce((total, allocation) => total + allocation.bytes, 0)
