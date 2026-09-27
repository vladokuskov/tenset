import { describe, expect, it } from 'vitest'
import { bandFor } from '../domain/volume'
import { bandExplanation, bandLabel, bandLabelFor, bandRange, targetText } from './bands'

const words = /\b(risk|too soon|overtrained|optimal|under|under-?trained|maintenance|danger|warning)\b/i

describe('band copy', () => {
  it('labels every band', () => {
    expect(bandLabel('none')).toBe('not trained')
    expect(bandLabel('light')).toBe('light')
    expect(bandLabel('moderate')).toBe('moderate')
    expect(bandLabel('target')).toBe('target range')
    expect(bandLabel('high')).toBe('high')
    expect(bandLabel('very_high')).toBe('very high')
  })

  it('never shows light for optional groups', () => {
    expect(bandLabel('light', { optional: true })).toBe('moderate')
    expect(bandLabelFor(bandFor('abs', 2)!)).toBe('moderate')
  })

  it('uses general-fitness wording for moderate under the general goal', () => {
    expect(bandLabel('moderate', { goal: 'general' })).toBe('good for general fitness')
    expect(bandLabel('target', { goal: 'general' })).toBe('target range')
  })

  it('describes ranges from the group edges', () => {
    expect(targetText([4, 10, 20, 30])).toBe('target 10-20')
    expect(targetText([4, 6, 16, 26])).toBe('target 6-16')
    expect(bandRange('moderate', [4, 10, 20, 30])).toBe('4 to 10 sets')
    expect(bandRange('very_high', [4, 10, 20, 30])).toBe('over 30 sets')
  })

  it('keeps explanations neutral', () => {
    for (const b of ['none', 'light', 'moderate', 'target', 'high', 'very_high'] as const) {
      for (const opts of [{}, { optional: true }, { goal: 'general' as const }]) {
        expect(bandExplanation(b, [4, 10, 20, 30], opts)).not.toMatch(words)
        expect(bandExplanation(b, [4, 10, 20, 30], opts)).not.toContain(String.fromCharCode(0x2014))
        expect(bandRange(b, [4, 10, 20, 30], opts.optional)).not.toMatch(words)
      }
    }
  })
})
