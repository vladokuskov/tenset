import { attachHand, root1d } from '../constraints.ts'
import { bodyCapsules } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import type { ImplementSpec } from '../implements.ts'
import { palmRest } from '../implements/press-vertical-bodyweight.ts'
import { PLYO_BOX, plyoBox } from '../implements/shared.ts'
import { dls } from '../ik.ts'
import { add, DEG, lerp, norm, qalign, qconj, qid, qrot, RAD, scale, sub, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, minJerk, phaseAt, type Tempo } from '../timing.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { monotoneCubic } from './solve.ts'
import { memo, type Setup, type Template } from './types.ts'

// Push-up, root driver: palms flat and the balls of the feet planted (on the floor, or on a box under the hands or
// the feet); the body is a rigid plank pivoting about the balls of the feet, toes turned under. Plank pitch follows an
// elbow curve linear in contraction, from ~6 deg at the top to the depth that leaves the chest a fist above the
// support (the rig's long palm makes that ~110-120 deg, past the ~80-100 the motion-authoring research gives for a
// barbell touch). The elbows point back and out, ~28 deg from the torso with the hands under the shoulders to ~40 at
// 1.5 x shoulder width (coaching standard ~30-45); with the feet on a box the neck extends so the face clears. The
// scapulae retract as the chest lowers and protract at the top; the push-up plus adds full protraction after lockout
// (the thorax rises between the shoulder blades), still inside the default tempo.

type P = ParamsOf<'push-up'>

const ELBOW_TOP = 6
/** bottom: the chest this far above the support (a fist), m */
const CHEST_GAP = 0.08
const HEAD_GAP = 0.04
const BOX_H = PLYO_BOX.heights[2]
/** hands on a box: a wide (foam) plyo box, so the palms of a 1.5 x shoulder grip rest on its top */
const HANDS_BOX_W = 0.9
const HIP = 2
const KNEE = 2
/** ankle dorsiflexion: heels up and back, toes turned under within the toe joint's range */
const ANKLE_DF = 28
/** clavicle protraction at the bottom and the top, extra for the plus, deg; thorax rounding at the top of the plus */
const PROT: [number, number] = [-12, 6]
const PLUS = 16
const PLUS_THORAX = 6
/** elbow pole at the top (thorax frame): the elbow tips towards the feet, so flat palms need no more forearm
 * pronation than the joint has */
const POLE_TOP: V3 = [0.15, -0.85, -0.5]
/** fingers turned out from straight ahead, deg */
const TURN_OUT = 8
const FINGERS: V3 = [Math.sin(TURN_OUT * DEG), 0, Math.cos(TURN_OUT * DEG)]
/** palms flat under a loaded forearm: wrist extension to ~90 (the rig's -70 is for free hands) */
const WRIST_FLEX: [number, number] = [-95, 75]
/** wrist extension at the top, deg: the hands sit that far ahead of the shoulders (past ~85 the rig's pronation and
 * deviation axes line up and the hand cannot keep the palm flat) */
const WRIST_TOP = 84
/** and at most this at the bottom, deg: the palms under the chest, the forearms leaning back towards the feet. A
 * flared forearm also leans out, and the wrist only absorbs that lean well short of full extension */
const WRIST_BOTTOM = 66
/** upper arm's angle from the torso at the bottom (seen from above), deg, plus more per unit of grip width over
 * shoulder width: ~28 with the hands under the shoulders, ~40 at 1.5 x (coaching standard ~30-45) */
const FLARE = [28, 24]
/** neck and head flexion, deg: eyes on the floor just ahead of the hands; feet on a box tip the head down, so there
 * the neck extends to look further ahead */
const NECK = [[-6, 6], [-26, 0]]
/** pull of the wrist solve towards the seed, pronation and deviation (per radian): a flat palm is out of reach near
 * full extension when the forearm leans sideways, and without it the solve runs into the joint stops chasing the
 * last degrees (the palm tips up to ~10 deg instead) */
const REG = [0.2, 0.5]
/** forearm pronation and wrist flexion the wrist solve starts from, deg */
const WRIST_SEED = [45, -80]
/** grip site above the support: the palm capsules then rest ~1 mm off it */
const PALM_LIFT = 0.001
const PALM_LIFT_BOX = 0.003
/** feet on a box: its top front edge this far ahead of the balls of the feet, m */
const BALL_EDGE = 0.005
const KNOTS = 17
/**
 * How far the capsule model sinks into a support at the palms and the balls of the feet, mm: the fist capsule models
 * fingers closed round a handle and the forefoot capsule straight toes, while here the palms lie flat and the toes
 * are turned under. The trunk, head and legs keep their clearance (push-up.test.ts). Palms on a box rest on it with
 * the same sink. A lead decision.
 */
