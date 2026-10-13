import { z } from 'zod'
import { Exercise, SplitTemplate } from '../domain/schema.ts'
import type { Catalog } from '../domain/resolve.ts'
import { bundledRecords } from './bundled.ts'
import { replacementMap } from './parse.ts'

const warn = (message: string) => {
  if (import.meta.env.DEV) console.warn(`[catalog] ${message}`)
}

// Records arrive with empty cues (vite.config.ts shippedData); localize.ts loads them in a separate chunk.
const exerciseModules = import.meta.glob<unknown>('../../data/exercises/*.json', { eager: true, import: 'default', query: '?shipped' })
const splitModules = import.meta.glob<unknown>('../../data/splits/*.json', { eager: true, import: 'default' })

const ShippedExercise = Exercise.extend({ cues: z.tuple([]) })

/** Every valid record, retired ones included (old programs and links still resolve). */
export const exercises: readonly Exercise[] = bundledRecords(exerciseModules, ShippedExercise, warn).sort((a, b) => a.id - b.id)
export const activeExercises: readonly Exercise[] = exercises.filter((e) => e.status === 'active')
export const catalog: Catalog = new Map(exercises.map((e) => [e.id, e]))
export const exerciseBySlug: ReadonlyMap<string, Exercise> = new Map(exercises.map((e) => [e.slug, e]))
export const replacedBy: ReadonlyMap<number, number> = replacementMap(exercises)

export const splits: readonly SplitTemplate[] = bundledRecords(splitModules, SplitTemplate, warn).sort(
  (a, b) => a.daysPerWeek - b.daysPerWeek || a.id.localeCompare(b.id),
)
export const splitById: ReadonlyMap<string, SplitTemplate> = new Map(splits.map((s) => [s.id, s]))
