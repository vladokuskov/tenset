import { attachHand, root1d } from '../constraints.ts'
import { centerOfPressure, fk, type FK } from '../fk.ts'
import { siteWorld, type ImplementSpec } from '../implements.ts'
import { kettlebell } from '../implements/free-weights.ts'
import { add, clamp, cross, DEG, lerp, neg, norm, qconj, qfromBasis, qrot, scale, sub, type V3 } from '../math.ts'
import { setDofs, shoulderRhythm, zeroQ, type Contact, type ImplementPose, type Pose, type Side, type Skeleton } from '../skeleton.ts'
import { phaseAt, type Tempo } from '../timing.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { makeStance, plantedContacts, stanceWidth, stand, type StanceName, type StanceSetup } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Kettlebell swing (Russian, to chest height). Joint driver: one eccentric progress s (0 = the bell floating at chest
// height, 1 = the hike, the bell back between the thighs) drives the straight arms' world angle and, once the forearms
// reach the groin, the hinge. On the way up the same schedule runs backwards: the hips snap open while the bell passes
// the thighs, then the bell floats up on long arms. The ankles are solved each frame so the centre of pressure of body
// and bell stays over the midfoot, which leans the body back a little against the bell at the top.
// Research (motion-authoring, hinge): hip flexion at the hike ~70-90 deg with the knees ~20-30 deg, full hip and knee
// extension at the float; the bell reaches about chest height with the arms near horizontal (shoulder flexion ~80-95).

type P = ParamsOf<'swing'>

/**
 * A swing is ballistic: about 0.6 s down, a short turn in the hike, a hip snap of about the same length and a brief float
 * at the top (about 1.4 s a rep). The slow 2 s eccentric of the strength tempo would read as a lowered bell, not a
 * swing (lead decision)
 */
export const SWING_TEMPO: Tempo = [0.7, 0.06, 0.6, 0.24]
export const KG = 16
/** arm angle from straight down, deg (+ forward of the shoulders): float at the top, forearms at the groin, the hike */
export const ARM = { top: 88, groin: 16, hike: 10 }
/** hip and knee flexion at the hike, deg; the knees stay soft at the top */
export const HIKE = { hip: 82, knee: 24 }
export const TOP = { hip: 2, knee: 3 }
/** fraction of the eccentric the arms fall before the hips start to fold (the forearms meet the groin) */
export const WAIT = 0.2
/** fraction of the eccentric by which the arms reach the hike angle */
export const ARM_END = 0.9
/** neutral spine at the hike, deg */
const SPINE = { lumbar: 4, thorax: 5 }
/** shoulders protracted a little so the converging arms pass in front of the chest */
const PROT = 25
const POLE_OUT = 0
/**
 * the hike: the arm line runs from the shoulders between the thighs at this fraction of their length from the hips (the
 * thighs part wide enough there for the forearms), this far behind their axes (m), so the bell ends up behind the legs
 */
export const THIGH_GAP = { at: 0.8, back: 0.06 }
/**
 * In the hike the straight arms converge on the handle across the chest and run between the thighs: the upper arms
 * press ~25 mm into the sides of the chest (the two-hand kettlebell hinge's allowance, wave 3b) and the forearms ~22 mm
 * into the inner thighs, which the cue asks for (soft tissue on soft tissue, lead decision)
 */
const SWING_TOL = {
  'trunk / upperarm_l': 26, 'trunk / upperarm_r': 26, 'trunk / upperarm_l (thorax2)': 26, 'trunk / upperarm_r (thorax2)': 26,
  'forearm_l / thigh_l': 24, 'forearm_r / thigh_r': 24,
}
/** elbows just short of straight */
const ARM_ELBOW = 5

type Ctx = { tempo: Tempo; setup: Setup; stance: StanceSetup; bell: ImplementSpec; reach: number; armAt: (s: number) => number }


/** the fold eases in (the phase timing already eases it out into the hike) */
const fold = (s: number, from: number) => clamp((s - from) / (1 - from), 0, 1) ** 3
const hipAt = (s: number) => lerp(TOP.hip, HIKE.hip, fold(s, WAIT))
const kneeAt = (s: number, hike: number) => lerp(TOP.knee, hike, fold(s, WAIT * 0.7))

