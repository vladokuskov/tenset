import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { DAY_SLUGS } from '../app/days'
import { daySlugParam, sheetParam } from '../app/search'
import { ExercisePage } from '../features/catalog/ExerciseDetail'

// URL contract: /exercise/incline-dumbbell-press?sheet=days|counts
//   &addTo=0..6 (or mon..sun): the sticky button adds straight to that day
//   &from=mon: preselects that day in the picker
const ExerciseSearch = z.object({
  sheet: sheetParam(['days', 'counts']),
  from: daySlugParam,
  addTo: z.union([z.number().int().min(0).max(6), z.enum(DAY_SLUGS)]).optional().catch(undefined),
})

export const Route = createFileRoute('/exercise/$slug')({
  validateSearch: ExerciseSearch,
  component: ExercisePage,
})
