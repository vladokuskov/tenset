import { fk } from '../../fk.ts'
import { add, lerp, qid, scale, sub, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Pose, type Side, type Skeleton } from '../../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../../timing.ts'
import { arms, fitGhd, PALMS, plantedFeet } from '../back-extension.ts'
import { palmRests } from '../../implements/hinge.ts'
import type { FootTarget } from '../../constraints.ts'
import type { ImplementSpec } from '../../implements.ts'
import type { ParamsOf } from '../schemas.ts'
import { setPelvis } from '../standing.ts'
import { memo, type Setup } from '../types.ts'

// Glute-ham raise on a glute-ham developer (leg-curl, bodyweight kneeling, support ghd). The shins lie level with the
// ankles between the rollers and the soles on the foot plate; the round pad sits just past the knees under the lower
// thighs. The body stays straight from the knees to the head (hips extended, arms crossed) and pivots about the knees:
// from upright (knee flexion ~90) forward and down to level (knee ~5), then the hamstrings curl it back up.
// Research (motion-authoring, leg-curl): the hamstrings work through knee flexion ~0-90 with the hips extended, the
// GHR adding the glutes as hip extensors; the knee angle is keyed.

type P = ParamsOf<'leg-curl'>

/** knee flexion upright and at the level bottom, deg; hip flexion held (a straight body) */
export const GHR = { top: 90, bottom: 5, hip: 4 }
/** the shins lie level at this ankle height, m (the station's default: pad top plus a centimetre) */
const ANKLE_Y = 0.99
/** the round pad's front edge this far past the knee joints, under the lower thighs, m */
const PAST_KNEE = 0.1
/** the lower thighs and knees ride over the round pad and the trunk folds near it (padded; soft tissue, lead decision) */
const REST_TOL = 25

type Ctx = { tempo: Tempo; setup: Setup; ghd: ImplementSpec; at: V3; feet: FootTarget[]; ankle: V3; palms: ImplementSpec }

/** body for knee flexion k: the shins level with the ankles at `ankle`, the straight body pitched forward 90 - k */
function body(skel: Skeleton, q: Float64Array, k: number, ankle: V3) {
  setDofs(skel, q, {
    'hip_*.flex': GHR.hip, 'knee_*.flex': k, 'ankle_*.df': -4, 'lumbar.flex': 0, 'thorax.flex': 0, 'neck.flex': 4, 'head.flex': 2,
    'clavicle_*.prot': 8, 'clavicle_*.elev': 0,
  })
  setPelvis(skel, q, [0, 1, 0], 90 - k + GHR.hip)
  const f = fk(skel, q)
  const mid = scale(add(f.pos[skel.seg.foot_l], f.pos[skel.seg.foot_r]), 0.5)
  const d = sub(ankle, mid)
  q[skel.dof['pelvis.tx']] += d[0]
  q[skel.dof['pelvis.ty']] += d[1]
  q[skel.dof['pelvis.tz']] += d[2]
}

const context = memo((p: P, skel: Skeleton): Ctx => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const ankle: V3 = [0, ANKLE_Y, 0]
  const q = zeroQ(skel)
  body(skel, q, GHR.bottom, ankle)
  const f = fk(skel, q)
  const feet: FootTarget[] = (['l', 'r'] as Side[]).map((side) => ({ side, rot: f.rot[skel.seg[`foot_${side}`]], ankle: f.pos[skel.seg[`foot_${side}`]] }))
  const knee = scale(add(f.pos[skel.seg.tibia_l], f.pos[skel.seg.tibia_r]), 0.5)
  const { spec, at } = fitGhd(skel, f, knee, ankle, -PAST_KNEE, /^(thigh|shank)_/)
  const palms = palmRests({ id: 'palms', ...PALMS })
  const setup: Setup = {
    implements: [spec, palms],
    contacts: [...plantedFeet(skel, feet), { site: 'grip_l', kind: 'grip', target: { implement: 'palms', grip: 'l' } }, { site: 'grip_r', kind: 'grip', target: { implement: 'palms', grip: 'r' } }],
    tempo,
    symmetric: false,
    rests: [{ implement: spec.id, regions: ['thigh_l', 'thigh_r', 'shank_l', 'shank_r'], tol: REST_TOL }],
  }
  return { tempo, setup, ghd: spec, at, feet, ankle, palms }
})

export function ghrSetup(p: P, skel: Skeleton): Setup {
  return context(p, skel).setup
}

export function ghrSample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const q = zeroQ(skel)
  body(skel, q, lerp(GHR.bottom, GHR.top, phaseAt(u, ctx.tempo).c), ctx.ankle)
  arms(skel, q)
  const f = fk(skel, q)
  return {
    q,
    implements: [{ id: ctx.ghd.id, pos: ctx.at, rot: qid() }, { id: ctx.palms.id, pos: f.pos[skel.seg.thorax2], rot: f.rot[skel.seg.thorax2] }],
    contacts: ctx.setup.contacts,
  }
}
