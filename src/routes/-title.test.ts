import { describe, expect, it } from 'vitest'
import { routeTitle } from './-title'

const names: Record<string, string> = { 'barbell-bench-press': 'Barbell Bench Press' }
const lookup = (slug: string) => names[slug]

describe('routeTitle', () => {
  it('names each top-level screen in both languages', () => {
    expect(routeTitle('/', 'en')).toBe('Plan · Tenset')
    expect(routeTitle('/body', 'en')).toBe('Body · Tenset')
    expect(routeTitle('/exercises/', 'en')).toBe('Exercises · Tenset')
    expect(routeTitle('/', 'uk')).toBe('План · Tenset')
    expect(routeTitle('/settings', 'uk')).toBe('Налаштування · Tenset')
  })

  it('uses the day and exercise names for pushed screens', () => {
    expect(routeTitle('/day/mon', 'en')).toBe('Monday · Tenset')
    expect(routeTitle('/day/fri', 'uk')).toBe('Пʼятниця · Tenset')
    expect(routeTitle('/exercise/barbell-bench-press', 'en', lookup)).toBe('Barbell Bench Press · Tenset')
    expect(routeTitle('/exercise/unknown', 'uk', lookup)).toBe('Вправа · Tenset')
  })

  it('falls back to not found, and to the bare name for dev tools', () => {
    expect(routeTitle('/day/xyz', 'en')).toBe('Not found · Tenset')
    expect(routeTitle('/nope', 'uk')).toBe('Не знайдено · Tenset')
    expect(routeTitle('/dev/review', 'en')).toBe('Tenset')
  })
})
