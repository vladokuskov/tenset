import { describe, expect, it } from 'vitest'
import { sessionLabel } from './localize.ts'

describe('sessionLabel', () => {
  it('reads a template session label in the current language', () => {
    expect(sessionLabel('Full body A', 'uk')).toBe('Все тіло A')
    expect(sessionLabel('Все тіло A', 'en')).toBe('Full body A')
    expect(sessionLabel('full body a', 'uk')).toBe('Все тіло A')
  })

  it('leaves labels the user typed as they are', () => {
    expect(sessionLabel('Heavy day', 'uk')).toBe('Heavy day')
    expect(sessionLabel(undefined, 'uk')).toBeUndefined()
  })
})
