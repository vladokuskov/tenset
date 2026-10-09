import { attachHand, type FootTarget } from '../constraints.ts'
import { fk, sitePos } from '../fk.ts'
import { siteWorld, type ImplementSpec } from '../implements.ts'
import { AB_WHEEL, abWheel, abWheelPose } from '../implements/portable-c.ts'
import { floorMat } from '../implements/shared.ts'
import { dls } from '../ik.ts'
import { add, angleBetween, DEG, dist, lerp, norm, qaxis, qid, qmul, qrot, RAD, scale, sub, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Side, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { bodyCapsules, type Capsule } from '../collide.ts'
import { footContacts, legToward, MAT_TOP, matClearance, SINK } from './core/floor.ts'
import { FOOT_SINK } from './core/hand-plank.ts'
import { base, kneel } from './floor-core/quadruped.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { naturalCubic } from './solve.ts'
import { memo, type Setup, type Template } from './types.ts'

// Ab wheel rollout (tier C). Implement driver: the wheel rolls out along the floor and back while the hands stay on
// its handles with straight arms. Kneeling (811): on a mat, knees fixed, toes tucked; the thighs pivot forward about
// the knees and the hips open as the trunk lowers, the shoulders flexing from about vertical arms over the wheel to
// the `reach` overhead at full extension. Standing (810): the same from the feet, legs straight, the body pivoting
// about the balls of the feet (the heels rise as the legs lean). Oblique (812): kneeling, the wheel rolls out on a
// diagonal towards the working side and the trunk turns a little with it, hips square (one working side per loop).
// The slow eccentric rolls out, the quick concentric pulls the wheel back; the start curls the spine (ribs towards the
// hips, the cue), the far end flattens it. Research (motion-authoring): anti-extension; hip extension to ~0-20 deg of
// flexion at full rollout, shoulder flexion to ~150-170 deg; the keyframes are author judgment.

type P = ParamsOf<'rollout'>

/** keyframes, extended (c = 0) -> start (c = 1), deg: lean of the thighs (kneeling) or legs (standing) forward from
 * vertical, shoulder flexion (arm vs trunk; the extended end is `reach`), lumbar and thoracic flexion */
export const ROLL = {
  kneeling: { lean: [68, 6], shoulder: 82, lumbar: [2, 14], thorax: [3, 14] },
  standing: { lean: [74, 2], shoulder: 128, lumbar: [2, 16], thorax: [3, 16] },
} as const
/** oblique: the usual diagonal, deg; trunk turn towards it at full reach (lumbar, thoracic), deg */
export const OBLIQUE = { diagonal: 18, lumbar: 8, thorax: 22 } as const
/** standing: ankle dorsiflexion before the heels rise, deg; feet hip width apart, m */
const DF_MAX = 14
const FEET_HALF = 0.1
/** straight arms: elbow flexion, deg */
const ELBOW = 4
const REACH_SHORT = 0.004
/** kneeling pad: length, and its front edge this far ahead of the knees (the toes end inside its back edge), m */
const PAD = { length: 0.8, front: 0.14 }

type Ctx = {
  tempo: Tempo
  setup: Setup
  p: P
  standing: boolean
  work: Side
  /** heading of the wheel's path, deg (0 = straight ahead, + towards +X) */
  heading: number
  /** kneeling: the knee point the thighs pivot about; standing: the ball of each foot */
  knee: V3
  feet: FootTarget[]
  balls: V3[]
  wheel: ImplementSpec
  /** where the wheel starts (under the shoulders), the path's unit direction */
  start: V3
  dir: V3
  /** pelvis tilt and wheel travel from the start, splined over c */
  tilt: (c: number) => number
  travel: (c: number) => number
  mat?: ImplementPose
}

const THIGH = (c: Capsule) => c.region.startsWith('thigh_')
const K = (p: P) => (p.posture === 'standing' ? ROLL.standing : ROLL.kneeling)

/** body at contraction c with pelvis tilt `tilt`: spine, legs to their feet; returns q */
function body(skel: Skeleton, ctx: Ctx, c: number, tilt: number): Float64Array {
  const q = zeroQ(skel)
  const k = K(ctx.p)
  const lean = lerp(k.lean[0], k.lean[1], c) * DEG
  const s = ctx.work === 'r' ? 1 : -1
  const turn = ctx.p.direction === 'oblique' ? 1 - c : 0
  if (ctx.standing) {
    setDofs(skel, q, { 'toe_*.flex': 0 })
  } else base(skel, q, { tilt: 0, ty: 0, knee: 90 })
  setDofs(skel, q, {
    'lumbar.flex': lerp(k.lumbar[0], k.lumbar[1], c),
    'thorax.flex': lerp(k.thorax[0], k.thorax[1], c),
    // + turns left: towards a path heading to -X (right side) the trunk turns right
    'lumbar.rot': -s * OBLIQUE.lumbar * turn,
    'thorax.rot': -s * OBLIQUE.thorax * turn,
    'neck.flex': -4,
    'clavicle_*.elev': 6,
    'clavicle_*.prot': 6,
    'grip_*.close': 1,
  })
  // the hips on their arc: about the knees (kneeling) or over the feet's ankles (standing)
  const d = skel.dof
  const feet = ctx.standing ? standingFeet(skel, ctx, lean) : ctx.feet
  const pivot = ctx.standing ? scale(add(feet[0].ankle, feet[1].ankle), 0.5) : ctx.knee
  const len = ctx.standing ? legLength(skel) : skel.segments[skel.seg.femur_l].length
  const hip: V3 = add(pivot, [0, len * Math.cos(lean), len * Math.sin(lean)])
  q[d['pelvis.tilt']] = tilt
  const mid = scale(add(fk(skel, q).pos[skel.seg.femur_l], fk(skel, q).pos[skel.seg.femur_r]), 0.5)
  const off = sub(hip, mid)
  q[d['pelvis.tx']] += off[0]
  q[d['pelvis.ty']] += off[1]
  q[d['pelvis.tz']] += off[2]
  for (const ft of feet) legToward(skel, q, ft, ctx.standing ? [0, 0, 1] : [0, -1, 1])
  if (!ctx.standing) {
    // the knees roll forward onto the kneecaps as the thighs lean: the hips rise by what the thighs would sink
    for (let k = 0; k < 4; k++) {
      const sink = matClearance(bodyCapsules(skel, fk(skel, q)).filter(THIGH)) + SINK
      if (sink >= 0) break
      q[d['pelvis.ty']] -= sink
      for (const ft of feet) legToward(skel, q, ft, [0, -1, 1])
    }
  }
  if (ctx.standing) setDofs(skel, q, { 'toe_*.flex': -heelLift(lean) })
  return q
}

const legLength = (skel: Skeleton) => skel.segments[skel.seg.femur_l].length + skel.segments[skel.seg.tibia_l].length - 0.002

/** heel lift past DF_MAX of lean, deg, eased in (softplus) so the heels leave the floor smoothly */
const heelLift = (lean: number) => 4 * Math.log1p(Math.exp((lean * RAD - DF_MAX) / 4))

/** standing: each foot turned up about the ball of the foot by the lean past DF_MAX (the heel rises) */
function standingFeet(skel: Skeleton, ctx: Ctx, lean: number): FootTarget[] {
  const lift = heelLift(lean)
  return ctx.feet.map((ft, i) => {
    const rot = qmul(ft.rot, qaxis([1, 0, 0], lift * DEG))
    return { side: ft.side, rot, ankle: sub(ctx.balls[i], qrot(rot, skel.data.sites[`ball_${ft.side}`].local)) }
  })
}

function wheelPose(ctx: Ctx, travel: number): ImplementPose {
  const at = add(ctx.start, scale(ctx.dir, travel))
  return abWheelPose(ctx.wheel.id, at[0], at[2], ctx.heading)
}

function arms(skel: Skeleton, q: Float64Array, ctx: Ctx, pose: ImplementPose) {
  for (const side of ['l', 'r'] as const) {
    const g = siteWorld(ctx.wheel, pose, side)
    const s = side === 'l' ? 1 : -1
    attachHand(skel, q, side, { pos: g.pos, axis: g.axis!, palm: [0, -1, 0] }, { pole: [s * 0.3, -1, -0.6], planeHint: 90 })
  }
}

/** shoulder midpoint, the arms' mean direction to the handles and the trunk axis (pelvis to the upper thorax) */
function measure(skel: Skeleton, q: Float64Array, ctx: Ctx, pose: ImplementPose) {
  const f = fk(skel, q)
  const sh = scale(add(f.pos[skel.seg.humerus_l], f.pos[skel.seg.humerus_r]), 0.5)
  const grip = scale(add(siteWorld(ctx.wheel, pose, 'l').pos, siteWorld(ctx.wheel, pose, 'r').pos), 0.5)
  const trunk = norm(sub(f.pos[skel.seg.thorax2], f.pos[skel.seg.pelvis]))
  return { flexion: 180 - angleBetween(sub(grip, sh), trunk) * RAD }
}

function straightArm(skel: Skeleton): number {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'elbow_l.flex': ELBOW })
  const f = fk(skel, q)
  return dist(f.pos[skel.seg.humerus_l], sitePos(skel, f, 'grip_l'))
}

