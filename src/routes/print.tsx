import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { optionalEnum } from '../app/search'
import { PrintPage } from '../features/export/PrintPage'

// URL contract: /print is the week table with the map; /print?layout=gym is the gym sheet with boxes per set.
const PrintSearch = z.object({ layout: optionalEnum(['gym']) })

export const Route = createFileRoute('/print')({
  validateSearch: PrintSearch,
  component: PrintPage,
})
