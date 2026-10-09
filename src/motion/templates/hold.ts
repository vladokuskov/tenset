import type { Pose, Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt } from '../timing.ts'
import { copenhagenContext, sampleCopenhagen, type Copenhagen } from './core/copenhagen.ts'
import { handPlankContext, sampleHandPlank, type HandPlank } from './core/hand-plank.ts'
import { hollowContext, sampleHollow, type Hollow } from './core/hollow.ts'
import { lSitContext, sampleLSit, type LSit } from './core/l-sit.ts'
import { pallofContext, samplePallof, type Pallof } from './core/pallof.ts'
import { dipFor, frontContext, samplePlank, sideContext, type Plank } from './core/plank.ts'
import { sampleSuitcase, suitcaseContext, type Suitcase } from './core/suitcase.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { memo, type Template } from './types.ts'

// Holds: forearm front plank (804, and the long-lever plank 829 with the elbows ahead of the shoulders) and side plank
// (803; the hip dip 830 lowers and drives the hips each rep) as breathing holds (core/plank.ts), the hollow body hold
// (815, core/hollow.ts), the suitcase hold (824, core/suitcase.ts), the bear plank (841) and the high plank shoulder tap (828) on flat palms (core/hand-plank.ts),
// and the Pallof press (808 cable, 823 band), an anti-rotation press out and back from the chest
// with the pause at arm's length (core/pallof.ts).

type P = ParamsOf<'hold'>
type Ctx = Plank | Pallof | Hollow | HandPlank | Suitcase | Copenhagen | LSit

const context = memo((p: P, skel: Skeleton): Ctx => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.kind === 'front_plank' && p.implement === 'bodyweight' && p.support === 'forearm') return frontContext(skel, tempo, p.elbowsAhead)
  if (p.kind === 'side_plank' && p.implement === 'bodyweight' && p.support === 'forearm' && p.legs === 'stacked') {
    const v = sideContext(p, skel, tempo)
    if (p.hipDip) v.dip = dipFor(skel, v, p.hipDip)
    return v
  }
  if (p.kind === 'copenhagen_plank' && p.implement === 'bodyweight' && p.support === 'forearm' && p.laterality === 'unilateral') return copenhagenContext(p, skel, tempo)
  if (p.kind === 'pallof_press' && (p.implement === 'cable' || p.implement === 'band') && p.pressOut) return pallofContext(p, skel, tempo)
  if (p.kind === 'hollow_hold' && p.implement === 'bodyweight') return hollowContext(skel, tempo)
  if (p.kind === 'l_sit' && p.implement === 'bodyweight' && p.support === 'hand') return lSitContext(skel, tempo)
  if (p.kind === 'suitcase_hold' && p.implement === 'dumbbell' && p.laterality === 'unilateral') return suitcaseContext(p, skel, tempo)
  if (p.implement === 'bodyweight' && p.support === 'hand' && (p.kind === 'bear_plank' || (p.kind === 'front_plank' && p.tap))) return handPlankContext(p, skel, tempo)
  throw new Error(`hold: variant not implemented yet (${p.kind}/${p.implement}/${p.support}/${p.legs}${p.kind === 'pallof_press' ? `/pressOut ${p.pressOut}` : ''})`)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  switch (ctx.kind) {
    case 'plank': return samplePlank(skel, ctx, c)
    case 'pallof': return samplePallof(skel, ctx, c)
    case 'hollow': return sampleHollow(skel, ctx, c)
    case 'hand_plank': return sampleHandPlank(skel, ctx, c)
    case 'suitcase': return sampleSuitcase(skel, ctx, c)
    case 'copenhagen': return sampleCopenhagen(skel, ctx, c)
    case 'l_sit': return sampleLSit(skel, ctx, c)
  }
}

export const hold: Template<P> = {
  id: 'hold',
  driver: 'root',
  params: SCHEMAS.hold,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
