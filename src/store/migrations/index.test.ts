import { describe, expect, it } from 'vitest'
import { PREFS_VERSION, PROGRAMS_VERSION, prefsMigrations, programMigrations, runMigrations } from './index.ts'

describe('migrations', () => {
  it('runs steps in order from the stored version', () => {
    const chain = { 1: (s: unknown) => [...(s as string[]), 'a'], 2: (s: unknown) => [...(s as string[]), 'b'] }
    expect(runMigrations([], 1, 3, chain)).toEqual(['a', 'b'])
    expect(runMigrations([], 2, 3, chain)).toEqual(['b'])
    expect(runMigrations([], 3, 3, chain)).toEqual([])
  })

  it('throws on a gap in the chain', () => {
    expect(() => runMigrations({}, 0, 2, { 0: (s) => s })).toThrow('No migration from v1')
  })

  it('passes newer state through for validation to judge', () => {
    const state = { x: 1 }
    expect(runMigrations(state, 5, 1, {})).toBe(state)
  })

  it('has a complete chain up to the current versions', () => {
    const state = { programs: {}, activeId: null }
    expect(runMigrations(state, 0, PROGRAMS_VERSION, programMigrations)).toEqual(state)
    expect(runMigrations(state, 0, PREFS_VERSION, prefsMigrations)).toEqual(state)
  })

  it('programs v2 adds optional entry notes, so v1 programs pass through unchanged', () => {
    expect(PROGRAMS_VERSION).toBe(2)
    const state = { programs: { a: { id: 'a', days: [{ kind: 'train', entries: [{ id: 'e1', exerciseId: 101, sets: 3 }] }] } }, activeId: 'a' }
    expect(runMigrations(state, 1, PROGRAMS_VERSION, programMigrations)).toEqual(state)
  })
})
