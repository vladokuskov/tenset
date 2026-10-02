import { describe, expect, it } from 'vitest'
import { dayEdges, groupShade, headShade } from './volumeScale'

describe('volume scale', () => {
  it('shades weeks on the group edges', () => {
    expect(groupShade('chest', 0)).toBe('none')
    expect(groupShade('chest', 3)).toBe('light')
    expect(groupShade('chest', 12)).toBe('target')
    expect(groupShade('chest', 31)).toBe('very_high')
  })

  it('shades optional groups below their first edge on the light step', () => {
    expect(groupShade('abs', 2)).toBe('light')
    expect(groupShade('abs', 4)).toBe('moderate')
    expect(groupShade('abs', 1, 'day')).toBe('light')
    expect(headShade('rectus_abdominis', 2)).toBe('light')
  })

  it('scales day edges by 10/30', () => {
    expect(dayEdges([3, 9, 18, 30])).toEqual([1, 3, 6, 10])
    expect(groupShade('chest', 4, 'day')).toBe('target')
  })

  it('shades heads on their group edges and unbanded groups on the default', () => {
    expect(headShade('pec_clavicular', 12)).toBe('target')
    expect(groupShade('serratus', 5)).toBe('moderate')
  })

  it('follows personal ranges and shades skipped groups on the research range', () => {
    expect(groupShade('chest', 12, 'week', { chest: { mode: 'more' } })).toBe('moderate')
    expect(groupShade('chest', 22, 'week', { chest: { mode: 'more' } })).toBe('target')
    expect(headShade('pec_clavicular', 12, 'week', { chest: { mode: 'more' } })).toBe('moderate')
    expect(groupShade('calves', 12, 'week', { calves: { mode: 'skip' } })).toBe('target')
  })
})
