import { describe, expect, it } from 'vitest'
import { resolveExercise, roleWeight, type ResolveContext } from './resolve.ts'
import { BENCH, CATALOG, PUSHDOWN } from './test-fixtures.ts'

const ctx = (patch: Partial<ResolveContext> = {}): ResolveContext => ({
  catalog: CATALOG,
  custom: [],
  countingMode: 'fractional',
  overrides: {},
  ...patch,
})

describe('roleWeight', () => {
  it('counts primary 1 and secondary 0.5, or 0 in primary-only mode', () => {
    expect(roleWeight('primary', 'fractional')).toBe(1)
    expect(roleWeight('secondary', 'fractional')).toBe(0.5)
    expect(roleWeight('primary', 'primary')).toBe(1)
    expect(roleWeight('secondary', 'primary')).toBe(0)
  })
})

describe('resolveExercise', () => {
  it('resolves catalog roles and fills omitted heads with 1', () => {
    const r = resolveExercise(BENCH.id, ctx())!
    expect(r.groups).toEqual({
      chest: { role: 'primary', weight: 1 },
      front_delt: { role: 'secondary', weight: 0.5 },
      triceps: { role: 'secondary', weight: 0.5 },
    })
    expect(r.heads.pec_clavicular).toBe(0.5)
    expect(r.heads.pec_sternal).toBe(1)
    expect(r.heads.pec_minor).toBe(1)
    expect(r.heads.triceps_long).toBe(1)
    expect(r.heads.biceps_brachii).toBeUndefined()
    expect(r.overridden).toBe(false)
    expect(r.pattern).toBe('horizontal_push')
  })

  it('zeroes secondary weight in primary-only mode', () => {
    const r = resolveExercise(BENCH.id, ctx({ countingMode: 'primary' }))!
    expect(r.groups.triceps).toEqual({ role: 'secondary', weight: 0 })
    expect(r.groups.chest.weight).toBe(1)
  })

  it('applies user overrides, including "none"', () => {
    const r = resolveExercise(
      BENCH.id,
      ctx({ overrides: { [BENCH.id]: { triceps: 'none', front_delt: 'primary', serratus: 'secondary', bogus: 'primary' } } }),
    )!
    expect(r.groups.triceps).toBeUndefined()
    expect(r.heads.triceps_long).toBeUndefined()
    expect(r.groups.front_delt).toEqual({ role: 'primary', weight: 1 })
    expect(r.groups.serratus).toEqual({ role: 'secondary', weight: 0.5 })
    expect(r.heads.serratus_anterior).toBe(1)
    expect(r.groups.bogus).toBeUndefined()
    expect(r.overridden).toBe(true)
  })

  it('does not flag overrides that change nothing', () => {
    const r = resolveExercise(PUSHDOWN.id, ctx({ overrides: { [PUSHDOWN.id]: { triceps: 'primary', chest: 'none' } } }))!
    expect(r.overridden).toBe(false)
  })

  it('resolves custom exercises with every head of listed groups at 1', () => {
    const custom = [
      { id: 'c1', name: 'Band row', equipment: [], laterality: 'bilateral' as const, groups: { upper_back: 'primary' as const, biceps: 'secondary' as const } },
    ]
    const r = resolveExercise('c1', ctx({ custom }))!
    expect(r.custom).toBe(true)
    expect(r.name).toBe('Band row')
    expect(r.pattern).toBeNull()
    expect(r.groups.biceps).toEqual({ role: 'secondary', weight: 0.5 })
    expect(r.heads).toEqual({ trap_middle: 1, trap_lower: 1, rhomboids: 1, biceps_brachii: 1, brachialis: 1 })
  })

  it('returns null for unknown refs', () => {
    expect(resolveExercise(999, ctx())).toBeNull()
    expect(resolveExercise('c9', ctx())).toBeNull()
  })
})
