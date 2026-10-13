import { describe, expect, it } from 'vitest'
import { decodeProgram } from '../../src/domain/codec.ts'
import type { Exercise } from '../../src/domain/schema.ts'
import { buildCatalogIndex, englishSearchLabels, searchCatalog } from '../../src/domain/search.ts'
import { catalog, exercises } from './catalog.ts'
import { ToolError, createProgram, getReference, listSplits, readProgram, searchExercises, type ProgramInput } from './tools.ts'

const ORIGIN = 'https://example.test'

const upperLower: ProgramInput = {
  name: 'Upper/Lower',
  days: [
    { day: 0, label: 'Upper', entries: [{ exerciseId: 101, sets: 3, reps: '6-8' }, { exerciseId: 301, sets: 3 }] },
    { day: 3, label: 'Lower', note: 'Go easy', entries: [{ exerciseId: 401, sets: 4, reps: '5 reps' }, { exerciseId: 'c1', sets: 2 }] },
  ],
  custom: [{ id: 'c1', name: 'Sled push', equipment: [], laterality: 'bilateral', groups: { quads: 'primary', glute_max: 'secondary' } }],
}

const problemsOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    if (e instanceof ToolError) return e.problems
    throw e
  }
  throw new Error('expected a ToolError')
}

describe('createProgram', () => {
  it('returns a share link that decodes back to the input', () => {
    const { url } = createProgram(upperLower, ORIGIN)
    expect(url.startsWith(`${ORIGIN}/shared#`)).toBe(true)
    const decoded = decodeProgram(url.split('#')[1])
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    const p = decoded.program
    expect(p.name).toBe('Upper/Lower')
    expect(p.days.map((d) => d.kind)).toEqual(['train', 'rest', 'rest', 'train', 'rest', 'rest', 'rest'])
    expect(p.days[0].entries.map((e) => [e.exerciseId, e.sets, e.reps])).toEqual([[101, 3, '6-8'], [301, 3, undefined]])
    expect(p.days[3]).toMatchObject({ label: 'Lower', note: 'Go easy' })
    expect(p.days[3].entries[1].exerciseId).toBe('c1')
    expect(p.custom).toEqual(upperLower.custom)
  })

  it('round-trips through readProgram', () => {
    const { url } = createProgram(upperLower, ORIGIN)
    const { summary, ...back } = readProgram(url)
    expect(back).toEqual(upperLower)
    expect(summary.days[0].exercises[0]).toBe('Barbell Bench Press: 3 x 6-8')
  })

  it('reports weekly sets with bands', () => {
    const { weeklySets } = createProgram(upperLower, ORIGIN)
    const chest = weeklySets.find((g) => g.group === 'chest')
    expect(chest).toMatchObject({ sets: 3, band: 'light', target: [10, 20] })
  })

  it('carries rest, RIR and supersets through the link and back', () => {
    const input: ProgramInput = {
      name: 'Push',
      days: [
        {
          day: 0,
          entries: [
            { exerciseId: 101, sets: 3, reps: '6-8', restSec: 180, rir: 2 },
            { exerciseId: 301, sets: 3, restSec: 60 },
            { exerciseId: 401, sets: 2, rir: 0, supersetWithPrevious: true },
          ],
        },
      ],
    }
    const result = createProgram(input, ORIGIN)
    expect(result).not.toHaveProperty('notes')
    const decoded = decodeProgram(result.url.split('#')[1])
    expect(decoded.ok && decoded.program.days[0].entries.map((e) => [e.restSec, e.rir, e.withPrev])).toEqual([
      [180, 2, undefined],
      [60, undefined, undefined],
      [undefined, 0, true],
    ])
    const { summary, ...back } = readProgram(result.url)
    expect(back).toEqual({ ...input, custom: [] })
    expect(summary.days[0].exercises[0]).toBe('Barbell Bench Press: 3 x 6-8, rest 180s, RIR 2')
    expect(summary.days[0].exercises[1]).toMatch(/^\(superset A1\) .+: 3 x .+, rest 60s$/)
    expect(summary.days[0].exercises[2]).toMatch(/^\(superset A2\) .+: 2 x .+, RIR 0$/)
  })

  it('rounds rest to the 15 second step', () => {
    const { url } = createProgram({ name: 'Rest', days: [{ day: 0, entries: [{ exerciseId: 101, sets: 3, restSec: 97 }] }] }, ORIGIN)
    expect(readProgram(url).days[0].entries[0].restSec).toBe(90)
  })

  it('drops supersets the pairs-only rule cannot keep, with a note', () => {
    const entries = [
      { exerciseId: 101, sets: 3, supersetWithPrevious: true },
      { exerciseId: 301, sets: 3, supersetWithPrevious: true },
      { exerciseId: 401, sets: 3, supersetWithPrevious: true },
    ]
    const result = createProgram({ name: 'Chain', days: [{ day: 2, entries }] }, ORIGIN)
    expect(result.notes).toEqual([
      'Wednesday entry 1: supersetWithPrevious ignored, the first entry of a day has nothing to pair with',
      'Wednesday entry 3: supersetWithPrevious ignored, entry 2 is already paired (supersets are pairs only)',
    ])
    expect(readProgram(result.url).days[0].entries.map((e) => e.supersetWithPrevious)).toEqual([undefined, true, undefined])
  })

  it('lists every problem at once', () => {
    const problems = problemsOf(() =>
      createProgram(
        {
          name: 'Bad',
          days: [
            { day: 1, entries: [{ exerciseId: 9999, sets: 3 }, { exerciseId: 'c5', sets: 2 }] },
            { day: 1, entries: [] },
          ],
          custom: [{ id: 'c1', name: 'X', equipment: ['spaceship'], laterality: 'bilateral', groups: { wings: 'primary' } }],
        },
        ORIGIN,
      ),
    )
    expect(problems).toEqual([
      'custom c1: unknown equipment "spaceship"',
      'custom c1: unknown muscle group "wings"',
      'Tuesday entry 1: exerciseId 9999 does not exist, use search_exercises to find ids',
      'Tuesday entry 2: custom exercise c5 is not defined in "custom"',
      'Tuesday is listed twice',
    ])
  })

  it('rejects retired exercises and points at the replacement', () => {
    const base = catalog.get(101)!
    const map = catalog as Map<number, Exercise>
    map.set(60000, { ...base, id: 60000, status: 'retired', replacedBy: 101 })
    try {
      const problems = problemsOf(() => createProgram({ name: 'Old', days: [{ day: 0, entries: [{ exerciseId: 60000, sets: 3 }] }] }, ORIGIN))
      expect(problems).toEqual(['Monday entry 1: exerciseId 60000 (Barbell Bench Press) is retired, use 101 (Barbell Bench Press) instead'])
    } finally {
      map.delete(60000)
    }
  })

  it('applies schema limits', () => {
    const problems = problemsOf(() =>
      createProgram({ name: 'Too much', days: [{ day: 0, label: 'x'.repeat(30), entries: [{ exerciseId: 101, sets: 21 }] }] }, ORIGIN),
    )
    expect(problems).toHaveLength(2)
  })
})