function posture(skel: Skeleton, q: Float64Array, s: number) {
  const k = fold(s, WAIT)
  setDofs(skel, q, { 'lumbar.flex': SPINE.lumbar * k, 'thorax.flex': SPINE.thorax * k, 'clavicle_*.prot': PROT, 'clavicle_*.elev': -2, 'grip_*.close': 1 })
}

function gaze(skel: Skeleton, q: Float64Array) {
  const d = skel.dof
  const pitch = q[d['pelvis.tilt']] + q[d['lumbar.flex']] + q[d['thorax.flex']]
  setDofs(skel, q, { 'neck.flex': -0.2 * pitch, 'head.flex': -0.1 * pitch })
}

/** legs for knee flexion and ankle dorsiflexion with the pelvis tilted so the hips sit at `hip` flexion */
function placeHip(skel: Skeleton, q: Float64Array, ctx: Ctx, knee: number, df: number, hip: number) {
  const i = skel.dof['hip_l.flex']
  let tilt = hip - knee + df
  for (let k = 0; k < 5; k++) {
    stand(skel, q, ctx.stance, { knee, df, tilt })
    const e = hip - q[i]
    if (Math.abs(e) < 1e-6) break
    tilt += e
  }
}

const gh = (skel: Skeleton, f: FK): V3 => scale(add(f.pos[skel.seg.humerus_l], f.pos[skel.seg.humerus_r]), 0.5)

/**
 * the bell on the end of the long arms: its handle between the hands, the bell pointing away from the shoulders. `arm`
 * is the arms' angle from the trunk's long axis in its sagittal plane, deg (+ forward), so the arms follow the hinge
 */
function bellPose(skel: Skeleton, f: FK, ctx: Ctx, arm: number): ImplementPose {
  const dir = qrot(f.rot[skel.seg.thorax2], [0, -Math.cos(arm * DEG), Math.sin(arm * DEG)])
  const grip = add(gh(skel, f), scale(dir, ctx.reach))
  const rot = qfromBasis([1, 0, 0], neg(dir))
  return { id: ctx.bell.id, pos: sub(grip, qrot(rot, ctx.bell.sites.handle.pos)), rot }
}

/**
 * scapular upward rotation for the arm angle, set before the shoulders are placed and held by the arm IK, so the
 * shoulder joints the bell hangs from are the ones the arms reach from
 */
const uprotFor = (arm: number) => shoulderRhythm(Math.max(0, arm), 90).uprot

function arms(skel: Skeleton, q: Float64Array, ctx: Ctx, pose: ImplementPose) {
  const uprot = q[skel.dof['scapula_l.uprot']]
  const palm = qrot(pose.rot, [0, 0, -1])
  for (const side of ['l', 'r'] as Side[]) {
    const site = siteWorld(ctx.bell, pose, `handle_${side}`)
    // elbows point down with the arms forward and back with the arms hanging, a little out
    const pole = add(cross([1, 0, 0], qrot(pose.rot, [0, -1, 0])), [(side === 'l' ? 1 : -1) * POLE_OUT, 0, 0])
    attachHand(skel, q, side, { pos: site.pos, axis: site.axis!, palm }, { pole, planeHint: 90, wristBias: 0, uprot })
  }
}

type Frame = { q: Float64Array; bell: ImplementPose }

function solveFrame(skel: Skeleton, ctx: Ctx, s: number, hike: number): Frame {
  const q = zeroQ(skel)
  posture(skel, q, s)
  const knee = kneeAt(s, hike), hip = hipAt(s), arm = ctx.armAt(s)
  setDofs(skel, q, { 'scapula_*.uprot': uprotFor(arm) })
  const build = (df: number) => {
    placeHip(skel, q, ctx, knee, df, hip)
    gaze(skel, q)
    const pose = bellPose(skel, fk(skel, q), ctx, arm)
    // the arms reach forward with the bell, so they count in the balance
    arms(skel, q, ctx, pose)
    return pose
  }
  const offset = (df: number) => {
    const pose = build(df)
    const [, z] = centerOfPressure(skel, fk(skel, q), [{ mass: ctx.bell.mass, pos: pose.pos }])
    return z - ctx.stance.midfoot[2]
  }
  const r = root1d(offset, -20, 25, { tol: 1e-7, scan: 9 })
  return { q, bell: build(r.x) }
}

