import { createContext, useContext } from 'react'
import * as data from '../data/catalog'
import type { Catalog } from '../domain/resolve'
import type { Exercise, SplitTemplate } from '../domain/schema'

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

export const CatalogContext = createContext<CatalogData>(defaultCatalogData)

/** Static catalog from data/ (overridable through AppProviders for tests and previews). */
export function useCatalog(): CatalogData {
  return useContext(CatalogContext)
}
