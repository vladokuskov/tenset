import { describe, expect, it } from 'vitest'
import { notMedicalAdvice, templateNoteText } from './messages'

const dropped = { kind: 'dropped_slot', day: 0, session: 'Upper', slot: 1, pattern: 'horizontal_pull', group: 'upper_back' } as const
const dayCount = { kind: 'day_count', expected: 2, got: 3 } as const

describe('app messages', () => {
  it('words template notes', () => {
    expect(templateNoteText(dropped, 'en')).toBe('Mon: no option for your equipment, so the upper back slot was left out.')
    expect(templateNoteText(dayCount, 'en')).toBe('This template is built for 2 days a week; it was placed on 3.')
    expect(templateNoteText(dropped, 'uk')).toMatch(/^Пн: для вашого обладнання немає варіанта, тому слот «.+» пропущено\.$/)
    expect(templateNoteText(dayCount, 'uk')).toBe('Цей шаблон розрахований на 2 дні на тиждень; його розміщено на 3 дні.')
  })

  it('keeps the disclaimer in both languages', () => {
    expect(notMedicalAdvice('en')).toBe('General information for planning training. Not medical advice.')
    expect(notMedicalAdvice('uk')).toContain('Не медична порада')
  })
})
