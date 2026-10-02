import { describe, expect, it } from 'vitest'
import { edgesFromRange, resolveTarget, shadeEdges } from './targets.ts'

describe('targets', () => {
  it('uses the cited range when nothing is set', () => {
    expect(resolveTarget('chest')).toEqual({ edges: [4, 10, 20, 30], cited: [4, 10, 20, 30], optional: false, mode: 'normal' })
    expect(resolveTarget('chest', {})).toEqual(resolveTarget('chest'))
  })

  it('shifts the target range by half its width', () => {
    expect(resolveTarget('chest', { chest: { mode: 'more' } }).edges).toEqual([6, 15, 25, 38])
    expect(resolveTarget('chest', { chest: { mode: 'less' } }).edges).toEqual([2, 5, 15, 23])
    expect(resolveTarget('front_delt', { front_delt: { mode: 'less' } }).edges).toEqual([1, 1, 11, 17])
  })

  it('opts optional groups in on More or Custom, not on Less', () => {
    expect(resolveTarget('abs').optional).toBe(true)
    expect(resolveTarget('abs', { abs: { mode: 'more' } }).optional).toBe(false)
    expect(resolveTarget('abs', { abs: { mode: 'custom', min: 6, max: 12 } }).optional).toBe(false)
    expect(resolveTarget('abs', { abs: { mode: 'less' } }).optional).toBe(true)
  })

  it('skips a group without losing its cited range', () => {
    const t = resolveTarget('calves', { calves: { mode: 'skip' } })
    expect(t.edges).toBeNull()
    expect(t.cited).toEqual([4, 10, 20, 30])
    expect(shadeEdges('calves', { calves: { mode: 'skip' } })).toEqual([4, 10, 20, 30])
  })

  it('repairs custom ranges instead of rejecting them', () => {
    const cited = [4, 10, 20, 30] as [number, number, number, number]
    expect(edgesFromRange(12, 18, cited)).toEqual([5, 12, 18, 27])
    expect(edgesFromRange(18, 12, cited)).toEqual([5, 12, 18, 27])
    expect(edgesFromRange(8, 8, cited)).toEqual([3, 8, 9, 14])
    expect(edgesFromRange(0, 200, cited)).toEqual([1, 1, 60, 90])
  })

  it('ignores targets on unbanded groups', () => {
    expect(resolveTarget('serratus', { serratus: { mode: 'more' } })).toEqual(resolveTarget('serratus'))
    expect(resolveTarget('serratus').edges).toBeNull()
  })
})
