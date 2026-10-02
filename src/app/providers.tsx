import type { ReactNode } from 'react'
import { CatalogContext, defaultCatalogData, useLocalizedCatalog, type CatalogData } from './useCatalog'

export function AppProviders({ children, catalog = defaultCatalogData }: { children: ReactNode; catalog?: CatalogData }) {
  return <CatalogContext value={useLocalizedCatalog(catalog)}>{children}</CatalogContext>
}