/** straight-arm reach from the shoulder joint to the handle that the arm IK meets with the elbows at ARM_ELBOW */
function reachOf(skel: Skeleton, ctx: Ctx): number {
  const q = zeroQ(skel)
  posture(skel, q, 0)
  setDofs(skel, q, { 'scapula_*.uprot': uprotFor(ARM.top) })
  stand(skel, q, ctx.stance, { knee: TOP.knee, df: 0, tilt: 0 })
  const elbow = (d: number) => {
    const qq = q.slice()
    arms(skel, qq, { ...ctx, reach: d }, bellPose(skel, fk(skel, qq), { ...ctx, reach: d }, ARM.top))
    return qq[skel.dof['elbow_l.flex']] - ARM_ELBOW
  }
  return root1d(elbow, 0.5, 0.75, { tol: 1e-6, scan: 8 }).x
}

/** arm angle at the hike whose line passes between the thighs (THIGH_GAP), iterated with the balance solve */
function hikeArm(skel: Skeleton, ctx: Ctx, knee: number): number {
  let arm = ARM.hike
  for (let k = 0; k < 6; k++) {
    ctx.armAt = () => arm
    const f = fk(skel, solveFrame(skel, ctx, 1, knee).q)
    const along = (side: Side) => add(f.pos[skel.seg[`femur_${side}`]], scale(sub(f.pos[skel.seg[`tibia_${side}`]], f.pos[skel.seg[`femur_${side}`]]), THIGH_GAP.at))
    const mid = scale(add(along('l'), along('r')), 0.5)
    const thigh = norm(sub(f.pos[skel.seg.tibia_l], f.pos[skel.seg.femur_l]))
    const back = norm(cross(thigh, [1, 0, 0]))
    const p = add(mid, scale(back[2] < 0 ? back : neg(back), THIGH_GAP.back))
    const local = qrot(qconj(f.rot[skel.seg.thorax2]), sub(p, gh(skel, f)))
    const next = Math.atan2(local[2], -local[1]) / DEG
    if (Math.abs(next - arm) < 1e-4) return next
    arm = next
  }
  return arm
}

function variant(p: P): string | null {
  if (p.implement !== 'kettlebell') return `implement ${p.implement}`
  if (p.height !== 'chest') return `height ${p.height}`
  if (p.laterality !== 'bilateral') return `laterality ${p.laterality}`
  return null
}

const context = memo((p: P, skel: Skeleton): Ctx => {
  const v = variant(p)
  if (v) throw new Error(`swing: variant not implemented yet (${v})`)
  const tempo = p.tempo ?? SWING_TEMPO
  const stance = makeStance(skel, stanceWidth(skel, p.stance as StanceName), p.toeOut)
  const contacts: Contact[] = plantedContacts(skel, stance)
  const bell = kettlebell({ id: 'kb', kg: KG })
  contacts.push(
    { site: 'grip_l', kind: 'grip', target: { implement: bell.id, grip: 'handle_l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: bell.id, grip: 'handle_r' } },
  )
  const setup: Setup = { implements: [bell], contacts, tempo, symmetric: true, balance: { point: 'com', over: 'midfoot', tol: 0.025 }, tolerances: { body: SWING_TOL } }
  const ctx: Ctx = { tempo, setup, stance, bell, reach: 0.6, armAt: () => ARM.top }
  ctx.reach = reachOf(skel, ctx)
  // the arms fall to the groin while the body stays tall, then swing back with the hinge
  const hike = hikeArm(skel, ctx, p.kneeAngle ?? HIKE.knee)
  // eased out into the hike only: the phase timing already eases the float at the top
  ctx.armAt = (s) => lerp(ARM.top, hike, 1 - (1 - clamp(s / ARM_END, 0, 1)) ** 2)
  return ctx
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const s = 1 - phaseAt(u, ctx.tempo).c
  const fr = solveFrame(skel, ctx, s, p.kneeAngle ?? HIKE.knee)
  return { q: fr.q, implements: [fr.bell], contacts: ctx.setup.contacts }
}

export const swing: Template<P> = {
  id: 'swing',
  driver: 'joint',
  params: SCHEMAS.swing,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
