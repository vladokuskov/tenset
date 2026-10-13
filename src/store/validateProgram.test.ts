import { describe, expect, it } from 'vitest'
import { blankProgram } from '../domain/program.ts'
import { validateProgram } from './validateProgram.ts'

const custom = { id: 'c1', name: 'Band row', equipment: [], laterality: 'bilateral' as const, groups: { upper_back: 'primary' as const } }

describe('validateProgram', () => {
  it('accepts a program whose custom references resolve', () => {
    const p = { ...blankProgram('a', 'A'), custom: [custom] }
    p.days[0].entries.push({ id: 'e1', exerciseId: 'c1', sets: 3 }, { id: 'e2', exerciseId: 101, sets: 3 })
    expect(validateProgram(p)).toEqual(p)
  })

  it('rejects schema failures, dangling custom references and duplicate custom ids', () => {
    expect(validateProgram({ nope: true })).toBeNull()
    const dangling = blankProgram('a', 'A')
    dangling.days[2].entries.push({ id: 'e1', exerciseId: 'c2', sets: 3 })
    expect(validateProgram(dangling)).toBeNull()
    expect(validateProgram({ ...blankProgram('a', 'A'), custom: [custom, { ...custom, name: 'Other' }] })).toBeNull()
  })
})
