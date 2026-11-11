import { screenX, screenY } from '../../core/iso.ts'
import type { Sim } from '../../core/sim.ts'
import { fitCamera, type Camera } from '../../render/camera.ts'
import type { View } from '../../render/heroes.ts'
import { tierCorners, type DungeonView } from '../dungeon/view.ts'
import { townBounds } from './ground.ts'
import type { ZoomMemory } from './zoom.ts'

export type FitDeps = {
  readonly sim: Sim
  readonly camera: Camera
  readonly dungeon: DungeonView
  readonly screen: { readonly width: number; readonly height: number }
  readonly roster: number
  readonly zoom: ZoomMemory
}

export type Fitter = {
  readonly town: (keepZoom: boolean) => void
  readonly dungeon: (keepZoom: boolean) => void
}

const townView = (sim: Sim): View => {
  const bounds = townBounds(sim)
  const corners = [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
    [bounds.minX, bounds.maxY],
  ] as const
  const xs = corners.map(([x, y]) => screenX(x, y))
  const ys = corners.map(([x, y]) => screenY(x, y))

  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  }
}

export const createFitter = (deps: FitDeps): Fitter => {
  const { camera, screen, roster } = deps

  const frame = (bounds: View, saved: number | undefined): void => {
    fitCamera(camera, bounds, screen.width - roster, screen.height)

    if (saved !== undefined) {
      camera.zoom = saved
    }

    camera.x += roster / 2 / camera.zoom
  }

  return {
    town: (keepZoom) => {
      frame(townView(deps.sim), keepZoom ? deps.zoom.town : undefined)
    },
    dungeon: (keepZoom) => {
      const { open } = deps.dungeon

      if (open !== undefined) {
        frame(
          tierCorners(deps.sim, open.guild, open.tier),
          keepZoom ? deps.zoom.dungeon : undefined,
        )
      }
    },
  }
}
