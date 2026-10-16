import { describe, expect, it } from 'vitest'
import type { Pattern } from '../../domain/schema'
import { movementRows } from './movement'

const e = (day: number, sets: number, ref: number | string, pattern: Pattern | null) => ({
  day,
  sets,
  exercise: { ref, pattern },
})

const entries = [
  e(0, 3, 1, 'horizontal_push'),
  e(0, 3, 2, 'incline_push'),
  e(2, 4, 1, 'horizontal_push'),
  e(2, 3, 3, 'squat'),
  e(4, 2, 'c1', null),
]

describe('movementRows', () => {
  it('sums sets and counts distinct exercises across the week', () => {
    const rows = movementRows(entries)
    expect(rows.map((r) => r.key)).toEqual(['push', 'pull', 'shoulders', 'arms', 'legs', 'core', 'other'])
    expect(rows[0]).toEqual({ key: 'push', sets: 10, exercises: 2 })
    expect(rows[4]).toEqual({ key: 'legs', sets: 3, exercises: 1 })
    expect(rows[6]).toEqual({ key: 'other', sets: 2, exercises: 1 })
    expect(rows[1]).toEqual({ key: 'pull', sets: 0, exercises: 0 })
  })

  it('filters to one day and drops other when it has no sets', () => {
    const rows = movementRows(entries, 2)
    expect(rows).toHaveLength(6)
    expect(rows[0]).toEqual({ key: 'push', sets: 4, exercises: 1 })
    expect(rows[4]).toEqual({ key: 'legs', sets: 3, exercises: 1 })
  })

  it('returns six empty rows for a rest day', () => {
    expect(movementRows(entries, 1).every((r) => r.sets === 0 && r.exercises === 0)).toBe(true)
  })
})
