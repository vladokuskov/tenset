import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import * as data from '../data/catalog'
import {
  exerciseTextVersion,
  loadAllExerciseText,
  loadExerciseText,
  localizeExercise,
  localizeSplit,
  subscribeExerciseText,
} from '../data/localize'
import type { Catalog } from '../domain/resolve'
import { whenIdle } from './idle'
import type { Exercise, SplitTemplate } from '../domain/schema'
import type { Locale } from '../i18n/locale'
import { useLocale } from '../i18n/messages'

export type CatalogData = {
  /** Every valid record, retired ones included. */
  exercises: readonly Exercise[]
  activeExercises: readonly Exercise[]
  catalog: Catalog
  exerciseBySlug: ReadonlyMap<string, Exercise>
  replacedBy: ReadonlyMap<number, number>
  splits: readonly SplitTemplate[]
  splitById: ReadonlyMap<string, SplitTemplate>
}

export const defaultCatalogData: CatalogData = {
  exercises: data.exercises,
  activeExercises: data.activeExercises,
  catalog: data.catalog,
  exerciseBySlug: data.exerciseBySlug,
  replacedBy: data.replacedBy,
  splits: data.splits,
  splitById: data.splitById,
}

/** Same records with names, cues and template text in the given language. */
export function localizeCatalog(base: CatalogData, locale: Locale): CatalogData {
  const exercises = base.exercises.map((e) => localizeExercise(e, locale))
  const splits = locale === 'en' ? base.splits : base.splits.map((s) => localizeSplit(s, locale))
  return {
    exercises,
    activeExercises: exercises.filter((e) => e.status === 'active'),
    catalog: new Map(exercises.map((e) => [e.id, e])),
    exerciseBySlug: new Map(exercises.map((e) => [e.slug, e])),
    replacedBy: base.replacedBy,
    splits,
    splitById: new Map(splits.map((s) => [s.id, s])),
  }
}

export const CatalogContext = createContext<CatalogData>(defaultCatalogData)

/** Static catalog from data/ (overridable through AppProviders for tests and previews). */
export function useCatalog(): CatalogData {
  return useContext(CatalogContext)
}

const cache = new WeakMap<CatalogData, Map<string, CatalogData>>()

/**
 * Exercise text fills in as its lazy chunk arrives: names for a non-English UI right away, the rest (cues, other
 * languages for paste matching) at idle. The detail route loads its cues itself.
 */
export function useLocalizedCatalog(base: CatalogData): CatalogData {
  const locale = useLocale()
  const version = useSyncExternalStore(subscribeExerciseText, exerciseTextVersion)
  useEffect(() => {
    if (locale !== 'en') void loadExerciseText(locale).catch(() => undefined)
    return whenIdle(() => void loadAllExerciseText().catch(() => undefined))
  }, [locale])
  return useMemo(() => {
    let byKey = cache.get(base)
    if (!byKey) cache.set(base, (byKey = new Map()))
    const key = `${locale}:${version}`
    let c = byKey.get(key)
    if (!c) byKey.set(key, (c = localizeCatalog(base, locale)))
    return c
  }, [base, locale, version])
}
