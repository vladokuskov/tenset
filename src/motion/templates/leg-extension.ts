import { lerp } from '../math.ts'
import { zeroQ, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { seatedMachine, seatedPose, type SeatedMachine } from './knee-machine.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { memo, type Setup, type Template } from './types.ts'

// Leg extension, joint space: the knees extend from ~90 deg to a near-straight lockout (research: knee ~90 -> ~5, hip
// fixed) while the hips stay down on the seat at the record's hip angle (90 upright seat, 40 reclined for the rectus
// femoris, Larsen 2025). The pad rides on the lower shins on a lever that turns about the knee axis.

type P = ParamsOf<'leg-extension'>

export const KNEE = { start: 90, lockout: 4 }

type Ctx = { tempo: Tempo; setup: Setup; m: SeatedMachine }

const context = memo((p: P, skel: Skeleton): Ctx => {
  if (p.implement !== 'machine') throw new Error(`leg-extension: variant not implemented yet (${p.implement})`)
  if (p.laterality === 'alternating') throw new Error(`leg-extension: variant not implemented yet (${p.laterality})`)
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const m = seatedMachine(skel, { hipAngle: p.hipAngle, kind: 'leg_extension', knee: KNEE.start })
  const setup: Setup = {
    implements: [m.machine, m.lever, m.handles],
    contacts: m.contacts,
    tempo,
    symmetric: p.laterality === 'bilateral',
    rests: [{ implement: m.lever.id, regions: ['shank_l', 'shank_r'], tol: 15 }],
  }
  return { tempo, setup, m }
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const knee = lerp(KNEE.start, KNEE.lockout, phaseAt(u, ctx.tempo).c)
  const q = zeroQ(skel)
  const implements_ = seatedPose(skel, ctx.m, p.hipAngle, knee, q)
  // single leg: the other knee stays bent behind the pad, which lifts away from its shin
  if (p.laterality === 'unilateral') q[skel.dof[`knee_${p.side === 'left' ? 'r' : 'l'}.flex`]] = KNEE.start
  return { q, implements: implements_, contacts: ctx.setup.contacts }
}

export const legExtension: Template<P> = {
  id: 'leg-extension',
  driver: 'joint',
  params: SCHEMAS['leg-extension'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