const HAND_SINK = 45
const FOOT_SINK = 65

type Ctx = {
  tempo: Tempo
  setup: Setup
  /** ball-of-foot targets (left first), world */
  balls: [V3, V3]
  palms: ImplementSpec
  palmPose: ImplementPose
  boxPose?: ImplementPose
  /** elbow pole in the thorax frame (left arm) */
  pole: V3
  /** plank pitch along the rep (deg above horizontal, head up) */
  pitch: (c: number) => number
}

const ramp = (c: number, a: number, b: number) => minJerk((c - a) / (b - a))

const MIRRORED = ['clavicle_*.elev', 'clavicle_*.prot', 'scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']

function unsupported(p: P) {
  if (p.laterality !== 'bilateral') return `laterality ${p.laterality}`
  if (p.kneeling) return 'kneeling'
  return null
}

/** plank at `pitch`, girdle for contraction c, rooted so the left ball of the foot sits on its target; toes flat */
function plank(skel: Skeleton, q: Float64Array, p: P, ctx: Pick<Ctx, 'balls'>, c: number, pitch: number) {
  const plus = p.plus ? ramp(c, 0.5, 1) : 0
  setDofs(skel, q, {
    'lumbar.flex': 0,
    'thorax.flex': PLUS_THORAX * plus,
    'neck.flex': NECK[p.elevation === 'feet' ? 1 : 0][0],
    'head.flex': NECK[p.elevation === 'feet' ? 1 : 0][1],
    'hip_*.flex': HIP,
    'knee_*.flex': KNEE,
    'ankle_*.df': ANKLE_DF,
    'clavicle_*.prot': lerp(PROT[0], PROT[1], c) + PLUS * plus,
    'grip_*.close': 1,
  })
  q[skel.dof['pelvis.tilt']] = 90 - pitch
  const d = sub(ctx.balls[0], sitePos(skel, fk(skel, q), 'ball_l'))
  for (const [k, i] of [['pelvis.tx', 0], ['pelvis.ty', 1], ['pelvis.tz', 2]] as const) q[skel.dof[k]] += d[i]
  // toes turned under, lying flat (pointing towards the hands); on a box the balls of the feet sit on its edge and the
  // toes hang over it
  if (p.elevation === 'feet') return
  const toe = root1d((t) => {
    q[skel.dof['toe_l.flex']] = t
    const f = fk(skel, q)
    return qrot(f.rot[skel.seg.toes_l], [0, 0, 1])[1]
  }, -60, 30, { tol: 1e-6, scan: 9 }).x
  q[skel.dof['toe_l.flex']] = q[skel.dof['toe_r.flex']] = toe
}

/** flat palm, fingers forward and turned out a little */
const palmHand = (skel: Skeleton) => qalign([0, -1, 0], skel.data.sites.grip_l.normal!, FINGERS, [0, -1, 0])

/** relaxed forearm and wrist limits for the arm solve: the wrist angles are set afterwards (wristAngles) */
const FREE = { limits: { pro: [-179, 179] as [number, number], flex: [-179, 179] as [number, number], dev: [-179, 179] as [number, number] }, devBand: [-179, 179] as [number, number] }

/**
 * Forearm rotation and wrist angles that lay the palm flat, fingers forward and turned out, within the joint ranges;
 * returns the hand's world rotation. Near 90 deg of extension the rig's pronation and deviation axes line up (and
 * the hand cannot roll about the fingers), so the arm solver's own split is arbitrary: a damped, bounded solve from
 * a fixed seed keeps it smooth, letting the palm tip a few degrees where a flat palm is out of reach.
 */