const context = memo((p: P, skel: Skeleton): Ctx => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const standing = p.posture === 'standing'
  if (standing && p.direction === 'oblique') throw new Error('rollout: variant not implemented yet (standing/oblique)')
  const work: Side = p.side === 'left' ? 'l' : 'r'
  const s = work === 'r' ? 1 : -1
  const heading = p.direction === 'oblique' ? -s * (p.diagonal ?? OBLIQUE.diagonal) : 0
  const dir: V3 = [Math.sin(heading * DEG), 0, Math.cos(heading * DEG)]
  const wheel = abWheel()
  let feet: FootTarget[], balls: V3[] = [], knee: V3 = [0, 0, 0]
  if (standing) {
    feet = (['l', 'r'] as const).map((side) => {
      const rot = qid()
      const x = side === 'l' ? FEET_HALF : -FEET_HALF
      const ball: V3 = [x, MAT_TOP, 0]
      return { side, rot, ankle: sub(ball, qrot(rot, skel.data.sites[`ball_${side}`].local)) }
    })
    balls = feet.map((ft) => add(ft.ankle, qrot(ft.rot, skel.data.sites[`ball_${ft.side}`].local)))
  } else {
    // kneeling upright (thighs vertical) on the mat: the knees and the tucked feet stay where this puts them
    const q = zeroQ(skel)
    base(skel, q, { tilt: 0, ...kneel(skel, 0) })
    const f = fk(skel, q)
    knee = scale(add(f.pos[skel.seg.tibia_l], f.pos[skel.seg.tibia_r]), 0.5)
    feet = (['l', 'r'] as const).map((side) => ({ side, rot: f.rot[skel.seg[`foot_${side}`]], ankle: f.pos[skel.seg[`foot_${side}`]] }))
  }
  const arm = straightArm(skel)
  const ctx: Ctx = { tempo, setup: undefined as unknown as Setup, p, standing, work, heading, knee, feet, balls, wheel, start: [0, 0, 0], dir, tilt: () => 0, travel: () => 0 }
  const k = K(p)
  // at each knot, the pelvis tilt and the wheel's travel that put the handles at straight-arm reach with this shoulder
  // flexion; the start point is where the wheel sits under the shoulders at c = 1
  const solve = (c: number, guess: number[], start?: V3) => {
    const flexion = lerp(p.reach, k.shoulder, c)
    const res = (x: number[]) => {
      const q = body(skel, ctx, c, x[0])
      const pose = start ? abWheelPose(wheel.id, start[0] + dir[0] * x[1], start[2] + dir[2] * x[1], heading) : abWheelPose(wheel.id, 0, x[1], heading)
      // with the arms on the handles: the shoulder girdle follows the arm's elevation
      arms(skel, q, ctx, pose)
      const m = measure(skel, q, ctx, pose)
      // the farther hand a few millimetres short of the straight arm, so neither elbow locks and the arm solve stays
      // smooth from frame to frame
      const f = fk(skel, q)
      const [a, b] = (['l', 'r'] as const).map((sd) => dist(f.pos[skel.seg[`humerus_${sd}`]], siteWorld(wheel, pose, sd).pos))
      // soft maximum: which arm is the farther one changes as the trunk turns, and a hard max would kink the travel
      const reach = 0.003 * Math.log(Math.exp(a / 0.003) + Math.exp(b / 0.003))
      return [(reach - arm + REACH_SHORT) * 100, (m.flexion - flexion) * 0.2]
    }
    return dls(res, guess, { tol: 1e-9, iters: 60 }).x
  }
  const top = solve(1, [standing ? 100 : 75, standing ? 0.5 : 0.6])
  ctx.start = [0, AB_WHEEL.R, top[1]]
  const cs = Array.from({ length: 13 }, (_, i) => 0.5 - 0.5 * Math.cos((Math.PI * i) / 12)).reverse()
  let guess = [top[0], 0]
  const knots = cs.map((c) => (guess = solve(c, guess, ctx.start)))
  const asc = cs.slice().reverse(), kn = knots.slice().reverse()
  ctx.tilt = naturalCubic(asc, kn.map((x) => x[0]))
  ctx.travel = naturalCubic(asc, kn.map((x) => x[1]))
  const contacts: Contact[] = [
    { site: 'grip_l', kind: 'grip', target: { implement: wheel.id, grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: wheel.id, grip: 'r' } },
    ...(standing ? [] : footContacts(skel, feet, ['ball', 'toe'])),
  ]
  // kneeling: a pad under the knees and the tucked toes (the wheel rolls on the floor)
  const pad = standing ? undefined : floorMat({ length: PAD.length, width: 0.6 })
  if (pad) ctx.mat = { id: pad.id, pos: [0, 0, knee[2] + PAD.front - PAD.length / 2], rot: qid() }
  ctx.setup = { implements: pad ? [wheel, pad] : [wheel], contacts, tempo, symmetric: p.direction === 'straight' }
  if (standing) {
    ctx.setup.contacts = [...contacts, ...ctx.balls.map((b, i): Contact => ({ site: `ball_${feet[i].side}`, kind: 'planted', target: { world: b } }))]
    // up on the balls of the feet the rigid forefoot capsule dips where the drawn toes lie flat (the planks' allowance)
    ctx.setup.tolerances = { floor: FOOT_SINK }
  }
  return ctx
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  const q = body(skel, ctx, c, ctx.tilt(c))
  const pose = wheelPose(ctx, ctx.travel(c))
  arms(skel, q, ctx, pose)
  return { q, implements: ctx.mat ? [pose, ctx.mat] : [pose], contacts: ctx.setup.contacts }
}

export const rollout: Template<P> = {
  id: 'rollout',
  driver: 'implement',
  params: SCHEMAS.rollout,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
