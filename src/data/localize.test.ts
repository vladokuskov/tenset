import { describe, expect, it, vi } from 'vitest'
import { sessionLabel } from './localize.ts'

describe('sessionLabel', () => {
  it('reads a template session label in the current language', () => {
    expect(sessionLabel('Full body A', 'uk')).toBe('Все тіло A')
    expect(sessionLabel('Все тіло A', 'en')).toBe('Full body A')
    expect(sessionLabel('full body a', 'uk')).toBe('Все тіло A')
  })

  it('leaves labels the user typed as they are', () => {
    expect(sessionLabel('Heavy day', 'uk')).toBe('Heavy day')
    expect(sessionLabel(undefined, 'uk')).toBeUndefined()
  })
})

describe('exercise text', () => {
  async function fresh() {
    vi.resetModules()
    const [localize, catalog] = await Promise.all([import('./localize.ts'), import('./catalog.ts')])
    return { ...localize, bench: catalog.exerciseBySlug.get('barbell-bench-press')! }
  }

  it('loads English cues and Ukrainian text on demand, then notifies', async () => {
    const { bench, localizeExercise, loadExerciseText, subscribeExerciseText, exerciseTextVersion } = await fresh()
    expect(localizeExercise(bench, 'en').cues).toEqual([])
    expect(localizeExercise(bench, 'uk').name).toBe('Barbell Bench Press')

    const listener = vi.fn()
    subscribeExerciseText(listener)
    await loadExerciseText('en')
    expect(listener).toHaveBeenCalledOnce()
    expect(localizeExercise(bench, 'en').cues.length).toBeGreaterThanOrEqual(3)
    expect(localizeExercise(bench, 'en').name).toBe('Barbell Bench Press')

    await loadExerciseText('uk')
    expect(exerciseTextVersion()).toBe(2)
    const uk = localizeExercise(bench, 'uk')
    expect(uk.name).not.toBe('Barbell Bench Press')
    expect(uk.cues).toHaveLength(localizeExercise(bench, 'en').cues.length)
  })

  it('keeps cues a record already has', async () => {
    const { bench, localizeExercise, loadExerciseText } = await fresh()
    await loadExerciseText('en')
    const own = { ...bench, cues: ['Mine', 'Also mine', 'Third'] }
    expect(localizeExercise(own, 'en').cues).toEqual(own.cues)
  })
})
