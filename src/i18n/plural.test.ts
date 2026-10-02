import { describe, expect, it } from 'vitest'
import { plural } from './plural'

const sets = { one: 'підхід', few: 'підходи', many: 'підходів', other: 'підходу' }

describe('plural', () => {
  it('picks Ukrainian forms', () => {
    expect([0, 1, 2, 4, 5, 11, 12, 21, 22, 25, 111].map((n) => `${n} ${plural('uk', n, sets)}`)).toEqual([
      '0 підходів',
      '1 підхід',
      '2 підходи',
      '4 підходи',
      '5 підходів',
      '11 підходів',
      '12 підходів',
      '21 підхід',
      '22 підходи',
      '25 підходів',
      '111 підходів',
    ])
    expect(plural('uk', 7.5, sets)).toBe('підходу')
    expect(plural('uk', 0.5, sets)).toBe('підходу')
  })

  it('picks English forms and falls back to other', () => {
    expect(plural('en', 1, { one: 'set', other: 'sets' })).toBe('set')
    expect(plural('en', 0.5, { one: 'set', other: 'sets' })).toBe('sets')
    expect(plural('uk', 2, { one: 'a', other: 'b' })).toBe('b')
  })
})
