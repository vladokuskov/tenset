import type { Pose, Skeleton } from '../../skeleton.ts'
import { DEFAULT_TEMPO } from '../../timing.ts'
import type { ParamsOf } from '../schemas.ts'
import { memo, type Setup } from '../types.ts'
import { abductedContext, sampleAbducted } from './abducted.ts'
import { concentrationContext, sampleConcentration } from './concentration.ts'
import { dragContext, sampleDrag } from './drag.ts'
import { preacherContext, samplePreacher } from './preacher.ts'
import { sampleWaiter, waiterContext } from './waiter.ts'

// Curl variants with their own body or hold (wave 3b), dispatched before the approved curl paths, which they never
// touch: drag curl (path drag), concentration curl (support thigh), waiter curl (hold two_hand), high cable curl (armPosition abducted),
// and (wave 3c) the preacher curl (support preacher).

type P = ParamsOf<'curl'>

type Variant = { setup: Setup; sample: (u: number) => Pose }

/** true when the params ask for one of these variants */
export const isCurlVariant = (p: P) => p.path === 'drag' || p.support === 'thigh' || p.support === 'preacher' || p.hold === 'two_hand' || p.armPosition === 'abducted'

const context = memo((p: P, skel: Skeleton): Variant => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.path === 'drag' && p.implement === 'barbell' && p.posture === 'standing') {
    const v = dragContext(p, skel, tempo)
    return { setup: v.setup, sample: (u) => sampleDrag(u, skel, v) }
  }
  if (p.support === 'thigh' && p.implement === 'dumbbell' && p.posture === 'seated' && p.laterality === 'unilateral') {
    const v = concentrationContext(p, skel, tempo)
    return { setup: v.setup, sample: (u) => sampleConcentration(u, skel, v) }
  }
  if (p.support === 'preacher' && p.posture === 'seated' && (p.implement === 'ez_bar' || (p.implement === 'dumbbell' && p.laterality === 'unilateral'))) {
    const v = preacherContext(p, skel, tempo)
    return { setup: v.setup, sample: (u) => samplePreacher(u, skel, v) }
  }
  if (p.hold === 'two_hand' && p.implement === 'dumbbell' && p.posture === 'standing') {
    const v = waiterContext(p, skel, tempo)
    return { setup: v.setup, sample: (u) => sampleWaiter(u, skel, v) }
  }
  if (p.armPosition === 'abducted' && p.implement === 'cable' && p.attachment === 'single_handle' && p.posture === 'standing') {
    const v = abductedContext(p, skel, tempo)
    return { setup: v.ctx.setup, sample: (u) => sampleAbducted(u, skel, v) }
  }
  throw new Error(`curl: variant not implemented yet (${p.implement}/${p.posture}/${p.path ?? p.support ?? p.hold ?? p.armPosition})`)
})

export const variantSetup = (p: P, skel: Skeleton) => context(p, skel).setup
export const variantSample = (u: number, p: P, skel: Skeleton) => context(p, skel).sample(u)
