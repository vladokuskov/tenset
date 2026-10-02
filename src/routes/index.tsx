import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { daySlugParam, groupParam, optionalEnum, sheetParam } from '../app/search'
import { PlanScreen } from '../features/builder/PlanScreen'

// URL contract: /?sheet=menu | programs | share | export | paste | map (1024-1279 week map) | add (&day=mon &tab=... &group=chest for add)
const PlanSearch = z.object({
  sheet: sheetParam(['menu', 'programs', 'share', 'export', 'paste', 'map', 'add']),
  day: daySlugParam,
  tab: optionalEnum(['suggested', 'muscle', 'equipment', 'pattern']),
  group: groupParam,
})

export const Route = createFileRoute('/')({
  validateSearch: PlanSearch,
  component: PlanScreen,
})
