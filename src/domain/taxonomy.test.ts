import { describe, expect, it } from 'vitest'
import {
  allHeadsOfGroup,
  bandEdges,
  bandSources,
  bandedGroupIds,
  deepHeadsOf,
  groupIds,
  headGroup,
  headsOfGroup,
  isBanded,
  isDeepHead,
  isOptional,
  parentOf,
  visibleHeads,
} from './taxonomy.ts'

describe('taxonomy index', () => {
  it('matches the planned counts', () => {
    expect(groupIds).toHaveLength(23)
    expect(bandedGroupIds).toHaveLength(19)
    expect(visibleHeads).toHaveLength(38)
  })

  it('maps heads to groups', () => {
    expect(headGroup('pec_clavicular')).toBe('chest')
    expect(headGroup('rhomboids')).toBe('upper_back')
    expect(headGroup('nope')).toBeUndefined()
    expect(headsOfGroup('chest')).toEqual(['pec_clavicular', 'pec_sternal'])
    expect(allHeadsOfGroup('chest')).toEqual(['pec_clavicular', 'pec_sternal', 'pec_minor'])
    expect(headsOfGroup('nope')).toEqual([])
  })

  it('knows deep head parents', () => {
    expect(parentOf('rhomboids')).toBe('trap_middle')
    expect(parentOf('triceps_medial')).toBe('triceps_lateral')
    expect(parentOf('pec_minor')).toBeNull()
    expect(parentOf('pec_sternal')).toBeNull()
    expect(isDeepHead('pec_minor')).toBe(true)
    expect(isDeepHead('pec_sternal')).toBe(false)
    expect(deepHeadsOf('infraspinatus')).toEqual(['supraspinatus', 'subscapularis', 'teres_minor'])
  })

  it('resolves band edges with group overrides', () => {
    expect(bandEdges('chest')).toEqual([4, 10, 20, 30])
    expect(bandEdges('front_delt')).toEqual([2, 6, 16, 24])
    expect(bandEdges('hamstrings')).toEqual([4, 8, 16, 24])
    expect(bandEdges('abs')).toEqual([4, 6, 16, 26])
    expect(bandEdges('serratus')).toBeNull()
    expect(bandEdges('nope')).toBeNull()
  })

  it('returns copies of edges', () => {
    const edges = bandEdges('chest')!
    edges[0] = 99
    expect(bandEdges('chest')).toEqual([4, 10, 20, 30])
  })

  it('attributes band sources', () => {
    expect(bandSources('chest')).toEqual(['pelland-2026', 'acsm-2026', 'baz-valle-2022'])
    expect(bandSources('front_delt')).toEqual(['rp-2023'])
    expect(bandSources('abs')).toEqual(['rp-2023'])
    expect(bandSources('serratus')).toEqual([])
  })

  it('flags optional and banded groups', () => {
    expect(isOptional('abs')).toBe(true)
    expect(isOptional('chest')).toBe(false)
    expect(isBanded('chest')).toBe(true)
    expect(isBanded('rotator_cuff')).toBe(false)
  })
})
