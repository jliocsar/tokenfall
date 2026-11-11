import menuTuning from '@tokenfall/data/menu.json'
import world from '@tokenfall/data/world.json'
import { NO_PLOT } from '../../core/layout.ts'
import { seenInDungeon, tierInside } from '../../core/dungeon.ts'
import { stateFlags } from '../../core/fsm.ts'
import { screenX, screenY } from '../../core/iso.ts'
import type { Sim } from '../../core/sim.ts'
import { glideTo, type Camera } from '../../render/camera.ts'
import type { View } from '../../render/heroes.ts'
import { NOBODY } from '../../ui/bridge.ts'
import type { DungeonView } from '../dungeon/view.ts'
import { hideMenu, noteFollowing, placeMenu, type MenuActions, type MenuModel } from './menu.ts'

export type FollowDeps = {
  readonly sim: Sim
  readonly camera: Camera
  readonly view: View
  readonly menu: MenuModel
  readonly dungeon: DungeonView
  readonly hidden: Uint8Array
  readonly inside: Uint8Array
  readonly selected: () => number
  readonly sheetOpen: () => number
  readonly screen: { readonly width: number; readonly height: number }
  readonly openDungeon: (guild: number, tier: number) => void
  readonly leaveDungeon: () => void
  readonly showSheet: (eid: number) => void
  readonly focus: (eid: number) => void
}

export type Follow = {
  readonly follow: () => void
  readonly menu: () => void
  readonly actions: MenuActions
}

const HEAD = 40

export const createFollow = (deps: FollowDeps): Follow => {
  const { sim, camera, view, menu, dungeon, hidden, inside } = deps
  const gone = stateFlags(sim.machine, ['dying', 'dead'])

  const viewingTierOf = (eid: number): boolean => {
    const { open } = dungeon

    return (
      open !== undefined &&
      open.guild === sim.stores.hero.guild[eid] &&
      open.tier === tierInside(sim, eid)
    )
  }

  const offscreen = (sx: number, sy: number): boolean =>
    sx < view.left || sx > view.right || sy < view.top || sy > view.bottom

  const place = (wx: number, wy: number, lift: number, delving: boolean): void => {
    const sx = screenX(wx, wy)
    const sy = screenY(wx, wy)

    if (offscreen(sx, sy)) {
      hideMenu(menu)

      return
    }

    placeMenu(
      menu,
      (sx - camera.x) * camera.zoom + deps.screen.width / 2,
      (sy - camera.y) * camera.zoom + deps.screen.height / 2 - lift,
      delving,
    )
  }

  const atEntrance = (eid: number): void => {
    const plot = sim.town.plotOfGuild[sim.stores.hero.guild[eid]!]!

    if (dungeon.open !== undefined || plot === NO_PLOT) {
      hideMenu(menu)

      return
    }

    const lift = world.entrance.offsetY * camera.zoom + world.bubbles.aboveBadge
    place(sim.town.entranceX[plot]!, sim.town.entranceY[plot]!, lift, true)
  }

  const track = (eid: number): void => {
    const { x, y } = sim.stores.position

    if (inside[sim.stores.behavior.state[eid]!] === 1) {
      if (!viewingTierOf(eid)) {
        deps.openDungeon(sim.stores.hero.guild[eid]!, tierInside(sim, eid))
      }

      if (sim.stores.delve.placed[eid] !== 1) {
        return
      }
    } else if (dungeon.open !== undefined) {
      deps.leaveDungeon()
    }

    glideTo(camera, screenX(x[eid]!, y[eid]!), screenY(x[eid]!, y[eid]!) - HEAD)
  }

  return {
    actions: {
      sheet: deps.showSheet,
      follow: (eid) => {
        camera.follow = eid === NOBODY ? undefined : eid
      },
      dungeon: deps.focus,
    },
    follow: () => {
      const eid = camera.follow

      if (
        eid !== undefined &&
        (deps.selected() !== eid || gone[sim.stores.behavior.state[eid]!] === 1)
      ) {
        camera.follow = undefined
      }

      noteFollowing(menu, camera.follow ?? NOBODY)

      if (camera.follow !== undefined) {
        track(camera.follow)
      }
    },
    menu: () => {
      const eid = deps.selected()
      const state = eid === NOBODY ? 0 : sim.stores.behavior.state[eid]!

      if (
        eid === NOBODY ||
        deps.sheetOpen() !== NOBODY ||
        gone[state] === 1 ||
        hidden[state] === 1
      ) {
        hideMenu(menu)

        return
      }

      const { x, y } = sim.stores.position

      if (seenInDungeon(sim, eid)) {
        place(x[eid]!, y[eid]!, menuTuning.lift * camera.zoom + menuTuning.gap, false)
      } else if (inside[state] === 1) {
        atEntrance(eid)
      } else if (dungeon.open === undefined) {
        place(x[eid]!, y[eid]!, menuTuning.lift * camera.zoom + menuTuning.gap, false)
      } else {
        hideMenu(menu)
      }
    },
  }
}
