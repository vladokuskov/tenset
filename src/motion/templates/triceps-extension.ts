import type { Pose, Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO } from '../timing.ts'
import { SCHEMAS } from './schemas.ts'
import type { P } from './triceps/common.ts'
import { kickbackContext, sampleKickback, type Kickback } from './triceps/kickback.ts'
import { lyingContext, sampleLying, type Lying } from './triceps/lying.ts'
import { overheadContext, sampleOverhead, type Overhead } from './triceps/overhead.ts'
import { pushdownContext, samplePushdown, type Pushdown } from './triceps/pushdown.ts'
import { sampleSeated, seatedContext, type Seated } from './triceps/seated.ts'
import { memo, type Template } from './types.ts'

// Triceps extension (F8): the upper arm holds still at the variant's shoulder angle and the elbow runs its full range,
// ~110-135 deg flexion to lockout (motion-authoring research, template 10: shoulder 0 pushdown, ~170 overhead, ~90-110
// skull crusher, extended on the kickback; Maeo 2023 for the overhead long-head stretch). Contraction c = 1 is lockout.
// - pushdown: rope (spreading at lockout) or straight bar on a high pulley in front (triceps/pushdown.ts)
// - lying: EZ skull crusher on a flat bench (triceps/lying.ts)
// - overhead: rope from a high pulley behind, staggered stance, facing away from the stack (triceps/overhead.ts)
// - seated: overhead extension with one dumbbell in both hands, back against an upright pad (triceps/seated.ts)
// - kickback: one arm, the free knee and hand on a flat bench (triceps/kickback.ts)

type Ctx = Pushdown | Lying | Seated | Overhead | Kickback

const context = memo((p: P, skel: Skeleton): Ctx => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.implement === 'cable' && p.posture === 'standing' && p.shoulderFlexion <= 30 && (p.attachment === 'rope' || p.attachment === 'straight_bar')) return pushdownContext(p, skel, tempo)
  if (p.implement === 'cable' && p.posture === 'standing' && p.shoulderFlexion >= 150 && p.attachment === 'rope' && p.stance === 'split') return overheadContext(p, skel, tempo)
  if (p.implement === 'ez_bar' && p.posture === 'lying_supine') return lyingContext(p, skel, tempo)
  if (p.implement === 'dumbbell' && p.posture === 'seated' && p.hold === 'two_hand' && p.shoulderFlexion >= 150) return seatedContext(p, skel, tempo)
  if (p.implement === 'dumbbell' && p.support === 'bench' && p.torsoAngle >= 60 && p.laterality === 'unilateral') return kickbackContext(p, skel, tempo)
  throw new Error(`triceps-extension: variant not implemented yet (${p.implement}/${p.posture}/${p.attachment ?? p.hold}/${p.shoulderFlexion})`)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const v = context(p, skel)
  const s =
    v.kind === 'pushdown' ? samplePushdown(u, p, skel, v)
    : v.kind === 'lying' ? sampleLying(u, p, skel, v)
    : v.kind === 'seated' ? sampleSeated(u, p, skel, v)
    : v.kind === 'overhead' ? sampleOverhead(u, p, skel, v)
    : sampleKickback(u, p, skel, v)
  return { ...s, contacts: v.setup.contacts }
}

export const tricepsExtension: Template<P> = {
  id: 'triceps-extension',
  driver: 'joint',
  params: SCHEMAS['triceps-extension'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
