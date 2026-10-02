import { createContext, useContext, useMemo } from 'react'
import * as data from '../data/catalog'
import { localizeExercise, localizeSplit } from '../data/localize'
import type { Catalog } from '../domain/resolve'
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
  if (locale === 'en') return base
  const exercises = base.exercises.map((e) => localizeExercise(e, locale))
  const splits = base.splits.map((s) => localizeSplit(s, locale))
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

const cache = new WeakMap<CatalogData, Map<Locale, CatalogData>>()

export function useLocalizedCatalog(base: CatalogData): CatalogData {
  const locale = useLocale()
  return useMemo(() => {
    let byLocale = cache.get(base)
    if (!byLocale) cache.set(base, (byLocale = new Map()))
    let c = byLocale.get(locale)
    if (!c) byLocale.set(locale, (c = localizeCatalog(base, locale)))
    return c
  }, [base, locale])
}
