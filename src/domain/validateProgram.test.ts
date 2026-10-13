import { describe, expect, it } from 'vitest'
import { blankProgram } from './program.ts'
import { repairProgram, validateProgram } from './validateProgram.ts'

const custom = { id: 'c1', name: 'Band row', equipment: [], laterality: 'bilateral' as const, groups: { upper_back: 'primary' as const } }

describe('validateProgram', () => {
  it('accepts a program whose custom references resolve', () => {
    const p = { ...blankProgram('a', 'A'), custom: [custom] }
    p.days[0].entries.push({ id: 'e1', exerciseId: 'c1', sets: 3 }, { id: 'e2', exerciseId: 101, sets: 3 })
    expect(validateProgram(p)).toEqual(p)
    expect(repairProgram(p)).toEqual(p)
  })

  it('rejects schema failures, dangling custom references and duplicate custom ids', () => {
    expect(validateProgram({ nope: true })).toBeNull()
    const dangling = blankProgram('a', 'A')
    dangling.days[2].entries.push({ id: 'e1', exerciseId: 'c2', sets: 3 })
    expect(validateProgram(dangling)).toBeNull()
    expect(validateProgram({ ...blankProgram('a', 'A'), custom: [custom, { ...custom, name: 'Other' }] })).toBeNull()
  })
})

describe('repairProgram', () => {
  it('drops entries whose custom exercise is gone and keeps the rest', () => {
    const p = blankProgram('a', 'A')
    p.days[0].entries.push({ id: 'e1', exerciseId: 101, sets: 3 }, { id: 'e2', exerciseId: 'c1', sets: 3, withPrev: true }, { id: 'e3', exerciseId: 102, sets: 3 })
    const fixed = repairProgram(p)!
    expect(fixed.days[0].entries.map((e) => e.id)).toEqual(['e1', 'e3'])
    expect(fixed.days[0].entries.some((e) => e.withPrev)).toBe(false)
    expect(validateProgram(fixed)).toEqual(fixed)
  })

  it('keeps the first of two custom exercises with one id', () => {
    const fixed = repairProgram({ ...blankProgram('a', 'A'), custom: [custom, { ...custom, name: 'Other' }] })!
    expect(fixed.custom).toEqual([custom])
  })

  it('refuses what fails the schema', () => {
    expect(repairProgram({ nope: true })).toBeNull()
  })
})
