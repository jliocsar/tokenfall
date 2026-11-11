import { describe, expect, test } from 'bun:test'
import { isTeam, leadFirst, teamRows, type PartyGroup } from '../src/features/roster/model.ts'

const counts = () => ({ raven: 0, loot: 0, working: 0, idle: 0, unknown: 0, dead: 0 })

const party = (heroes: number[]): PartyGroup => ({
  party: 0,
  workspace: 'w1',
  heroes,
  counts: counts(),
  lead: -1,
})

const leadIs = (lead: number) => (eid: number) => eid === lead

describe('team Parties', () => {
  test('the Lead moves to the front and heads the team', () => {
    const group = party([4, 7, 9])
    leadFirst(group, leadIs(9))

    expect(group.heroes).toEqual([9, 4, 7])
    expect(isTeam(group)).toBe(true)
    expect(teamRows(group)).toEqual([
      { eid: 9, branch: '', mates: 2 },
      { eid: 4, branch: '├ ', mates: 0 },
      { eid: 7, branch: '└ ', mates: 0 },
    ])
  })

  test('a Party without a Lead keeps its order and is not a team', () => {
    const group = party([4, 7])
    leadFirst(group, leadIs(-1))

    expect(group.heroes).toEqual([4, 7])
    expect(isTeam(group)).toBe(false)
  })

  test('a lone Lead has no teammates', () => {
    const group = party([3])
    leadFirst(group, leadIs(3))

    expect(teamRows(group)).toEqual([{ eid: 3, branch: '', mates: 0 }])
  })
})
