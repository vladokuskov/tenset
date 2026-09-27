import { describe, expect, it } from 'vitest'
import { dayFromSlug, daySlug, displayPosition, formatDayList, isDaySlug, sortDays, todayIndex, weekOrder } from './days'

describe('days', () => {
  it('maps slugs', () => {
    expect(daySlug(0)).toBe('mon')
    expect(daySlug(6)).toBe('sun')
    expect(dayFromSlug('thu')).toBe(3)
    expect(isDaySlug('sun')).toBe(true)
    expect(isDaySlug('Sunday')).toBe(false)
  })

  it('orders the week from weekStart', () => {
    expect(weekOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(weekOrder(6)).toEqual([6, 0, 1, 2, 3, 4, 5])
    expect(displayPosition(6, 6)).toBe(0)
    expect(sortDays([4, 6, 0, 4, 9], 6)).toEqual([6, 0, 4])
    expect(formatDayList([3, 0, 5], 0)).toBe('Mon, Thu, Sat')
  })

  it('uses Monday = 0 for today', () => {
    expect(todayIndex(new Date(2026, 8, 28))).toBe(0)
    expect(todayIndex(new Date(2026, 8, 27))).toBe(6)
  })
})
