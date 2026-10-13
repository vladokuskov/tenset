import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

// Dev only: vite.config.ts leaves src/routes/dev.* out of the production route tree.
const ReviewPage = lazy(() => import('../features/review/ReviewPage'))

const STATUSES = ['pending', 'rejected', 'approved', 'all'] as const

type Search = { id?: number; status?: (typeof STATUSES)[number] }

export const Route = createFileRoute('/dev/review')({
  validateSearch: (s: Record<string, unknown>): Search => {
    const id = typeof s.id === 'number' ? s.id : typeof s.id === 'string' ? Number(s.id) : NaN
    return {
      id: Number.isInteger(id) && id > 0 ? id : undefined,
      status: STATUSES.find((v) => v === s.status),
    }
  },
  component: DevReviewRoute,
})

function DevReviewRoute() {
  const { id, status } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <Suspense fallback={null}>
      <ReviewPage id={id} status={status ?? 'pending'} onNavigate={(search) => void navigate({ search, replace: true })} />
    </Suspense>
  )
}
