import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

// Dev-only: in production builds DEV is false and the figure chunk is dropped from this route.
const DevMotion = import.meta.env.DEV ? lazy(() => import('../features/figure/motion/DevMotion')) : null

const VIEWS = ['front', 'side', 'back', 'hero'] as const

type Search = {
  id?: number
  t?: number
  paused?: number
  view?: (typeof VIEWS)[number]
  yaw?: number
  live?: number
  focus?: string
  size?: number
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined)

export const Route = createFileRoute('/dev/motion')({
  validateSearch: (s: Record<string, unknown>): Search => {
    const t = num(s.t)
    return {
      id: num(s.id),
      t: t === undefined ? undefined : Math.min(1, Math.max(0, t)),
      paused: s.paused === undefined ? undefined : s.paused === 0 || s.paused === '0' || s.paused === false ? 0 : 1,
      view: VIEWS.find((v) => v === s.view),
      yaw: num(s.yaw),
      live: s.live === 1 || s.live === '1' || s.live === true ? 1 : undefined,
      focus: typeof s.focus === 'string' ? s.focus : undefined,
      size: num(s.size),
    }
  },
  component: DevMotionRoute,
})

function DevMotionRoute() {
  const { id, t, paused, view, yaw, live, focus, size } = Route.useSearch()
  if (!DevMotion) return null
  return (
    <Suspense fallback={null}>
      <DevMotion key={`${id}|${live}`} id={id ?? 711} t={t} paused={paused === 1} view={view} yaw={yaw} live={live === 1} focus={focus ? { bone: focus, size: size ?? 0.3 } : undefined} />
    </Suspense>
  )
}
