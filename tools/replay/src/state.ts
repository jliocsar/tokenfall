import type { HeroEvent } from '@tokenfall/protocol/events'
import type { HeroInfo } from '@tokenfall/protocol/hero'

export type HeroTable = Map<string, HeroInfo>

const update = (table: HeroTable, id: string, patch: Partial<HeroInfo>): void => {
  const hero = table.get(id)

  if (hero !== undefined) {
    table.set(id, { ...hero, ...patch })
  }
}

export const applyEvent = (table: HeroTable, event: HeroEvent): void => {
  if (event.kind === 'hero.joined') {
    table.set(event.hero.id, event.hero)
  } else if (event.kind === 'hero.status') {
    update(table, event.hero, { status: event.status })
  } else if (event.kind === 'hero.quest') {
    update(table, event.hero, { quest: event.quest })
  } else if (event.kind === 'hero.experience') {
    update(table, event.hero, { experience: event.experience })
  } else if (event.kind === 'hero.moved') {
    update(table, event.hero, { pane: event.pane, workspace: event.workspace, guild: event.guild })
  } else if (event.kind === 'hero.minions') {
    update(table, event.hero, { minions: event.minions })
  } else if (event.kind === 'hero.lead') {
    update(table, event.hero, { lead: event.lead })
  } else if (event.kind === 'hero.died') {
    update(table, event.hero, { alive: false })
  } else if (event.kind === 'hero.resurrected') {
    update(table, event.hero, { alive: true })
  } else if (event.kind === 'hero.linked') {
    const hero = table.get(event.from)

    if (hero !== undefined) {
      table.delete(event.from)
      table.set(event.to, { ...hero, id: event.to })
    }
  }
}
