import budgets from '@tokenfall/data/budgets.json'
import angelRing from '@tokenfall/data/effects/angel-ring.json'
import aura from '@tokenfall/data/effects/aura.json'
import machine from '@tokenfall/data/hero-states.json'
import curve from '@tokenfall/data/level-curve.json'
import names from '@tokenfall/data/names.json'
import personalities from '@tokenfall/data/personalities.json'
import town from '@tokenfall/data/town.json'
import world from '@tokenfall/data/world.json'
import { validateActions } from './behavior.ts'
import { createCharacters } from './character.ts'
import { createSim, type Budgets, type Sim } from './sim.ts'
import { registerEffectKind } from '../effects/emitters.ts'

export const HERO_SHEETS = [
  'barbarian',
  'knight',
  'knight_teal',
  'mage',
  'rogue',
  'stranger',
] as const

export const EFFECT_DEFINITIONS = [angelRing, aura] as const

export const bootSim = (seed: number, epoch: number, overrides: Partial<Budgets>): Sim => {
  validateActions(Object.values(machine.onEnter))
  const sim = createSim(
    {
      budgets: { ...budgets, ...overrides },
      machine,
      curve,
      tuning: world,
      seed,
      sheets: HERO_SHEETS.length,
      town,
      characters: createCharacters(personalities.personalities, names, HERO_SHEETS),
    },
    epoch,
  )

  for (const definition of EFFECT_DEFINITIONS) {
    registerEffectKind(sim, definition)
  }

  return sim
}
