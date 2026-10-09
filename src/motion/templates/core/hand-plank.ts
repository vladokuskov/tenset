import { attachHand, root1d } from '../../constraints.ts'
import { bodyCapsules } from '../../collide.ts'
import { fk, sitePos, type FK } from '../../fk.ts'
import type { ImplementSpec } from '../../implements.ts'
import { palmRest } from '../../implements/core.ts'
import { floorMat } from '../../implements/shared.ts'
import { dls } from '../../ik.ts'
import { add, DEG, dist, lerp, norm, qalign, qid, qrot, scale, sub, type Quat, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Side, type Skeleton } from '../../skeleton.ts'
import { minJerk, type Tempo } from '../../timing.ts'
import type { ParamsOf } from '../schemas.ts'
import type { Setup } from '../types.ts'
import { ARM_DOFS, MAT_TOP, mirrorArm, segPosOf } from './floor.ts'

// Planks on flat palms. Bear plank (841), a breathing hold: on the hands and the balls of the feet, hands under the
// shoulders, knees bent ~90 deg under the hips and hovering a few centimetres off the mat, back flat. Shoulder tap
// (828): a high plank (straight body on the hands and the balls of the feet, feet a little wider than the hips) where
// the working hand leaves the mat and taps the front of the opposite shoulder while the hips stay square; the slow
// eccentric carries the hand across, it rests on the shoulder through the bottom pause and the quick concentric
// puts it back down (one tap per loop, alternating starts with `side`). Research (motion-authoring): anti-extension
// and anti-rotation holds keep a neutral spine; the angles are author judgment. The flat palm follows the push-up
// (push-up.ts): a bounded wrist solve near full extension, the wrist limit to 95 deg, and the palm and forefoot
// capsules sinking into the support.

type P = ParamsOf<'hold'>

/** bear plank, deg: knee flexion, ankle dorsiflexion (toes turned under), knees this far off the mat (m), and the
 * breath, inhaled -> braced */
export const BEAR = { knee: 92, ankle: 30, hover: 0.045, lumbar: [3, 1], thorax: [1.5, 0], clavicle: [4, 8], neck: -12 } as const
/** high plank, deg: hips and knees nearly straight, ankles as the push-up; the breath. The hips open the feet wider
 * than the hips (balls about 0.3 m out) for a broad base under the tap */
export const HIGH = { hip: 3, abd: 12, knee: 2, ankle: 28, lumbar: [2, 1], clavicle: [3, 6], neck: -8 } as const
/** shoulder tap: the hips and trunk slide this far towards the support hand while the other hand is up, hips level and
 * square (the legs re-reach the planted balls of the feet), so the centre of mass stays over the hand and feet, m */
export const SWAY = 0.04
/** palms flat under a loaded forearm: wrist extension to 95 (the push-up's lead decision) */
export const WRIST_FLEX: [number, number] = [-95, 75]
/** palm and forefoot capsules sinking into the mat where the palm lies flat and the toes turn under, mm (push-up) */
export const HAND_SINK = 45
export const FOOT_SINK = 65
/** fingers turned out from straight ahead, deg */
const TURN_OUT = 8
/** support arm elbow, deg (the shoulder tap's a little softer: the flat-palm arm solve is discontinuous within a few
 * degrees of straight, where the tap's sideways slide would pass); palm centres this far ahead of the shoulders, m: the shoulder sits over the hand, between
 * the wrist (~5 cm behind it) and the palm (wrist extension near its 95 deg limit; closer, the palm cannot lie flat) */
const ELBOW = { bear: 5, tap: 8 }
const HANDS_AHEAD = 0.07
/** grip site above the mat top: the palm capsules then rest just on it */
const PALM_LIFT = 0.001
/**
 * shoulder tap, thorax frame (m; X to the left, Y towards the head, Z out of the chest): the palm on the front of the
 * opposite shoulder, just inside the support arm (from that shoulder's joint centre: towards the midline, the head and
 * out of the chest), and the elbow pole there (out to its own side and down towards the mat)
 */
const TAP = { at: [0.07, 0.06, 0.11] as V3, pole: [0.6, -0.6, 0.5] as V3 }
/** wrist solve: pull towards the seed (pronation, deviation, per radian) and the seed itself (deg), as the push-up */
const REG = [0.2, 0.5]
const WRIST_SEED = [45, -80]

