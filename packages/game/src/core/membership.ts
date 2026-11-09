import { guildOf, partyOf } from './groups.ts'
import { assignPlot, NO_PLOT, releasePlot } from './layout.ts'
import type { Sim } from './sim.ts'

export const joinGroups = (
  sim: Sim,
  eid: number,
  guildKey: string,
  workspace: string,
  plot: number,
): void => {
  const { hero } = sim.stores
  const { groups } = sim

  if (hero.grouped[eid] === 1) {
    leaveGroups(sim, eid)
  }

  const guild = guildOf(groups, guildKey)
  assignPlot(sim.town, guild, plot)
  hero.guild[eid] = guild
  hero.party[eid] = partyOf(groups, guild, workspace)
  hero.grouped[eid] = 1
  groups.guildHeroes[guild] = groups.guildHeroes[guild]! + 1
}

export const leaveGroups = (sim: Sim, eid: number): void => {
  const { hero } = sim.stores

  if (hero.grouped[eid] === 0) {
    return
  }

  const guild = hero.guild[eid]!
  const { guildHeroes } = sim.groups
  hero.grouped[eid] = 0
  guildHeroes[guild] = guildHeroes[guild]! - 1

  if (guildHeroes[guild] === 0) {
    releasePlot(sim.town, guild)
  }
}

export const rejoinGroups = (sim: Sim, eid: number): void => {
  const { hero } = sim.stores
  const { groups } = sim
  joinGroups(
    sim,
    eid,
    groups.guildKeys[hero.guild[eid]!] ?? '',
    groups.partyWorkspace[hero.party[eid]!] ?? '',
    NO_PLOT,
  )
}
