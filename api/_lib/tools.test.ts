import { describe, expect, it } from 'vitest'
import { decodeProgram } from '../../src/domain/codec.ts'
import type { Exercise } from '../../src/domain/schema.ts'
import { catalog } from './catalog.ts'
import { ToolError, createProgram, listSplits, readProgram, searchExercises, type ProgramInput } from './tools.ts'

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
    expect(chest).toMatchObject({ sets: 3, band: 'light' })
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

  it('returns the whole active catalog without filters', () => {
    const active = [...catalog.values()].filter((e) => e.status === 'active').length
    expect(searchExercises({}).count).toBe(active)
  })
})

it('lists splits with named options', () => {
  const split = listSplits().find((s) => s.id === 'bro-5x')!
  expect(split.sessions[0].slots[0].options[0]).toEqual({ id: 101, name: 'Barbell Bench Press' })
})