export type HandPlank = {
  kind: 'hand_plank'
  tempo: Tempo
  setup: Setup
  bear: boolean
  /** tapping side (shoulder tap) */
  tap?: Side
  /** pelvis tilt (deg), knee flexion (deg) and toe flexion holding the posture */
  tilt: number
  knee: number
  toe: number
  balls: [V3, V3]
  palms: ImplementSpec
  /** elbow pole, thorax frame (left arm) */
  pole: V3
  /** shoulder tap: the hips' sideways slide towards the support hand, m (signed, world X) */
  sway: number
  /** braced shoulder to palm distance, m: held through the bear's breath so the arms stay still */
  reach: number
  /** shoulder tap: the tapping arm's joint angles flat on the mat and on the shoulder (ARM_DOFS order) */
  flat?: number[]
  onShoulder?: number[]
  mat: ImplementPose
}

const fingers = (side: Side): V3 => [(side === 'l' ? 1 : -1) * Math.sin(TURN_OUT * DEG), 0, Math.cos(TURN_OUT * DEG)]
const palmHand = (skel: Skeleton, side: Side) => qalign([0, -1, 0], skel.data.sites[`grip_${side}`].normal!, fingers(side), [0, -1, 0])

function body(skel: Skeleton, q: Float64Array, v: Pick<HandPlank, 'bear' | 'tilt' | 'knee' | 'toe' | 'balls'>, c: number) {
  const b = v.bear
  setDofs(skel, q, {
    'lumbar.flex': b ? lerp(BEAR.lumbar[0], BEAR.lumbar[1], c) : lerp(HIGH.lumbar[0], HIGH.lumbar[1], c),
    'thorax.flex': b ? lerp(BEAR.thorax[0], BEAR.thorax[1], c) : 0,
    'neck.flex': b ? BEAR.neck : HIGH.neck,
    'head.flex': 2,
    'clavicle_*.prot': b ? lerp(BEAR.clavicle[0], BEAR.clavicle[1], c) : lerp(HIGH.clavicle[0], HIGH.clavicle[1], c),
    'clavicle_*.elev': 3,
    // bear: the thighs hang straight down from the hips (hip flexion = pelvis tilt)
    'hip_*.flex': b ? v.tilt : HIGH.hip,
    'hip_*.abd': b ? 1 : HIGH.abd,
    'knee_*.flex': b ? v.knee : HIGH.knee,
    'ankle_*.df': b ? BEAR.ankle : HIGH.ankle,
    'toe_*.flex': v.toe,
    'grip_*.close': 0,
  })
  q[skel.dof['pelvis.tilt']] = v.tilt
  // rooted so the balls of the feet sit on their targets (their midpoint: the legs are symmetric)
  const f = fk(skel, q)
  const d = sub(scale(add(v.balls[0], v.balls[1]), 0.5), scale(add(sitePos(skel, f, 'ball_l'), sitePos(skel, f, 'ball_r')), 0.5))
  for (const [k, i] of [['pelvis.tx', 0], ['pelvis.ty', 1], ['pelvis.tz', 2]] as const) q[skel.dof[k]] += d[i]
}

/** forearm and wrist angles that lay the palm flat, fingers forward and turned out (push-up.ts wristAngles) */
function flatWrist(skel: Skeleton, q: Float64Array, side: Side): Quat {
  const d = skel.dof
  const ix = [d[`forearm_${side}.pro`], d[`wrist_${side}.flex`], d[`wrist_${side}.dev`]]
  const normal = skel.data.sites[`grip_${side}`].normal!
  const fw = fingers(side)
  const handRot = (x: number[]) => {
    ix.forEach((i, k) => (q[i] = x[k]))
    return fk(skel, q).rot[skel.seg[`hand_${side}`]]
  }
  const res = (x: number[]) => {
    const r = handRot(x)
    const n = qrot(r, normal), f = qrot(r, [0, -1, 0])
    return [n[0], n[2], 0.5 * (f[0] * fw[2] - f[2] * fw[0]), REG[0] * (x[0] - WRIST_SEED[0]) * DEG, REG[1] * x[2] * DEG]
  }
  const r = dls(res, [WRIST_SEED[0], WRIST_SEED[1], 0], { tol: 1e-9, iters: 25, lo: [-90, WRIST_FLEX[0], -35], hi: [85, WRIST_FLEX[1], 20] })
  return handRot(r.x)
}

