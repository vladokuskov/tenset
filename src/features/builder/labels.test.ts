import { describe, expect, it } from 'vitest'
import { fixtureExercise } from '../../domain/test-fixtures'
import { matchesQuery, normalize, repsText, rowMeta } from './labels'

const press = fixtureExercise(1, {
  name: 'Жим лежачи',
  aliases: ['Жим штанги лежачи', 'Bench press'],
  groups: { chest: 'primary' },
})
const raise = fixtureExercise(2, { name: 'Підйоми на мʼязи', groups: { lats: 'primary' } })

describe('normalize', () => {
  it('keeps Cyrillic letters and folds apostrophes', () => {
    expect(normalize('  Жим, ШТАНГИ!  ')).toBe('жим штанги')
    expect(normalize("м'яз")).toBe(normalize('мʼяз'))
    expect(normalize('м’яз')).toBe(normalize('мʼяз'))
    expect(normalize('Café 3/4')).toBe('cafe 3 4')
  })
})

describe('matchesQuery', () => {
  it('matches Cyrillic queries by word prefix', () => {
    expect(matchesQuery(press, 'жим леж')).toBe(true)
    expect(matchesQuery(press, 'штанг')).toBe(true)
    expect(matchesQuery(press, 'bench')).toBe(true)
    expect(matchesQuery(press, 'присід')).toBe(false)
    expect(matchesQuery(raise, "м'яз")).toBe(true)
  })
})

describe('copy', () => {
  it('reads in both languages', () => {
    expect(repsText('8-12', 'reps', 'en')).toBe('8-12 reps')
    expect(repsText('8-12', 'reps', 'uk')).toBe('8-12 повт.')
    expect(repsText(undefined, 'seconds', 'en')).toBe('Time')
    expect(rowMeta(press, [], 'en')).toBe('No muscles mapped')
    expect(rowMeta(press, ['Груди'], 'uk')).toBe('Груди')
  })
})
