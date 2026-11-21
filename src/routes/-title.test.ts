import { describe, expect, it } from 'vitest'
import { routeTitle } from './-title'

describe('routeTitle', () => {
  it('names each screen in both languages', () => {
    expect(routeTitle('/', 'en')).toBe('Exercises · Tenset')
    expect(routeTitle('/credits/', 'en')).toBe('Credits · Tenset')
    expect(routeTitle('/', 'uk')).toBe('Вправи · Tenset')
    expect(routeTitle('/privacy', 'uk')).toBe('Конфіденційність · Tenset')
  })

  it('falls back to not found, and to the bare name for dev tools', () => {
    expect(routeTitle('/exercises', 'en')).toBe('Not found · Tenset')
    expect(routeTitle('/nope', 'uk')).toBe('Не знайдено · Tenset')
    expect(routeTitle('/dev/review', 'en')).toBe('Tenset')
  })
})
