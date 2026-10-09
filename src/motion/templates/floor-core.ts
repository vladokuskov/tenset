import type { Pose, Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt } from '../timing.ts'
import { climberContext, sampleClimber, type Climber } from './floor-core/climber.ts'
import { dragonContext, sampleDragon, type Dragon } from './floor-core/dragon.ts'
import { quadrupedContext, sampleQuadruped, type Quadruped } from './floor-core/quadruped.ts'
import { proneContext, sampleProne, type Prone } from './floor-core/prone.ts'
import { sampleSupine, supineContext, type Supine } from './floor-core/supine.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { memo, type Template } from './types.ts'

// Floor core drills (tier C), one template with a `kind`. Joint driver: limb and trunk angles keyframed per kind.
// Supine on the mat (floor-core/supine.ts): dead bug (813), bicycle (820), V-up (837). Prone (floor-core/prone.ts):
// superman hold (842). On hands and knees (floor-core/quadruped.ts): bird dog (814). High plank
// (floor-core/climber.ts): mountain climber (816). On a flat bench (floor-core/dragon.ts): dragon flag (839). Alternating kinds show one working-side rep per loop (the wave 3b precedent).

type P = ParamsOf<'floor-core'>
type Ctx = Supine | Prone | Quadruped | Climber | Dragon

const context = memo((p: P, skel: Skeleton): Ctx => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const floor = (p.support ?? 'floor') === 'floor'
  if (floor && (p.kind === 'dead_bug' || p.kind === 'bicycle' || p.kind === 'v_up')) return supineContext(p, skel, tempo)
  if (floor && p.kind === 'superman') return proneContext(skel, tempo)
  if (floor && p.kind === 'bird_dog') return quadrupedContext(p, skel, tempo)
  if (floor && p.kind === 'mountain_climber') return climberContext(p, skel, tempo)
  if (p.kind === 'dragon_flag' && p.support === 'bench') return dragonContext(skel, tempo)
  throw new Error(`floor-core: variant not implemented yet (${p.kind}/${p.support ?? '-'})`)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  switch (ctx.kind) {
    case 'supine': return sampleSupine(skel, ctx, c)
    case 'prone': return sampleProne(skel, ctx, c)
    case 'quadruped': return sampleQuadruped(skel, ctx, c)
    case 'climber': return sampleClimber(skel, ctx, c)
    case 'dragon': return sampleDragon(skel, ctx, c)
  }
}

export const floorCore: Template<P> = {
  id: 'floor-core',
  driver: 'joint',
  params: SCHEMAS['floor-core'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
