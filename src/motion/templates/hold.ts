import type { Pose, Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt } from '../timing.ts'
import { pallofContext, samplePallof, type Pallof } from './core/pallof.ts'
import { frontContext, samplePlank, sideContext, type Plank } from './core/plank.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { memo, type Template } from './types.ts'

// Holds: forearm front plank (804) and side plank (803) as breathing holds (core/plank.ts), and the Pallof press
// (808), an anti-rotation press out and back from the chest with the pause at arm's length (core/pallof.ts).

type P = ParamsOf<'hold'>
type Ctx = Plank | Pallof

const context = memo((p: P, skel: Skeleton): Ctx => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.kind === 'front_plank' && p.implement === 'bodyweight' && p.support === 'forearm') return frontContext(skel, tempo)
  if (p.kind === 'side_plank' && p.implement === 'bodyweight' && p.support === 'forearm' && p.legs === 'stacked') return sideContext(p, skel, tempo)
  if (p.kind === 'pallof_press' && p.implement === 'cable' && p.pressOut) return pallofContext(p, skel, tempo)
  throw new Error(`hold: variant not implemented yet (${p.kind}/${p.implement}/${p.support}/${p.legs}${p.kind === 'pallof_press' ? `/pressOut ${p.pressOut}` : ''})`)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  return ctx.kind === 'plank' ? samplePlank(skel, ctx, c) : samplePallof(skel, ctx, c)
}

export const hold: Template<P> = {
  id: 'hold',
  driver: 'root',
  params: SCHEMAS.hold,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
