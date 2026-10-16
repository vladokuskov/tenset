import { describe, expect, it } from 'vitest'
import { emptyMix, mixTotal, MOVEMENT_GROUPS, MOVEMENT_KEYS, movementGroupNames, movementGroupOf, movementMix } from './movement.ts'
import { patternNames } from './patternNames.ts'
import type { Pattern } from './schema.ts'

const ALL = Object.keys(patternNames.en) as Pattern[]

describe('movement groups', () => {
  it('puts every pattern in exactly one group', () => {
    const grouped = MOVEMENT_GROUPS.flatMap((g) => g.patterns)
    expect(new Set(grouped).size).toBe(grouped.length)
    expect([...grouped].sort()).toEqual([...ALL].sort())
  })

  it('maps every pattern to its group and missing ones to other', () => {
    for (const g of MOVEMENT_GROUPS) for (const p of g.patterns) expect(movementGroupOf(p)).toBe(g.id)
    expect(movementGroupOf('dip')).toBe('push')
    expect(movementGroupOf('hinge')).toBe('legs')
    expect(movementGroupOf(null)).toBe('other')
    expect(movementGroupOf(undefined)).toBe('other')
  })

  it('names every key in both languages', () => {
    for (const locale of ['en', 'uk'] as const) {
      expect(Object.keys(movementGroupNames[locale]).sort()).toEqual([...MOVEMENT_KEYS].sort())
    }
    expect(MOVEMENT_KEYS.at(-1)).toBe('other')
  })
})

describe('movementMix', () => {
  it('sums sets per group with custom exercises under other', () => {
    const mix = movementMix([
      { sets: 3, exercise: { pattern: 'horizontal_push' } },
      { sets: 2, exercise: { pattern: 'incline_push' } },
      { sets: 4, exercise: { pattern: 'squat' } },
      { sets: 3, exercise: { pattern: null } },
      { sets: 2, exercise: { pattern: 'elbow_flexion' } },
    ])
    expect(mix).toEqual({ ...emptyMix(), push: 5, legs: 4, arms: 2, other: 3 })
    expect(mixTotal(mix)).toBe(14)
  })

  it('is all zero for no entries', () => {
    expect(movementMix([])).toEqual(emptyMix())
    expect(mixTotal(emptyMix())).toBe(0)
  })
})