function wristAngles(skel: Skeleton, q: Float64Array) {
  const d = skel.dof
  const ix = [d['forearm_l.pro'], d['wrist_l.flex'], d['wrist_l.dev']]
  const normal = skel.data.sites.grip_l.normal!
  const handRot = (x: number[]) => {
    ix.forEach((i, k) => (q[i] = x[k]))
    return fk(skel, q).rot[skel.seg.hand_l]
  }
  const res = (x: number[]) => {
    const r = handRot(x)
    const n = qrot(r, normal), f = qrot(r, [0, -1, 0])
    return [n[0], n[2], 0.5 * (f[0] * FINGERS[2] - f[2] * FINGERS[0]), REG[0] * (x[0] - WRIST_SEED[0]) * DEG, REG[1] * x[2] * DEG]
  }
  const lo = [-90, WRIST_FLEX[0], -35], hi = [85, WRIST_FLEX[1], 20]
  const r = dls(res, [WRIST_SEED[0], WRIST_SEED[1], 0], { tol: 1e-9, iters: 25, lo, hi })
  return handRot(r.x)
}

function arms(skel: Skeleton, q: Float64Array, ctx: Pick<Ctx, 'palms' | 'palmPose'>, bottom: V3, c: number) {
  const pole = norm(add(scale(bottom, 1 - ramp(c, 0.1, 0.9)), scale(norm(POLE_TOP), ramp(c, 0.1, 0.9))))
  const s = ctx.palms.sites.l
  const pos = add(ctx.palmPose.pos, qrot(ctx.palmPose.rot, s.pos))
  const thorax = fk(skel, q).rot[skel.seg.thorax2]
  // the arm reaches the palm, the wrist lays it as flat as it can, and again (the hand's tip moves the wrist a little)
  let hand = palmHand(skel)
  for (let it = 0; it < 5; it++) {
    attachHand(skel, q, 'l', { pos, axis: [-1, 0, 0], palm: [0, -1, 0], hand }, { pole: qrot(thorax, pole), planeHint: 90, ...FREE })
    hand = wristAngles(skel, q)
  }
  for (const k of MIRRORED) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

function frame(skel: Skeleton, p: P, ctx: Pick<Ctx, 'balls' | 'palms' | 'palmPose'>, pole: V3, c: number, pitch: number): Float64Array {
  const q = zeroQ(skel)
  plank(skel, q, p, ctx, c, pitch)
  arms(skel, q, ctx, pole, c)
  return q
}

/** upper-arm angle from the torso in its frontal plane, deg */
function flare(skel: Skeleton, q: Float64Array): number {
  const f = fk(skel, q)
  const h = qrot(qconj(f.rot[skel.seg.thorax2]), sub(segPos(skel, f, 'forearm_l'), segPos(skel, f, 'humerus_l')))
  return Math.atan2(Math.abs(h[0]), -h[1]) * RAD
}

const elbowOf = (skel: Skeleton, q: Float64Array) => q[skel.dof['elbow_l.flex']]

const context = memo((p: P, skel: Skeleton): Ctx => {
  const why = unsupported(p)
  if (why) throw new Error(`push-up: variant not implemented yet (${why})`)
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const feetH = p.elevation === 'feet' ? BOX_H : 0
  const handsH = p.elevation === 'hands' ? BOX_H : 0
  const f0 = fk(skel, zeroQ(skel))
  const bx = sitePos(skel, f0, 'ball_l')[0]
  const balls: [V3, V3] = [[bx, feetH, 0], [-bx, feetH, 0]]
  const palms = palmRest({ half: (p.gripWidth * skel.data.shoulderWidth) / 2 })
  const palmPose: ImplementPose = { id: palms.id, pos: [0, handsH + (handsH ? PALM_LIFT_BOX : PALM_LIFT), 1.35], rot: qid() }
  const base = { balls, palms, palmPose }
  let pole: V3 = norm([0.6, -0.8, -0.6])
  const poleAt = (t: number): V3 => norm([Math.sin(t * DEG), -0.8 * Math.cos(t * DEG), -0.6])
  // bottom: plank pitch that puts the chest CHEST_GAP above the support, or the head HEAD_GAP above the floor where
  // that comes first (feet on a box tip the head down)
  const chest = (a: number) => {
    const caps = bodyCapsules(skel, fk(skel, frame(skel, p, base, pole, 0, a)))
    const low = (re: RegExp) => Math.min(...caps.filter((k) => re.test(k.segment)).map((k) => Math.min(k.a[1], k.b[1]) - k.r))
    return Math.min(low(/^thorax/) - handsH - CHEST_GAP, low(/^head$/) - HEAD_GAP)
  }
  const bottomPitch = () => root1d(chest, 60, -40, { tol: 1e-6, scan: 20 }).x
  // hands just far enough ahead of the shoulders for WRIST_TOP at the top or WRIST_BOTTOM at the bottom, whichever
  // binds (on a box: the plank pivots through a steeper arc, so the shoulders travel further forward on the way
  // down); elbow pole (out and back towards the feet, the elbow pointing away from the floor) that gives the FLARE
  // at the bottom
  const topPitch = () => root1d((a) => elbowOf(skel, frame(skel, p, base, pole, 1, a)) - ELBOW_TOP, 45, -10, { tol: 1e-6, scan: 11 }).x
  const wristTop = (z: number) => {
    palmPose.pos = [0, palmPose.pos[1], z]
    const w = (c: number, a: number) => frame(skel, p, base, pole, c, a)[skel.dof['wrist_l.flex']]
    return Math.min(w(1, topPitch()) + WRIST_TOP, w(0, bottomPitch()) + WRIST_BOTTOM)
  }
  const flareTo = FLARE[0] + FLARE[1] * Math.max(0, p.gripWidth - 1)
  const elbowOut = (t: number) => {
    pole = poleAt(t)
    return flare(skel, frame(skel, p, base, pole, 0, bottomPitch())) - flareTo
  }
  // hand placement and elbow pole depend on each other once the bottom binds
  for (let pass = 0; pass < 6; pass++) {
    const z0 = palmPose.pos[2]
    palmPose.pos = [0, palmPose.pos[1], root1d(wristTop, 1.0, 1.7, { tol: 1e-5, scan: 7 }).x]
    pole = poleAt(root1d(elbowOut, 0, 80, { tol: 1e-4, scan: 8 }).x)
    if (pass && Math.abs(palmPose.pos[2] - z0) < 1e-4) break
  }
  const elbowBottom = elbowOf(skel, frame(skel, p, base, pole, 0, bottomPitch()))
  const target = (c: number) => lerp(elbowBottom, ELBOW_TOP, c)
  const pitchFor = (c: number) => root1d((a) => elbowOf(skel, frame(skel, p, base, pole, c, a)) - target(c), 45, -40, { tol: 1e-6, scan: 17 }).x
  const cs = Array.from({ length: KNOTS }, (_, i) => i / (KNOTS - 1))
  const pitch = monotoneCubic(cs, cs.map(pitchFor))
  const implements_: ImplementSpec[] = [palms]
  let boxPose: ImplementPose | undefined
  let rests: Setup['rests']
  if (p.elevation !== 'floor') {
    const box = plyoBox({ height: BOX_H, width: p.elevation === 'hands' ? HANDS_BOX_W : PLYO_BOX.width })
    implements_.push(box)
    // hands: the palm heels just inside the edge nearer the feet; feet: the balls of the feet on its front edge
    const z = p.elevation === 'hands' ? palmPose.pos[2] - 0.135 + PLYO_BOX.depth / 2 : BALL_EDGE - PLYO_BOX.depth / 2
    boxPose = { id: box.id, pos: [0, 0, z], rot: qid() }
    if (p.elevation === 'hands') rests = [{ implement: box.id, regions: ['hand_l', 'hand_r'], tol: HAND_SINK }]
  }
  const contacts: Contact[] = [
    { site: 'ball_l', kind: 'planted', target: { world: balls[0] } },
    { site: 'ball_r', kind: 'planted', target: { world: balls[1] } },
    { site: 'grip_l', kind: 'grip', target: { implement: palms.id, grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: palms.id, grip: 'r' } },
  ]
  const setup: Setup = {
    implements: implements_,
    contacts,
    tempo,
    symmetric: true,
    ...(rests ? { rests } : {}),
    limits: { 'wrist_l.flex': WRIST_FLEX, 'wrist_r.flex': WRIST_FLEX },
    tolerances: { floor: p.elevation === 'feet' ? HAND_SINK : FOOT_SINK },
  }
  return { tempo, setup, ...base, boxPose, pole, pitch }
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  const q = frame(skel, p, ctx, ctx.pole, c, ctx.pitch(c))
  return { q, implements: [ctx.palmPose, ...(ctx.boxPose ? [ctx.boxPose] : [])], contacts: ctx.setup.contacts }
}

export const pushUp: Template<P> = {
  id: 'push-up',
  driver: 'root',
  params: SCHEMAS['push-up'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}

/** internals for the unit tests */
export const _pushUp = { context, flare }
