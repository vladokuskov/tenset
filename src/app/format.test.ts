import { describe, expect, it } from 'vitest'
import { formatDaySummary, formatDelta, formatMath, formatRest, formatRir, formatSets, joinMeta, setsLabel } from './format'

describe('format', () => {
  it('formats fractional sets', () => {
    expect(formatSets(8)).toBe('8')
    expect(formatSets(7.5)).toBe('7.5')
    expect(formatSets(2.25)).toBe('2.3')
    expect(formatSets(0.1 + 0.2)).toBe('0.3')
    expect(formatSets(-0)).toBe('0')
    expect(formatSets(1234)).toBe('1,234')
  })

  it('pluralizes', () => {
    expect(setsLabel(1)).toBe('1 set')
    expect(setsLabel(0.5)).toBe('0.5 sets')
  })

  it('formats Ukrainian numbers and counts', () => {
    expect(formatSets(7.5, 'uk')).toBe('7,5')
    expect(setsLabel(3, 'uk')).toBe('3 підходи')
    expect(formatDaySummary(5, 17, 'uk')).toBe('5 вправ · 17 підходів')
    expect(formatMath(3, 0.5, undefined, 'uk')).toBe('3 × 0,5 = 1,5')
  })

  it('shows math and deltas', () => {
    expect(formatMath(3, 1)).toBe('3 × 1.0 = 3')
    expect(formatMath(3, 0.5)).toBe('3 × 0.5 = 1.5')
    expect(formatDelta(8, 11)).toBe('8 → 11')
  })

  it('joins meta and summarizes days', () => {
    expect(joinMeta(['a', false, '', null, 'b'])).toBe('a · b')
    expect(formatDaySummary(5, 17)).toBe('5 exercises · 17 sets')
    expect(formatDaySummary(0, 0)).toBe('No exercises yet')
    expect(formatDaySummary(5, 17, 'en', 55)).toBe('5 exercises · 17 sets · about 55 min')
    expect(formatDaySummary(5, 17, 'uk', 55)).toBe('5 вправ · 17 підходів · близько 55 хв')
  })

  it('formats rest and RIR', () => {
    expect(formatRest(90, 'en')).toBe('90 s')
    expect(formatRest(120, 'en')).toBe('2 min')
    expect(formatRest(45, 'uk')).toBe('45 с')
    expect(formatRest(180, 'uk')).toBe('3 хв')
    expect(formatRir(2, 'en')).toBe('RIR 2')
  })
})
