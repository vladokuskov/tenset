import { root1d } from '../../constraints.ts'
import { bodyCapsules, type Capsule } from '../../collide.ts'
import { fk, sitePos } from '../../fk.ts'
import type { ImplementSpec } from '../../implements.ts'
import { palmRest } from '../../implements/core.ts'
import { dls } from '../../ik.ts'
import { lerp, norm, qid, type V3 } from '../../math.ts'
import { setDofs, shoulderRhythm, zeroQ, type Contact, type ImplementPose, type Pose, type Side, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { ARM_DOFS, MAT_TOP, matClearance, segPosOf, SINK } from '../core/floor.ts'
import { flatArm, FOOT_SINK, HAND_SINK, WRIST_FLEX } from '../core/hand-plank.ts'
import type { ParamsOf } from '../schemas.ts'
import type { Setup } from '../types.ts'
import { matUnder } from './common.ts'

// Bird dog (814): on hands and knees, palms flat under the shoulders, knees under the hips, toes tucked, back flat.
// The working arm reaches forward to shoulder height (thumb up) as the opposite leg pushes back to hip height, the
// pause at full reach is the top pause, and both come back under the body (one working side per loop; `side` names the
// reaching arm). The hips stay level and square. The palm stays the hand-plank flat palm (core/hand-plank.ts). Research
// (motion-authoring): spinal stabilisation drills keep a neutral spine; hip extension to ~0 deg, shoulder flexion to
// ~170 deg; the angles are author judgment.

type P = ParamsOf<'floor-core'>

/** deg: knee flexion kneeling (solved), toes tucked, the reaching arm (shoulder elevation in the flexion plane, elbow,
 * the twist kept from the flat palm), the extending leg's hip extension past the line of the trunk, elbow of the support arm */
export const BIRD_DOG = { toes: -55, reach: 168, elbow: 3, hipBack: 4, support: 6, neck: -6 } as const
const HANDS_AHEAD = 0.04
const PALM_LIFT = 0.001

export type Quadruped = {
  kind: 'quadruped'
  tempo: Tempo
  setup: Setup
  work: Side
  tilt: number
  ty: number
  knee: number
  /** extended leg's knee flexion, deg */
  kneeOut: number
  palms: ImplementSpec
  pole: V3
  flat: number[]
  mat: ImplementPose
}

const LEG = (c: Capsule) => c.region.startsWith('shank_') || c.region.startsWith('thigh_')
const FOREFOOT = (c: Capsule) => c.name.startsWith('forefoot_')
const other = (s: Side): Side => (s === 'l' ? 'r' : 'l')

export function base(skel: Skeleton, q: Float64Array, v: Pick<Quadruped, 'tilt' | 'ty' | 'knee'>) {
  setDofs(skel, q, {
    'lumbar.flex': 0,
    'thorax.flex': 0,
    'neck.flex': BIRD_DOG.neck,
    'head.flex': 0,
    'clavicle_*.prot': 4,
    'clavicle_*.elev': 3,
    // thighs straight down from the hips
    'hip_*.flex': v.tilt,
    'hip_*.abd': 1,
    'knee_*.flex': v.knee,
    'ankle_*.df': 0,
    'toe_*.flex': BIRD_DOG.toes,
    'grip_*.close': 0,
  })
  q[skel.dof['pelvis.tilt']] = v.tilt
  q[skel.dof['pelvis.ty']] = v.ty
}

/** knees and tucked toes on the mat for this tilt: root height and knee flexion */
export function kneel(skel: Skeleton, tilt: number): { ty: number; knee: number } {
  const q = zeroQ(skel)
  const res = (x: number[]) => {
    base(skel, q, { tilt, ty: x[0], knee: x[1] })
    const caps = bodyCapsules(skel, fk(skel, q))
    return [(matClearance(caps.filter(LEG)) + SINK) * 100, (matClearance(caps.filter(FOREFOOT)) + SINK / 2) * 100]
  }
  const s = dls(res, [0.55, 90], { tol: 1e-8, iters: 80 })
  return { ty: s.x[0], knee: s.x[1] }
}

function palmSites(skel: Skeleton, q: Float64Array): Record<Side, V3> {
  const sh = segPosOf(skel, fk(skel, q), 'humerus_l')
  const l: V3 = [sh[0] * 0.95, MAT_TOP + PALM_LIFT, sh[2] + HANDS_AHEAD]
  return { l, r: [-l[0], l[1], l[2]] }
}

const armDofs = (skel: Skeleton, q: Float64Array, side: Side) => ARM_DOFS.map((k) => q[skel.dof[k.replace('*', side)]])

export function quadrupedContext(p: P, skel: Skeleton, tempo: Tempo): Quadruped {
  const work: Side = p.side === 'left' ? 'l' : 'r'
  const pole: V3 = norm([0.25, -0.2, -1])
  const q = zeroQ(skel)
  // the trunk tilt (about level) at which the arms reach the palms under the shoulders with the support elbow
  const elbow = (tilt: number) => {
    base(skel, q, { tilt, ...kneel(skel, tilt) })
    flatArm(skel, q, 'l', palmSites(skel, q).l, pole)
    return q[skel.dof['elbow_l.flex']] - BIRD_DOG.support
  }
  const tilt = root1d(elbow, 60, 110, { tol: 1e-6, scan: 11 }).x
  const k = kneel(skel, tilt)
  const v = { tilt, ...k }
  base(skel, q, v)
  const sites = palmSites(skel, q)
  flatArm(skel, q, work, sites[work], pole)
  const flat = armDofs(skel, q, work)
  const palms = palmRest({ id: 'hands', sites: { [other(work)]: sites[other(work)] } })
  const f = fk(skel, q)
  const stay = other(work) === 'l' ? 'r' : 'l'
  // the leg that stays down is on the reaching arm's side: its tucked toes stay planted
  const contacts: Contact[] = [
    { site: `grip_${other(work)}`, kind: 'grip', target: { implement: palms.id, grip: other(work) } },
    { site: `grip_${work}`, kind: 'grip', target: { implement: 'reach', grip: work } },
    ...(['ball', 'toe'] as const).map((s): Contact => ({ site: `${s}_${stay}`, kind: 'planted', target: { world: sitePos(skel, f, `${s}_${stay}`) } })),
  ]
  const ctx: Quadruped = { kind: 'quadruped', tempo, setup: undefined as unknown as Setup, work, ...v, kneeOut: p.kneeAngle ?? 4, palms, pole, flat, mat: undefined as unknown as ImplementPose }
  const poses = [0, 1].map((c) => sampleQuadruped(skel, ctx, c).q)
  const mat = matUnder(skel, poses, 0.12)
  ctx.mat = mat.pose
  ctx.setup = {
    implements: [mat.spec, palms, palmRest({ id: 'reach', sites: { [work]: [0, 0, 0] } })],
    contacts,
    tempo,
    symmetric: false,
    rests: [{ implement: mat.spec.id, regions: ['hand_l', 'hand_r', 'foot_l', 'foot_r'], tol: Math.max(HAND_SINK, FOOT_SINK) }],
    limits: { 'wrist_l.flex': WRIST_FLEX, 'wrist_r.flex': WRIST_FLEX },
    tolerances: { floor: FOOT_SINK },
  }
  return ctx
}

export function sampleQuadruped(skel: Skeleton, v: Quadruped, c: number): Pose {
  const q = zeroQ(skel)
  base(skel, q, v)
  const w = v.work, o = other(w)
  // the opposite leg pushes back: the thigh from straight down to in line with the trunk, the knee and the toes open
  setDofs(skel, q, {
    [`hip_${o}.flex`]: lerp(v.tilt, v.tilt - 90 - BIRD_DOG.hipBack, c),
    [`knee_${o}.flex`]: lerp(v.knee, v.kneeOut, c),
    [`ankle_${o}.df`]: lerp(0, 5, c),
    [`toe_${o}.flex`]: lerp(BIRD_DOG.toes, 0, c),
  })
  flatArm(skel, q, o, v.palms.sites[o].pos, v.pole)
  // the reaching arm: from the flat palm on the mat to straight ahead at shoulder height. The elevation leads (the hand
  // lifts off the mat and forward first); the arm's twist and the wrist keep the flat palm's, so the hand reaches
  // palm down without swinging out to the side
  const lead = 1 - (1 - c) * (1 - c)
  const reach = [shoulderRhythm(BIRD_DOG.reach, 90).uprot, 90, BIRD_DOG.reach, v.flat[3], BIRD_DOG.elbow, v.flat[5], 0, 0]
  ARM_DOFS.forEach((name, i) => (q[skel.dof[name.replace('*', w)]] = lerp(v.flat[i], reach[i], name.endsWith('.elev') || name.endsWith('.uprot') ? lead : c)))
  const hand = sitePos(skel, fk(skel, q), `grip_${w}`)
  return { q, implements: [v.mat, { id: v.palms.id, pos: [0, 0, 0], rot: qid() }, { id: 'reach', pos: hand, rot: qid() }], contacts: v.setup?.contacts ?? [] }
}
