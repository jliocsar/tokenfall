import world from '@tokenfall/data/world.json'
import { decodeTrusted } from '@tokenfall/protocol/json'
import { clampZoom } from '../../render/camera.ts'

export type ZoomStorage = Pick<Storage, 'getItem' | 'setItem'>

export type ZoomMemory = {
  town: number | undefined
  dungeon: number | undefined
  dirty: boolean
  nextSave: number
  readonly storage: ZoomStorage
}

type Saved = { readonly town?: number; readonly dungeon?: number }

const ZOOM_KEY = 'tokenfall.zoom'

const valid = (zoom: number | undefined): number | undefined =>
  Number.isFinite(zoom) && zoom !== undefined ? clampZoom(zoom) : undefined

const readSaved = (storage: ZoomStorage): Saved => {
  const raw = storage.getItem(ZOOM_KEY)

  if (raw === null) {
    return {}
  }

  try {
    return decodeTrusted<Saved | null>(raw) ?? {}
  } catch {
    return {}
  }
}

export const readZoom = (storage: ZoomStorage): ZoomMemory => {
  const saved = readSaved(storage)

  return {
    town: valid(saved.town),
    dungeon: valid(saved.dungeon),
    dirty: false,
    nextSave: 0,
    storage,
  }
}

export const noteZoom = (
  memory: ZoomMemory,
  inDungeon: boolean,
  zoom: number,
  now: number,
): void => {
  if (inDungeon && memory.dungeon !== zoom) {
    memory.dungeon = zoom
    memory.dirty = true
  } else if (!inDungeon && memory.town !== zoom) {
    memory.town = zoom
    memory.dirty = true
  }

  if (memory.dirty && now >= memory.nextSave) {
    memory.dirty = false
    memory.nextSave = now + world.zoom.saveEveryMs
    memory.storage.setItem(ZOOM_KEY, JSON.stringify({ town: memory.town, dungeon: memory.dungeon }))
  }
}
