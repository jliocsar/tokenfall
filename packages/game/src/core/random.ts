export type Random = () => number

export const mulberry32 = (seed: number): Random => {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

export const hashString = (value: string): number => {
  let hash = 2_166_136_261

  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 16_777_619)
  }

  return hash >>> 0
}
