import { createFileRoute, notFound } from '@tanstack/react-router'
import { z } from 'zod'
import { isDaySlug, type DaySlug } from '../app/days'
import { groupParam, idParam, optionalEnum, sheetParam } from '../app/search'
import { DayScreen } from '../features/builder/DayScreen'

// URL contract: /day/mon?sheet=add (&tab=suggested|muscle|equipment|pattern &group=chest)
//               /day/mon?sheet=entry|move|copy|swap&entry=<entryId>
//               /day/mon?sheet=day (label, note, duplicate, clear, rest)
//               /day/mon?sheet=image (PNG of the day, from day options)
//               /day/mon?sheet=custom&id=new (new custom exercise, from the add sheet)
const DaySearch = z.object({
  sheet: sheetParam(['add', 'entry', 'reps', 'move', 'copy', 'swap', 'day', 'image', 'custom']),
  entry: idParam,
  id: idParam,
  tab: optionalEnum(['suggested', 'muscle', 'equipment', 'pattern']),
  group: groupParam,
})

export const Route = createFileRoute('/day/$dow')({
  params: {
    parse: ({ dow }) => ({ dow: dow as DaySlug }),
    stringify: ({ dow }) => ({ dow }),
  },
  beforeLoad: ({ params }) => {
    if (!isDaySlug(params.dow)) throw notFound()
  },
  validateSearch: DaySearch,
  component: DayScreen,
})