const FREE = { limits: { pro: [-179, 179] as [number, number], flex: [-179, 179] as [number, number], dev: [-179, 179] as [number, number] }, devBand: [-179, 179] as [number, number] }

/** the arm reaches its palm on the mat, the wrist lays it flat, and again (the hand's tip moves the wrist a little) */
export function flatArm(skel: Skeleton, q: Float64Array, side: Side, pos: V3, pole: V3) {
  const thorax = fk(skel, q).rot[skel.seg.thorax2]
  const p: V3 = side === 'l' ? pole : [-pole[0], pole[1], pole[2]]
  let hand = palmHand(skel, side)
  for (let it = 0; it < 5; it++) {
    attachHand(skel, q, side, { pos, axis: [side === 'l' ? -1 : 1, 0, 0], palm: [0, -1, 0], hand }, { pole: qrot(thorax, p), planeHint: 90, ...FREE })
    hand = flatWrist(skel, q, side)
  }
}

/** palms ahead of the shoulders on the mat, from the left shoulder of the braced pose (the right mirrors it) */
function palmSites(skel: Skeleton, f: FK): Record<Side, V3> {
  const sh = segPosOf(skel, f, 'humerus_l')
  const l: V3 = [sh[0] * 0.95, MAT_TOP + PALM_LIFT, sh[2] + HANDS_AHEAD]
  return { l, r: [-l[0], l[1], l[2]] }
}

/** toe flexion that lays the turned-under toes flat */
export function flatToes(skel: Skeleton, q: Float64Array): number {
  return root1d((t) => {
    q[skel.dof['toe_l.flex']] = t
    return qrot(fk(skel, q).rot[skel.seg.toes_l], [0, 0, 1])[1]
  }, -60, 30, { tol: 1e-6, scan: 9 }).x
}

