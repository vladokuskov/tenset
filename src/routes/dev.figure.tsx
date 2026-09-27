import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

// Dev-only: in production builds DEV is false and the figure chunk is dropped from this route.
const DevFigure = import.meta.env.DEV ? lazy(() => import('../features/figure/DevFigure')) : null

type Search = {
  scene?: string
  pose?: string
  view?: string
  cor?: number
  focus?: string
  size?: number
  lift?: number
  hl?: string
  pulse?: number
  atlas?: 'off' | 'flat'
  ortho?: number
}

export const Route = createFileRoute('/dev/figure')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    // the router JSON-parses search values, so inline poses arrive as objects
    scene: typeof s.scene === 'string' ? s.scene : undefined,
    pose: typeof s.pose === 'string' ? s.pose : s.pose && typeof s.pose === 'object' ? JSON.stringify(s.pose) : undefined,
    view: typeof s.view === 'string' ? s.view : undefined,
    cor: s.cor === 0 ? 0 : undefined,
    focus: typeof s.focus === 'string' ? s.focus : undefined,
    size: typeof s.size === 'number' ? s.size : undefined,
    lift: typeof s.lift === 'number' ? s.lift : undefined,
    hl: typeof s.hl === 'string' ? s.hl : undefined,
    pulse: typeof s.pulse === 'number' ? s.pulse : undefined,
    atlas: s.atlas === 'off' || s.atlas === 'flat' ? s.atlas : undefined,
    ortho: s.ortho === 1 ? 1 : undefined,
  }),
  component: DevFigureRoute,
})

function DevFigureRoute() {
  const { scene, pose, view, cor, focus, size, lift, hl, pulse, atlas, ortho } = Route.useSearch()
  if (!DevFigure) return null
  return (
    <Suspense fallback={null}>
      <DevFigure
        scene={scene}
        pose={pose}
        view={view}
        correctives={cor !== 0}
        focus={focus ? { bone: focus, size: size ?? 0.4, lift } : undefined}
        hl={hl}
        pulse={pulse}
        atlas={atlas}
        ortho={ortho === 1}
      />
    </Suspense>
  )
}
