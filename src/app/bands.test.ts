import { describe, expect, it } from 'vitest'
import { bandFor } from '../domain/volume'
import {
  bandExplanation,
  bandExplanationFor,
  bandLabel,
  bandLabelFor,
  bandRange,
  bandTargetText,
  citedRangeText,
  displayBand,
  targetText,
} from './bands'

const ukWords = /(оптимальн|недостатньо|підтримуюч|ризик|зарано|перетрен|відновл|небезпе|попередж)/i
const words = /\b(risk|too soon|overtrained|optimal|under|under-?trained|maintenance|danger|warning)\b/i

describe('band copy', () => {
  it('labels every band', () => {
    expect(bandLabel('none')).toBe('not trained')
    expect(bandLabel('some')).toBe('some sets')
    expect(bandLabel('light')).toBe('light')
    expect(bandLabel('moderate')).toBe('moderate')
    expect(bandLabel('target')).toBe('target range')
    expect(bandLabel('high')).toBe('high')
    expect(bandLabel('very_high')).toBe('very high')
  })

  it('reads optional groups below their first edge as "some sets", never light or moderate', () => {
    expect(displayBand(bandFor('abs', 2)!)).toBe('some')
    expect(bandLabelFor(bandFor('abs', 2)!)).toBe('some sets')
    expect(bandLabelFor(bandFor('abs', 3.5)!)).toBe('some sets')
    expect(bandLabelFor(bandFor('abs', 4)!)).toBe('moderate')
    expect(bandLabelFor(bandFor('abs', 6)!)).toBe('target range')
    expect(bandLabelFor(bandFor('abs', 0)!)).toBe('not trained')
    expect(bandLabelFor(bandFor('chest', 2)!)).toBe('light')
    expect(bandLabelFor(bandFor('abs', 2)!, 'general')).toBe('some sets')
    expect(bandLabelFor(bandFor('abs', 2)!)).not.toMatch(/light/)
  })

  it('uses general-fitness wording for moderate under the general goal', () => {
    expect(bandLabel('moderate', { goal: 'general' })).toBe('good for general fitness')
    expect(bandLabel('target', { goal: 'general' })).toBe('target range')
  })

  it('describes ranges from the group edges', () => {
    expect(targetText([4, 10, 20, 30])).toBe('target 10-20')
    expect(targetText([4, 6, 16, 26])).toBe('target 6-16')
    expect(bandRange('moderate', [4, 10, 20, 30])).toBe('4 to 10 sets')
    expect(bandRange('moderate', [4, 6, 16, 26])).toBe('4 to 6 sets')
    expect(bandRange('some', [4, 6, 16, 26])).toBe('fewer than 4 sets')
    expect(bandRange('very_high', [4, 10, 20, 30])).toBe('over 30 sets')
  })

  it('names a personal range as the user\'s own and keeps the cited one', () => {
    const more = bandFor('chest', 18, { chest: { mode: 'more' } })!
    expect(bandTargetText(more)).toBe('your range 15-25')
    expect(bandTargetText(bandFor('chest', 18)!)).toBe('target 10-20')
    expect(bandTargetText(more, 'uk')).toBe('ваш діапазон 15-25')
    expect(citedRangeText(more.cited)).toBe('Research range: 10-20 sets a week. You set your own.')
    expect(citedRangeText(more.cited, 'uk')).toBe('Діапазон із досліджень: 10-20 підходів на тиждень. Ви задали свій.')
    expect(bandExplanationFor(more)).toBe('15 to 25 weekly sets, inside your range.')
    expect(bandFor('chest', 18, { chest: { mode: 'skip' } })).toBeNull()
  })

  it('explains the band a result reads as', () => {
    expect(bandExplanationFor(bandFor('abs', 2)!)).toBe('Fewer than 4 weekly sets. This group is optional.')
    expect(bandExplanationFor(bandFor('abs', 5)!)).toBe('4 to 6 weekly sets.')
    expect(bandExplanationFor(bandFor('chest', 6)!, 'general')).toBe('4 to 10 weekly sets, which is plenty for general fitness.')
  })

  it('keeps explanations neutral', () => {
    for (const b of ['none', 'some', 'light', 'moderate', 'target', 'high', 'very_high'] as const) {
      for (const opts of [{}, { goal: 'general' as const }, { personal: true }]) {
        expect(bandExplanation(b, [4, 10, 20, 30], opts)).not.toMatch(words)
        expect(bandExplanation(b, [4, 10, 20, 30], opts)).not.toContain(String.fromCharCode(0x2014))
        expect(bandRange(b, [4, 10, 20, 30])).not.toMatch(words)
        expect(bandLabel(b, opts)).not.toMatch(words)
      }
    }
  })

  it('labels and describes bands in Ukrainian', () => {
    expect(bandLabel('none', {}, 'uk')).toBe('не тренується')
    expect(bandLabel('target', {}, 'uk')).toBe('цільовий діапазон')
    expect(bandLabel('moderate', { goal: 'general' }, 'uk')).toBe('добре для загальної форми')
    expect(targetText([4, 10, 20, 30], {}, 'uk')).toBe('ціль 10-20')
    expect(bandRange('moderate', [4, 10, 20, 30], 'uk')).toBe('від 4 до 10 підходів')
    expect(bandRange('some', [4, 6, 16, 26], 'uk')).toBe('менше 4 підходів')
    expect(bandRange('light', [1.5, 3, 6, 9], 'uk')).toBe('менше 1,5 підходу')
    expect(bandExplanationFor(bandFor('abs', 2)!, undefined, 'uk')).toBe('Менше 4 підходів на тиждень. Ця група необовʼязкова.')
  })

  it('keeps Ukrainian copy neutral', () => {
    for (const b of ['none', 'some', 'light', 'moderate', 'target', 'high', 'very_high'] as const) {
      for (const opts of [{}, { goal: 'general' as const }, { personal: true }]) {
        expect(bandExplanation(b, [4, 10, 20, 30], opts, 'uk')).not.toMatch(ukWords)
        expect(bandExplanation(b, [4, 10, 20, 30], opts, 'uk')).not.toContain(String.fromCharCode(0x2014))
        expect(bandRange(b, [4, 10, 20, 30], 'uk')).not.toMatch(ukWords)
        expect(bandLabel(b, opts, 'uk')).not.toMatch(ukWords)
      }
    }
  })
})
