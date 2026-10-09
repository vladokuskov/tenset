import type { Pose, Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO } from '../timing.ts'
import { lyingContext, sampleLying, type Lying } from './pullover/lying.ts'
import { sampleStanding, standingContext, type Standing } from './pullover/standing.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { memo, type Template } from './types.ts'

// Pullover (tier C, family back): shoulder extension with the elbows held nearly straight, the lats' long-lever pull.
// Variants: standing straight-arm pulldown with a cable straight bar or a band anchored high (pullover/standing.ts);
// dumbbell pullover lying on a flat bench, one dumbbell in both palms (pullover/lying.ts).

type P = ParamsOf<'pullover'>

function unsupported(p: P): string | null {
  if (p.laterality !== 'bilateral') return p.laterality
  if (p.posture === 'standing') {
    if (p.implement === 'dumbbell') return 'dumbbell standing'
    if (p.implement === 'cable' && (p.attachment ?? 'straight_bar') !== 'straight_bar') return `cable ${p.attachment}`
    if (p.implement === 'cable' && p.cableHeight !== 'high') return `cable ${p.cableHeight} pulley`
    if (p.grip !== 'pronated') return `standing grip ${p.grip}`
    if (p.stance !== 'hip') return `stance ${p.stance}`
    if (p.hold !== 'hands') return `standing hold ${p.hold}`
    return null
  }
  if (p.implement !== 'dumbbell' || p.hold !== 'two_hand') return `lying ${p.implement} ${p.hold}`
  return null
}

const context = memo((p: P, skel: Skeleton): Standing | Lying => {
  const why = unsupported(p)
  if (why) throw new Error(`pullover: variant not implemented yet (${why})`)
  const tempo = p.tempo ?? DEFAULT_TEMPO
  return p.posture === 'standing' ? standingContext(p, skel, tempo) : lyingContext(p, skel, tempo)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  return ctx.kind === 'standing' ? sampleStanding(u, p, skel, ctx) : sampleLying(u, p, skel, ctx)
}

export const pullover: Template<P> = {
  id: 'pullover',
  driver: 'implement',
  params: SCHEMAS.pullover,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