describe('searchExercises', () => {
  it('filters by group, equipment and words', () => {
    const { exercises } = searchExercises({ group: 'chest', equipment: ['dumbbell', 'flat_bench', 'adjustable_bench'] })
    expect(exercises.length).toBeGreaterThan(0)
    expect(exercises[0].groups.chest).toBe('primary')
    for (const e of exercises) expect(e.equipment.every((x) => ['dumbbell', 'flat_bench', 'adjustable_bench'].includes(x))).toBe(true)
    expect(searchExercises({ query: 'bench press' }).exercises.map((e) => e.id)).toContain(101)
  })

  it('matches spellings the app search folds', () => {
    const pullUps = (q: string) => searchExercises({ query: q }).exercises.map((e) => e.id)
    expect(pullUps('pullup').toSorted()).toEqual(pullUps('pull-up').toSorted())
    expect(pullUps('pullup').length).toBeGreaterThan(5)
    expect(searchExercises({ query: 'bench pres' }).exercises.map((e) => e.id)).toContain(101)
  })

  it('uses the shared search core, so results match the app', () => {
    const active = exercises.filter((e) => e.status === 'active')
    const index = buildCatalogIndex(active, englishSearchLabels)
    for (const q of ['pullup', 'pull up', 'bench pres', 'chinup', 'chest', 'row', 'cable curl']) {
      expect(searchExercises({ query: q }).exercises.map((e) => e.id), q).toEqual(searchCatalog(active, index, q).map((e) => e.id))
    }
  })

  it('ranks primary movers first for a muscle word', () => {
    const list = searchExercises({ query: 'chest' }).exercises
    const firstOther = list.findIndex((e) => e.groups.chest !== 'primary')
    expect(list.slice(firstOther).every((e) => e.groups.chest !== 'primary')).toBe(true)
  })

  it('returns the whole active catalog without filters', () => {
    const active = [...catalog.values()].filter((e) => e.status === 'active').length
    expect(searchExercises({}).count).toBe(active)
  })
})

it('lists splits with named options', () => {
  const split = listSplits().find((s) => s.id === 'bro-5x')!
  expect(split.sessions[0].slots[0].options[0]).toEqual({ id: 101, name: 'Barbell Bench Press' })
})

it('lists rest and RIR limits in the reference', () => {
  expect(getReference().limits).toMatchObject({ restMaxSec: 600, restStepSec: 15, rirMax: 5 })
})
