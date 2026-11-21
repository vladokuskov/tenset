import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { groupParam, optionalEnum, sheetParam, textParam } from '../app/search'
import type { MovementGroupId } from '../domain/movement'
import { LibraryPage } from '../features/catalog/LibraryPage'

// URL contract: /?q=rdl&muscle=hamstrings&equip=mine|all&move=legs&sheet=muscle|equipment|exercise (&ex=<slug> for exercise)
const LibrarySearch = z.object({
  q: textParam,
  muscle: groupParam,
  equip: optionalEnum(['mine', 'all']),
  move: optionalEnum(['push', 'pull', 'shoulders', 'arms', 'legs', 'core'] as const satisfies readonly MovementGroupId[]),
  sheet: sheetParam(['muscle', 'equipment', 'exercise']),
  ex: z.string().regex(/^[a-z0-9-]{1,80}$/).optional().catch(undefined),
})

export const Route = createFileRoute('/')({
  validateSearch: LibrarySearch,
  component: LibraryPage,
})
