import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { groupParam, optionalEnum, patternParam, sheetParam, textParam } from '../app/search'
import { CatalogPage } from '../features/catalog/CatalogPage'

// URL contract: /exercises?q=rdl&muscle=hamstrings&equip=mine|all&pattern=hinge&level=1&sheet=muscle
const ExercisesSearch = z.object({
  q: textParam,
  muscle: groupParam,
  equip: optionalEnum(['mine', 'all']),
  pattern: patternParam,
  level: z.number().int().min(1).max(3).optional().catch(undefined),
  sheet: sheetParam(['muscle', 'pattern', 'level']),
})

export const Route = createFileRoute('/exercises')({
  validateSearch: ExercisesSearch,
  component: CatalogPage,
})
