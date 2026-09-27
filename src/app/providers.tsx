import type { ReactNode } from 'react'
import { CatalogContext, defaultCatalogData, type CatalogData } from './useCatalog'

export function AppProviders({ children, catalog = defaultCatalogData }: { children: ReactNode; catalog?: CatalogData }) {
  return <CatalogContext value={catalog}>{children}</CatalogContext>
}
