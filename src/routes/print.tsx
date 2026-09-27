import { createFileRoute } from '@tanstack/react-router'
import { PrintPage } from '../features/export/PrintPage'

export const Route = createFileRoute('/print')({
  component: PrintPage,
})