export function handPlankContext(p: P, skel: Skeleton, tempo: Tempo): HandPlank {
  const bear = p.kind === 'bear_plank'
  const tap: Side | undefined = p.tap ? (p.side === 'left' ? 'l' : 'r') : undefined
  const f0 = fk(skel, zeroQ(skel))
  const bx = sitePos(skel, f0, 'ball_l')[0]
  const balls: [V3, V3] = [[bx, MAT_TOP, 0], [-bx, MAT_TOP, 0]]
  const pole: V3 = norm([0.25, -0.2, -1])
  const v: Pick<HandPlank, 'bear' | 'tilt' | 'knee' | 'toe' | 'balls'> = { bear, tilt: bear ? 80 : 70, knee: BEAR.knee, toe: 0, balls }
  const q = zeroQ(skel)
  // the arm's elbow with the palms ahead of the shoulders (braced)
  const elbow = () => {
    body(skel, q, v, 1)
    flatArm(skel, q, 'l', palmSites(skel, fk(skel, q)).l, pole)
    return q[skel.dof['elbow_l.flex']] - (bear ? ELBOW.bear : ELBOW.tap)
  }
  const kneeGap = () => {
    const caps = bodyCapsules(skel, fk(skel, q)).filter((c) => /^(shank_[lr]1|thigh_[lr][23])/.test(c.name))
    return Math.min(...caps.map((c) => Math.min(c.a[1], c.b[1]) - c.r)) - MAT_TOP - BEAR.hover
  }
  for (let pass = 0; pass < 3; pass++) {
    // toes flat for the current posture, then the tilt that straightens the arms (and, for the bear, the knee
    // flexion that hovers the knees)
    body(skel, q, v, 1)
    v.toe = flatToes(skel, q)
    const straight = () => (v.tilt = root1d((t) => ((v.tilt = t), elbow()), 50, 95, { tol: 1e-6, scan: 9 }).x)
    if (bear) {
      v.knee = root1d((k) => {
        v.knee = k
        straight()
        body(skel, q, v, 1)
        return kneeGap()
      }, 70, 130, { tol: 1e-6, scan: 7 }).x
      straight()
    } else straight()
  }
  body(skel, q, v, 1)
  const f = fk(skel, q)
  // the balls of the feet where the posture puts them (the high plank's hips open the feet a little wider)
  v.balls = [sitePos(skel, f, 'ball_l'), sitePos(skel, f, 'ball_r')]
  const sites = palmSites(skel, f)
  // measured on a fresh pose, as sampled (the solve's q carries the arm's other joints)
  const fresh = zeroQ(skel)
  body(skel, fresh, v, 1)
  const reach = dist(segPosOf(skel, fk(skel, fresh), 'humerus_l'), sites.l)
  const palms = palmRest({ id: 'hands', sites })
  const contacts: Contact[] = [
    ...(['l', 'r'] as const).map((s, i): Contact => ({ site: `ball_${s}`, kind: 'planted', target: { world: v.balls[i] } })),
    ...(['l', 'r'] as const).map((s): Contact => (s === tap
      ? { site: `grip_${s}`, kind: 'grip', target: { implement: 'tap', grip: s } }
      : { site: `grip_${s}`, kind: 'grip', target: { implement: palms.id, grip: s } })),
  ]
  const back = v.balls[0][2] - 0.1, front = sites.l[2] + 0.15
  const matSpec = floorMat({ length: front - back })
  const mat: ImplementPose = { id: matSpec.id, pos: [0, 0, (back + front) / 2], rot: qid() }
  const implements_: ImplementSpec[] = [matSpec, palms, ...(tap ? [palmRest({ id: 'tap', sites: { [tap]: [0, 0, 0] } })] : [])]
  const setup: Setup = {
    implements: implements_,
    contacts,
    tempo,
    symmetric: !tap,
    rests: [{ implement: matSpec.id, regions: ['hand_l', 'hand_r', 'foot_l', 'foot_r'], tol: FOOT_SINK }],
    limits: { 'wrist_l.flex': WRIST_FLEX, 'wrist_r.flex': WRIST_FLEX },
    tolerances: { floor: FOOT_SINK },
  }
  let flat: number[] | undefined, onShoulder: number[] | undefined, sway = 0
  if (tap) {
    const support: Side = tap === 'l' ? 'r' : 'l'
    sway = support === 'l' ? SWAY : -SWAY
    flatArm(skel, q, support, sites[support], pole)
    flatArm(skel, q, tap, sites[tap], pole)
    flat = armDofs(skel, q, tap)
    // on the shoulder: the arm the hand settles into with the palm on the chest (free roll)
    const thorax = fk(skel, q).rot[skel.seg.thorax2]
    const sgn = tap === 'l' ? 1 : -1
    attachHand(skel, q, tap, { pos: tapTarget(skel, fk(skel, q), tap), axis: qrot(thorax, [0, 1, 0]), palm: qrot(thorax, [0, 0, -1]) }, { pole: qrot(thorax, [sgn * TAP.pole[0], TAP.pole[1], TAP.pole[2]]), planeHint: 90 })
    onShoulder = armDofs(skel, q, tap)
  }
  return { kind: 'hand_plank', tempo, setup, tap, ...v, palms, pole, mat, flat, onShoulder, sway, reach }
}

function tapTarget(skel: Skeleton, f: FK, side: Side): V3 {
  const s = side === 'l' ? 1 : -1
  return add(segPosOf(skel, f, `humerus_${side === 'l' ? 'r' : 'l'}`), qrot(f.rot[skel.seg.thorax2], [s * TAP.at[0], TAP.at[1], TAP.at[2]]))
}

const armDofs = (skel: Skeleton, q: Float64Array, side: Side) => ARM_DOFS.map((k) => q[skel.dof[k.replace('*', side)]])

/**
 * the tapping arm: its joint angles move from the flat palm on the mat to the palm on the front of the opposite
 * shoulder (minimum jerk), so the hand lifts and swings across in front of the chest on the arm's natural arc
 */
function tapArm(skel: Skeleton, q: Float64Array, v: HandPlank, k: number) {
  const t = minJerk(k)
  ARM_DOFS.forEach((name, i) => (q[skel.dof[name.replace('*', v.tap!)]] = lerp(v.flat![i], v.onShoulder![i], t)))
}

const LEAST = 0.02
const LEG_DOFS = ['hip_l.abd', 'hip_r.abd', 'ankle_l.df', 'ankle_r.df', 'pelvis.ty', 'pelvis.tz', 'pelvis.tilt'] as const

/** the pelvis slides `dx` sideways, level and square; both hips' abduction, both ankles and the pelvis height, depth and
 * tilt keep the balls of the feet on their spots (the straight legs lean over the planted toes) and the support
 * shoulder `reach` from its palm */
