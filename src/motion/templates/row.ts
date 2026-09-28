import type { Pose, Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO } from '../timing.ts'
import { benchContext, sampleBench, type BenchRow } from './row/bench.ts'
import { bentContext, sampleBent, type Bent } from './row/bent.ts'
import { cableContext, sampleCable, type StandingCable } from './row/cable.ts'
import type { P } from './row/common.ts'
import { invertedContext, sampleInverted, type Inverted } from './row/inverted.ts'
import { sampleSeated, seatedContext, type Seated } from './row/seated.ts'
import { SCHEMAS } from './schemas.ts'
import { memo, type Template } from './types.ts'

// Row family (F4). Every variant reads as scapular retraction first, then the elbow drive, with a neutral spine and
// no torso yank (row/common.ts). Variants:
// - bent: standing barbell row, trunk hinged to torsoAngle (row/bent.ts)
// - seated: cable row on the row station, V-bar or wide bar (row/seated.ts)
// - cable: standing face pull with a rope, single-arm row with a D-handle (row/cable.ts)
// - inverted: body under a racked bar, heels down, pivoting about the ankles (row/inverted.ts)
// - bench: one-arm dumbbell row off a flat bench, chest-supported dumbbell row on an incline pad (row/bench.ts)

type Ctx = Bent | Seated | BenchRow | Inverted | StandingCable

function unsupported(p: P): string {
  return `${p.implement}/${p.posture}/${p.support}${p.attachment ? `/${p.attachment}` : ''}`
}

const context = memo((p: P, skel: Skeleton): Ctx => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.implement === 'barbell' && p.posture === 'standing' && p.support === 'none') return bentContext(p, skel, tempo)
  if (p.implement === 'dumbbell' && ((p.support === 'bench' && p.posture === 'standing') || (p.support === 'chest_pad' && p.posture === 'lying_prone'))) return benchContext(p, skel, tempo)
  if (p.implement === 'barbell' && p.posture === 'lying_supine') return invertedContext(p, skel, tempo)
  if (p.implement === 'cable' && p.posture === 'standing' && (p.attachment === 'rope' || p.attachment === 'single_handle')) return cableContext(p, skel, tempo)
  if (p.implement === 'cable' && p.posture === 'seated' && (p.attachment === 'v_bar' || p.attachment === 'long_bar')) return seatedContext(p, skel, tempo)
  throw new Error(`row: variant not implemented yet (${unsupported(p)})`)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  switch (ctx.kind) {
    case 'bent':
      return sampleBent(u, p, skel, ctx)
    case 'seated':
      return sampleSeated(u, p, skel, ctx)
    case 'bench':
      return sampleBench(u, p, skel, ctx)
    case 'inverted':
      return sampleInverted(u, p, skel, ctx)
    case 'cable':
      return sampleCable(u, p, skel, ctx)
  }
}

export const row: Template<P> = {
  id: 'row',
  driver: 'implement',
  params: SCHEMAS.row,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
