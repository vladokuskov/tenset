import { describe, expect, it } from 'vitest'
import { stem } from './stem'

describe('stem', () => {
  it.each([
    ['штанга', 'штанг'],
    ['штанги', 'штанг'],
    ['штангою', 'штанг'],
    ['присідання', 'присід'],
    ['приседания', 'присед'],
    ['підтягування', 'підтяг'],
    ['подтягивания', 'подтяг'],
    ['гантелей', 'гантел'],
    ['гантелями', 'гантел'],
    ['ёлка', 'елк'],
    ['жим', 'жим'],
    ['ноги', 'ног'],
    ['squats', 'squat'],
    ['press', 'press'],
    ['ups', 'up'],
    ['ab', 'ab'],
  ])('%s -> %s', (word, want) => {
    expect(stem(word)).toBe(want)
  })

  it('folds the letters Ukrainian and Russian spell differently', () => {
    expect(stem('гиперэкстензия')).toBe('гиперекстензи')
    expect(stem('пʼєдестал')).toBe(stem('пʼедестал'))
  })
})