function slideLegs(skel: Skeleton, q: Float64Array, v: HandPlank, dx: number, reach: number) {
  q[skel.dof['pelvis.tx']] += dx
  const ix = LEG_DOFS.map((n) => skel.dof[n]), x0 = ix.map((i) => q[i])
  const support: Side = v.tap === 'l' ? 'r' : 'l'
  const res = (x: number[]) => {
    ix.forEach((i, k) => (q[i] = x0[k] + x[k]))
    const f = fk(skel, q)
    const feet = (['l', 'r'] as const).flatMap((s, k) => sub(sitePos(skel, f, `ball_${s}`), v.balls[k]).map((e) => e * 1000))
    // the least change from the braced pose (ankles, abduction and tilt per degree, the root per centimetre): without
    // it the ankles and the pelvis depth trade off and the solve wanders from frame to frame
    const least = x.map((e, k) => e * (k === 4 || k === 5 ? 100 : 1) * LEAST)
    return [...feet, (dist(segPosOf(skel, f, `humerus_${support}`), v.palms.sites[support].pos) - reach) * 1000, ...least]
  }
  res(dls(res, [0, 0, 0, 0, 0, 0, 0], { tol: 1e-10, iters: 30 }).x)
}

/**
 * the slide at share k of the full sway with the support arm as braced: the shoulder-to-palm distance at which the
 * flat-palm arm keeps its elbow (the palm's tilt moves the wrist as the shoulder passes over the hand). The
 * near-straight elbow changes ~4 deg per mm here, so the distance is bracketed within a few millimetres of the braced one.
 */
function slideHips(skel: Skeleton, q: Float64Array, v: HandPlank, k: number) {
  if (k < 1e-9) return
  const support: Side = v.tap === 'l' ? 'r' : 'l'
  const base = q.slice()
  const elbow = (r: number) => {
    q.set(base)
    slideLegs(skel, q, v, k * v.sway, r)
    flatArm(skel, q, support, v.palms.sites[support].pos, v.pole)
    return q[skel.dof[`elbow_${support}.flex`]] - ELBOW.tap
  }
  const r = root1d(elbow, v.reach - 0.006, v.reach + 0.004, { tol: 1e-8, scan: 10 }).x
  q.set(base)
  slideLegs(skel, q, v, k * v.sway, r)
}

/** the breath stays in the trunk: the upper back counter-flexes so the shoulder keeps its distance to the palm and the
 * near-straight arms do not bend with the lumbar breath */
function holdShoulder(skel: Skeleton, q: Float64Array, palm: V3, reach: number) {
  const i = skel.dof['thorax.flex'], base = q[i]
  q[i] = root1d((t) => ((q[i] = base + t), dist(segPosOf(skel, fk(skel, q), 'humerus_l'), palm) - reach), -10, 10, { tol: 1e-7, scan: 5 }).x + base
}

export function sampleHandPlank(skel: Skeleton, v: HandPlank, c: number): Pose {
  const q = zeroQ(skel)
  body(skel, q, v, v.tap ? 1 : c)
  // shoulder tap: the weight slides onto the support hand early in the lift and back as the hand lands
  if (v.tap) slideHips(skel, q, v, minJerk(Math.min(1, (1 - c) / 0.3)))
  const imp: ImplementPose[] = [v.mat, { id: v.palms.id, pos: [0, 0, 0], rot: qid() }]
  if (v.bear) holdShoulder(skel, q, v.palms.sites.l.pos, v.reach)
  if (!v.tap) {
    flatArm(skel, q, 'l', v.palms.sites.l.pos, v.pole)
    mirrorArm(skel, q)
    return { q, implements: imp, contacts: v.setup.contacts }
  }
  const support: Side = v.tap === 'l' ? 'r' : 'l'
  flatArm(skel, q, support, v.palms.sites[support].pos, v.pole)
  // the hand travels over the eccentric and comes back down over the concentric: contraction 1 = flat on the mat
  tapArm(skel, q, v, 1 - c)
  const tapAt = sitePos(skel, fk(skel, q), `grip_${v.tap}`)
  imp.push({ id: 'tap', pos: tapAt, rot: qid() })
  return { q, implements: imp, contacts: v.setup.contacts }
}
