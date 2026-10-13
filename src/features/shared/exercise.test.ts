import { describe, expect, it } from 'vitest'
import { fixtureExercise } from '../../domain/test-fixtures'
import { localReps, matchesQuery, normalize, repsText, rowMeta, supersetLabels } from './exercise'

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
    expect(repsText('45s', 'reps', 'en')).toBe('45 s')
    expect(repsText('30-45s', 'seconds', 'uk')).toBe('30-45 с')
    expect(rowMeta(press, [], 'en')).toBe('No muscles mapped')
    expect(rowMeta(press, ['Груди'], 'uk')).toBe('Груди')
  })
})

describe('supersetLabels', () => {
  it('letters pairs in order and leaves solo entries blank', () => {
    const labels = supersetLabels([{}, { withPrev: true }, {}, {}, { withPrev: true }, {}])
    expect(labels.map((l) => l?.label ?? null)).toEqual(['A1', 'A2', null, 'B1', 'B2', null])
    expect(labels[4]?.position).toBe(2)
  })

  it('ignores a stray flag on the first entry or after a pair', () => {
    expect(supersetLabels([{ withPrev: true }, {}]).every((l) => l === null)).toBe(true)
    expect(supersetLabels([{}, { withPrev: true }, { withPrev: true }]).map((l) => l?.label ?? null)).toEqual(['A1', 'A2', null])
  })
})

it('localReps writes a pasted time target in the locale and leaves reps alone', () => {
  expect(localReps('60s', 'uk')).toBe('60 с')
  expect(localReps('30-45s', 'en')).toBe('30-45 s')
  expect(localReps('8-12', 'uk')).toBe('8-12')
  expect(localReps(undefined, 'uk')).toBeUndefined()
})
