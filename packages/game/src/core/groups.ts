export type Groups = {
  readonly guildIds: Map<string, number>
  readonly guildKeys: string[]
  readonly guildHeroes: Uint16Array
  readonly guildParties: Uint16Array
  readonly partyIds: Map<string, number>
  readonly partyWorkspace: string[]
  readonly partyGuild: Uint16Array
  readonly partySlot: Uint16Array
}

export const createGroups = (guilds: number, parties: number): Groups => ({
  guildIds: new Map(),
  guildKeys: [],
  guildHeroes: new Uint16Array(guilds),
  guildParties: new Uint16Array(guilds),
  partyIds: new Map(),
  partyWorkspace: [],
  partyGuild: new Uint16Array(parties),
  partySlot: new Uint16Array(parties),
})

export const guildOf = (groups: Groups, key: string): number => {
  const known = groups.guildIds.get(key)

  if (known !== undefined) {
    return known
  }

  const id = groups.guildKeys.length

  if (id >= groups.guildHeroes.length) {
    throw new Error(`guild capacity reached at ${id} guilds`)
  }

  groups.guildIds.set(key, id)
  groups.guildKeys.push(key)

  return id
}

export const partyOf = (groups: Groups, guild: number, workspace: string): number => {
  const key = `${guild}:${workspace}`
  const known = groups.partyIds.get(key)

  if (known !== undefined) {
    return known
  }

  const id = groups.partyWorkspace.length

  if (id >= groups.partyGuild.length) {
    throw new Error(`party capacity reached at ${id} parties`)
  }

  groups.partyIds.set(key, id)
  groups.partyWorkspace.push(workspace)
  groups.partyGuild[id] = guild
  groups.partySlot[id] = groups.guildParties[guild]!
  groups.guildParties[guild] = groups.guildParties[guild]! + 1

  return id
}

export const guildLabel = (key: string): string => {
  const parts = key.split('/').filter((part) => part !== '')

  return parts.at(-1) ?? 'Wanderers'
}
