import { Exercise, SplitTemplate } from '../domain/schema.ts'
import type { Catalog } from '../domain/resolve.ts'
import { parseRecords, replacementMap } from './parse.ts'

const warn = (message: string) => {
  if (import.meta.env.DEV) console.warn(`[catalog] ${message}`)
}

const exerciseModules = import.meta.glob<unknown>('../../data/exercises/*.json', { eager: true, import: 'default' })
const splitModules = import.meta.glob<unknown>('../../data/splits/*.json', { eager: true, import: 'default' })

/** Every valid record, retired ones included (old programs and links still resolve). */
export const exercises: readonly Exercise[] = parseRecords(exerciseModules, Exercise, warn).sort((a, b) => a.id - b.id)
export const activeExercises: readonly Exercise[] = exercises.filter((e) => e.status === 'active')
export const catalog: Catalog = new Map(exercises.map((e) => [e.id, e]))
export const exerciseBySlug: ReadonlyMap<string, Exercise> = new Map(exercises.map((e) => [e.slug, e]))
export const replacedBy: ReadonlyMap<number, number> = replacementMap(exercises)

export const splits: readonly SplitTemplate[] = parseRecords(splitModules, SplitTemplate, warn).sort(
  (a, b) => a.daysPerWeek - b.daysPerWeek || a.id.localeCompare(b.id),
)
export const splitById: ReadonlyMap<string, SplitTemplate> = new Map(splits.map((s) => [s.id, s]))
