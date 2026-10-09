import { attachHand, root1d } from '../constraints.ts'
import { bodyCapsules } from '../collide.ts'
import { fk, localToWorld, segPos, sitePos } from '../fk.ts'
import type { ImplementSpec } from '../implements.ts'
import { around, band, bandNode, bandPose, segmentPose } from '../implements/index.ts'
import { palmRest } from '../implements/press-vertical-bodyweight.ts'
import { PLYO_BOX, plyoBox } from '../implements/shared.ts'
import { dls } from '../ik.ts'
import { add, DEG, lerp, norm, qalign, qconj, qid, qrot, RAD, scale, sub, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, minJerk, phaseAt, type Tempo } from '../timing.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { monotoneCubic } from './solve.ts'
import { clearNode } from './press-cable.ts'
import { ringContacts, ringPoses, ringRig, ringSpread, type RingRig } from './rings.ts'
import { RING_HEIGHT } from '../implements/index.ts'
import { memo, type Setup, type Template } from './types.ts'

// Push-up, root driver: palms flat and the balls of the feet planted (on the floor, or on a box under the hands or
// the feet); the body is a rigid plank pivoting about the balls of the feet, toes turned under. Plank pitch follows an
// elbow curve linear in contraction, from ~6 deg at the top to the depth that leaves the chest a fist above the
// support (the rig's long palm makes that ~110-120 deg, past the ~80-100 the motion-authoring research gives for a
// barbell touch). The elbows point back and out, ~28 deg from the torso with the hands under the shoulders to ~40 at
// 1.5 x shoulder width (coaching standard ~30-45); with the feet on a box the neck extends so the face clears. The
// scapulae retract as the chest lowers and protract at the top; the push-up plus adds full protraction after lockout
// (the thorax rises between the shoulder blades), still inside the default tempo.
// Kneeling: the knees rest on the floor with the toes turned under behind them, the plank pivoting at the knees.
// Pike: the hips folded high (an inverted V, legs straight, on the balls of the feet), the same rigid body pivoting
// about the feet, so the head lowers to the floor just in front of the hands and the arms press overhead in line with
// the trunk (shoulder flexion ~150 deg at the top; a vertical press against body weight).
// Diamond (grip under 0.5): the hands together under the chest, fingers turned in. Band: a band across the upper back
// (over the shoulder blades and the back of the shoulders), its ends pinned under the palms.
// Rings: the hands close on gymnastic rings hanging just above the floor (RING_HEIGHT.push_up), palms in and thumbs
// forward, wrists straight; the hands sit under the shoulders at the top, the elbows stay close to the sides
// (RING_PUSH.flare) and the thumbs turn out a little at lockout (RING_PUSH.turn). The plank and its pitch curve are the
// push-up's.

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
/** feet on a box: extra dorsiflexion as the plank tips head down (full at DECLINE_PITCH deg below horizontal), which
 * keeps the turned-under toes near level within the toe joint's range */
const DECLINE_DF = 10
const DECLINE_PITCH = 25
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
/** diamond (grip under 0.5 x shoulder width): the hands touch under the chest, index fingers and thumbs together, the
 * fingers turned in this far, deg (in line with the forearms seen from above); the elbows stay closer to the ribs at
 * the bottom: `flare` deg out from the torso (seen from above, ~20-25 against ~35 for the standard push-up), the pole
 * leaning `up` off the floor (the standard push-up's 0.6) and the hands `back` m towards the feet from where the wrist
 * alone would put them, so the forearms stay ~25 deg off the floor at the bottom */
const DIAMOND = { below: 0.5, turn: -45, flare: 22, up: 0.8, back: 0.04 }
const DIAMOND_FINGERS: V3 = [Math.sin(DIAMOND.turn * DEG), 0, Math.cos(DIAMOND.turn * DEG)]
const fingersFor = (p: P): V3 => (p.gripWidth < DIAMOND.below ? DIAMOND_FINGERS : FINGERS)
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
/** feet on a box: its top front edge this far ahead of the balls of the feet, m. The balls rest on the top and the
 * turned-under toes reach over the edge: at the toe joint's -60 stop they tip down ~10 deg at the bottom of the decline */
const BALL_EDGE = 0.03
const KNOTS = 17
/** kneeling: the capsules round the knee that rest on the floor, and how far they sink into it (soft tissue), m */
const KNEE_CAPS = /^(shank_[lr]1|thigh_[lr][23])/
const KNEE_SINK = 0.005
/** kneeling: ankle dorsiflexion with the toes turned under behind the knees, deg (the joint's stop: less tips the
 * forefoot capsule further into the floor than the push-up's toe sink allows) */
const KNEEL_DF = 40
/**
 * How far the capsule model sinks into a support at the palms and the balls of the feet, mm: the fist capsule models
 * fingers closed round a handle and the forefoot capsule straight toes, while here the palms lie flat and the toes
 * are turned under. The trunk, head and legs keep their clearance (push-up.test.ts). Palms on a box rest on it with the
 * same sink, feet on its edge with a smaller one. A lead decision.
 */
const HAND_SINK = 45
const FOOT_SINK = 65
/** the balls of the feet on the box's front edge: the forefoot capsule sinks ~28 mm into the edge, less than on the
 * floor (the toes reach over it) */
const FOOT_SINK_BOX = 30

/**
 * Band push-up: the strip crosses the upper back (an arc round the trunk at the armpits, thorax2 frame: lateral and
 * back half axes, m), wraps over the back of each shoulder (a node lifted off the straight run just far enough to clear
 * the shoulder, checked every frame), passes the outside of each deltoid (humerus frame) and runs to the floor beside
 * the little finger, then under the palm. The runs down the arms face the hero camera (az -45), so they read as a band
 */
const BAND_BACK = { at: [0, 0.03, 0.083] as V3, r: [0.19, 0.15] as [number, number], from: -40, to: -140 }
const BAND_DELT: V3 = [0.08, -0.07, -0.015]
/** the back-of-shoulder node: off the shoulder joint centre (thorax frame: lateral, towards the head, back), m, and the
 * way it moves if the upper arm still needs room */
const BAND_REAR: V3 = [0.07, -0.02, -0.065]
const BAND_REAR_DIR: V3 = [0, 1, -0.6]
const BAND_FACE: V3 = [-Math.SQRT1_2, 0, Math.SQRT1_2]
/** under the palm (palm rest frame, from the grip site at the finger roots): the palm's middle and the little finger edge */
const BAND_PALM = { mid: [0, 0.001, -0.045] as V3, edge: [0.05, 0.001, -0.045] as V3 }

/** pike: hip flexion, ankle dorsiflexion (heels up, toes turned under) and neck flexion (head in line, eyes back
 * between the hands), deg */
const PIKE = { hip: 88, ankle: 6, neck: [4, 4] }
/**
 * Ring push-up: upper-arm angle from the torso at the bottom (seen from above), deg (rings close to the sides); the
 * thumbs turn out this far at lockout, deg; wrist extension bias, deg (a straight wrist on the ring)
 */
const RING_PUSH = { flare: 18, turn: 20, wrist: 8 }
/** root-find ranges of the trunk pitch (deg above horizontal) for the lockout, the rep and the bottom, and of the hands'
 * distance from the balls of the feet (m): a plank lies near level, a pike tips head down */
const RANGES = {
  plank: { top: [45, -10], rep: [45, -40], bottom: [60, -40], hands: [1.0, 1.7] },
  pike: { top: [-5, -80], rep: [-2, -85], bottom: [-2, -88], hands: [0.6, 1.4] },
}

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
  if (p.pike && (p.kneeling || p.elevation !== 'floor' || p.plus || p.implement !== 'bodyweight')) return 'pike variant'
  if (p.kneeling && p.elevation !== 'floor') return `kneeling ${p.elevation}`
  if (p.implement === 'rings' && (p.kneeling || p.pike || p.plus || p.elevation !== 'floor')) return 'rings variant'
  return null
}

/** plank at `pitch`, girdle for contraction c, rooted so the left ball of the foot sits on its target; toes flat */
function plank(skel: Skeleton, q: Float64Array, p: P, ctx: Pick<Ctx, 'balls'>, c: number, pitch: number) {
  const plus = p.plus ? ramp(c, 0.5, 1) : 0
  setDofs(skel, q, {
    'lumbar.flex': 0,
    'thorax.flex': PLUS_THORAX * plus,
    'neck.flex': p.pike ? PIKE.neck[0] : NECK[p.elevation === 'feet' ? 1 : 0][0],
    'head.flex': p.pike ? PIKE.neck[1] : NECK[p.elevation === 'feet' ? 1 : 0][1],
    'hip_*.flex': p.pike ? PIKE.hip : HIP,
    'knee_*.flex': KNEE,
    'ankle_*.df': p.pike ? PIKE.ankle : p.kneeling ? KNEEL_DF : ANKLE_DF + (p.elevation === 'feet' ? DECLINE_DF * Math.min(1, Math.max(0, -pitch / DECLINE_PITCH)) : 0),
    'clavicle_*.prot': lerp(PROT[0], PROT[1], c) + PLUS * plus,
    'grip_*.close': 1,
  })
  q[skel.dof['pelvis.tilt']] = 90 - pitch
  const root = () => {
    const d = sub(ctx.balls[0], sitePos(skel, fk(skel, q), 'ball_l'))
    for (const [k, i] of [['pelvis.tx', 0], ['pelvis.ty', 1], ['pelvis.tz', 2]] as const) q[skel.dof[k]] += d[i]
  }
  root()
  if (p.kneeling) {
    // knees down: the knees bend until they rest on the floor, the balls of the feet planted behind them (toes under)
    const kneeAt = (k: number) => {
      q[skel.dof['knee_l.flex']] = q[skel.dof['knee_r.flex']] = k
      root()
      const caps = bodyCapsules(skel, fk(skel, q)).filter((cap) => KNEE_CAPS.test(cap.name))
      return Math.min(...caps.map((cap) => Math.min(cap.a[1], cap.b[1]) - cap.r)) + KNEE_SINK
    }
    kneeAt(root1d(kneeAt, KNEE, 150, { tol: 1e-6, scan: 15 }).x)
  }
  // toes turned under, lying flat (pointing towards the hands), on the floor or on the box top
  const toe = root1d((t) => {
    q[skel.dof['toe_l.flex']] = t
    const f = fk(skel, q)
    return qrot(f.rot[skel.seg.toes_l], [0, 0, 1])[1]
  }, -60, 30, { tol: 1e-6, scan: 9 }).x
  q[skel.dof['toe_l.flex']] = q[skel.dof['toe_r.flex']] = toe
}

/** flat palm, fingers forward and turned out a little */
const palmHand = (skel: Skeleton, fingers: V3) => qalign([0, -1, 0], skel.data.sites.grip_l.normal!, fingers, [0, -1, 0])

/** relaxed forearm and wrist limits for the arm solve: the wrist angles are set afterwards (wristAngles) */
const FREE = { limits: { pro: [-179, 179] as [number, number], flex: [-179, 179] as [number, number], dev: [-179, 179] as [number, number] }, devBand: [-179, 179] as [number, number] }

/**
 * Forearm rotation and wrist angles that lay the palm flat, fingers forward and turned out, within the joint ranges;
 * returns the hand's world rotation. Near 90 deg of extension the rig's pronation and deviation axes line up (and
 * the hand cannot roll about the fingers), so the arm solver's own split is arbitrary: a damped, bounded solve from
 * a fixed seed keeps it smooth, letting the palm tip a few degrees where a flat palm is out of reach.
 */
function wristAngles(skel: Skeleton, q: Float64Array, fingers: V3, seed: number[] = WRIST_SEED) {
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
    return [n[0], n[2], 0.5 * (f[0] * fingers[2] - f[2] * fingers[0]), REG[0] * (x[0] - seed[0]) * DEG, REG[1] * x[2] * DEG]
  }
  const lo = [-90, WRIST_FLEX[0], -35], hi = [85, WRIST_FLEX[1], 20]
  const r = dls(res, [seed[0], seed[1], 0], { tol: 1e-9, iters: 25, lo, hi })
  return handRot(r.x)
}

function arms(skel: Skeleton, q: Float64Array, ctx: Pick<Ctx, 'palms' | 'palmPose'>, bottom: V3, c: number, fingers: V3) {
  const pole = norm(add(scale(bottom, 1 - ramp(c, 0.1, 0.9)), scale(norm(POLE_TOP), ramp(c, 0.1, 0.9))))
  const s = ctx.palms.sites.l
  const pos = add(ctx.palmPose.pos, qrot(ctx.palmPose.rot, s.pos))
  const thorax = fk(skel, q).rot[skel.seg.thorax2]
  // the arm reaches the palm, the wrist lays it as flat as it can, and again (the hand's tip moves the wrist a little)
  let hand = palmHand(skel, fingers)
  for (let it = 0; it < 5; it++) {
    attachHand(skel, q, 'l', { pos, axis: [-1, 0, 0], palm: [0, -1, 0], hand }, { pole: qrot(thorax, pole), planeHint: 90, ...FREE })
    hand = wristAngles(skel, q, fingers)
  }
  for (const k of MIRRORED) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

/**
 * Both palms flat on a support (the left arm solved, the right mirrored): the left grip site at `pos`, fingers along the
 * horizontal `fingers`, the elbow towards `pole` (world); `seed`: the forearm pronation and wrist flexion the wrist
 * solve starts from and leans towards (deg). Shared with the bench dip.
 */
export function flatPalmArms(skel: Skeleton, q: Float64Array, pos: V3, fingers: V3, pole: V3, o: { seed?: number[]; planeHint?: number; iters?: number } = {}) {
  let hand = palmHand(skel, fingers)
  for (let it = 0; it < (o.iters ?? 5); it++) {
    attachHand(skel, q, 'l', { pos, axis: [-1, 0, 0], palm: [0, -1, 0], hand }, { pole, planeHint: o.planeHint ?? 90, ...FREE })
    hand = wristAngles(skel, q, fingers, o.seed)
  }
  for (const k of MIRRORED) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

/** palms flat under a loaded forearm: the wrist limits the push-up and the bench dip pass to the joint-limit gate */
export const PALM_WRIST_LIMITS = { 'wrist_l.flex': WRIST_FLEX, 'wrist_r.flex': WRIST_FLEX }
/** flat palms on a padded box or bench top: how far the fist capsule sinks into it, mm (see HAND_SINK) */
export const PALM_SINK = HAND_SINK

function frame(skel: Skeleton, p: P, ctx: Pick<Ctx, 'balls' | 'palms' | 'palmPose'>, pole: V3, c: number, pitch: number): Float64Array {
  const q = zeroQ(skel)
  plank(skel, q, p, ctx, c, pitch)
  arms(skel, q, ctx, pole, c, fingersFor(p))
  return q
}

/** upper-arm angle from the torso in its frontal plane, deg; `signed`: negative with the elbow in towards the midline */
function flare(skel: Skeleton, q: Float64Array, signed = false): number {
  const f = fk(skel, q)
  const h = qrot(qconj(f.rot[skel.seg.thorax2]), sub(segPos(skel, f, 'forearm_l'), segPos(skel, f, 'humerus_l')))
  return Math.atan2(signed ? h[0] : Math.abs(h[0]), -h[1]) * RAD
}

const elbowOf = (skel: Skeleton, q: Float64Array) => q[skel.dof['elbow_l.flex']]

// ---------- rings ----------

type RingCtx = { tempo: Tempo; setup: Setup; balls: [V3, V3]; rig: RingRig; grip: V3; pole: V3; pitch: (c: number) => number }

/** both hands on the rings (left solved, right mirrored): the left grip at `grip`, thumbs forward turning out towards lockout */
function ringArms(skel: Skeleton, q: Float64Array, grip: V3, pole: V3, c: number) {
  const thorax = fk(skel, q).rot[skel.seg.thorax2]
  const turn = RING_PUSH.turn * ramp(c, 0.4, 1) * DEG
  attachHand(skel, q, 'l', { pos: grip, axis: [Math.sin(turn), 0, Math.cos(turn)], palm: [-1, 0, 0] }, { pole: qrot(thorax, pole), wristBias: RING_PUSH.wrist, planeHint: 90 })
  for (const k of MIRRORED) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

function ringFrame(skel: Skeleton, p: P, ctx: Pick<RingCtx, 'balls' | 'grip' | 'pole'>, c: number, pitch: number): Float64Array {
  const q = zeroQ(skel)
  plank(skel, q, p, ctx, c, pitch)
  ringArms(skel, q, ctx.grip, ctx.pole, c)
  return q
}

const ringContext = memo((p: P, skel: Skeleton): RingCtx => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const f0 = fk(skel, zeroQ(skel))
  const bx = sitePos(skel, f0, 'ball_l')[0]
  const balls: [V3, V3] = [[bx, 0, 0], [-bx, 0, 0]]
  const half = (p.gripWidth * skel.data.shoulderWidth) / 2
  const h = RING_HEIGHT.push_up
  // elbow pole in the thorax frame: back towards the feet, out by `t`, lifted off the floor
  const poleAt = (t: number): V3 => norm([Math.sin(t * DEG), -Math.cos(t * DEG), -0.3])
  const v = { balls, grip: [half, h, 1.3] as V3, pole: poleAt(20) }
  const R = RANGES.plank
  const elbowOf2 = (c: number, a: number) => elbowOf(skel, ringFrame(skel, p, v, c, a))
  const topPitch = () => root1d((a) => elbowOf2(1, a) - ELBOW_TOP, R.top[0], R.top[1], { tol: 1e-6, scan: 11 }).x
  // bottom: the chest CHEST_GAP above the hands' height
  const chest = (a: number) => {
    const caps = bodyCapsules(skel, fk(skel, ringFrame(skel, p, v, 0, a)))
    return Math.min(...caps.filter((k) => /^thorax/.test(k.segment)).map((k) => Math.min(k.a[1], k.b[1]) - k.r)) - h - CHEST_GAP
  }
  const bottomPitch = () => root1d(chest, R.bottom[0], R.bottom[1], { tol: 1e-6, scan: 20 }).x
  // the hands under the shoulders at the top, the elbows RING_PUSH.flare out at the bottom
  for (let pass = 0; pass < 6; pass++) {
    const z0 = v.grip[2]
    v.grip = [half, h, root1d((z) => {
      v.grip = [half, h, z]
      const f = fk(skel, ringFrame(skel, p, v, 1, topPitch()))
      return segPos(skel, f, 'humerus_l')[2] - z
    }, R.hands[0], R.hands[1], { tol: 1e-5, scan: 7 }).x]
    v.pole = poleAt(root1d((t) => {
      v.pole = poleAt(t)
      return flare(skel, ringFrame(skel, p, v, 0, bottomPitch())) - RING_PUSH.flare
    }, 0, 70, { tol: 1e-4, scan: 8 }).x)
    if (pass && Math.abs(v.grip[2] - z0) < 1e-4) break
  }
  const elbowBottom = elbowOf2(0, bottomPitch())
  const pitchFor = (c: number) => root1d((a) => elbowOf2(c, a) - lerp(elbowBottom, ELBOW_TOP, c), R.rep[0], R.rep[1], { tol: 1e-6, scan: 17 }).x
  const cs = Array.from({ length: KNOTS }, (_, i) => i / (KNOTS - 1))
  const pitch = monotoneCubic(cs, cs.map(pitchFor))
  // the straps hang from a beam overhead (a rig's uprights would stand across the plank), just outside the arms
  const rig = ringRig({ z: v.grip[2], spread: ringSpread(half), mount: 'beam' })
  const setup: Setup = {
    implements: rig.implements,
    contacts: [
      { site: 'ball_l', kind: 'planted', target: { world: balls[0] } },
      { site: 'ball_r', kind: 'planted', target: { world: balls[1] } },
      ...ringContacts(),
    ],
    tempo,
    symmetric: true,
    tolerances: { floor: FOOT_SINK },
  }
  return { tempo, setup, balls, rig, grip: v.grip, pole: v.pole, pitch }
})

function sampleRings(u: number, p: P, skel: Skeleton): Pose {
  const ctx = ringContext(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  const q = ringFrame(skel, p, ctx, c, ctx.pitch(c))
  return { q, implements: ringPoses(skel, fk(skel, q), ctx.rig), contacts: ctx.setup.contacts }
}

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
  const up = p.gripWidth < DIAMOND.below ? DIAMOND.up : 0.6
  const poleAt = (t: number): V3 => norm([Math.sin(t * DEG), -0.8 * Math.cos(t * DEG), -up])
  // bottom: plank pitch that puts the chest CHEST_GAP above the support, or the head HEAD_GAP above the floor where
  // that comes first (feet on a box tip the head down)
  const chest = (a: number) => {
    const caps = bodyCapsules(skel, fk(skel, frame(skel, p, base, pole, 0, a)))
    const low = (re: RegExp) => Math.min(...caps.filter((k) => re.test(k.segment)).map((k) => Math.min(k.a[1], k.b[1]) - k.r))
    return Math.min(low(/^thorax/) - handsH - CHEST_GAP, low(/^head$/) - HEAD_GAP)
  }
  const R = p.pike ? RANGES.pike : RANGES.plank
  const bottomPitch = () => root1d(chest, R.bottom[0], R.bottom[1], { tol: 1e-6, scan: 20 }).x
  // hands just far enough ahead of the shoulders for WRIST_TOP at the top or WRIST_BOTTOM at the bottom, whichever
  // binds (on a box: the plank pivots through a steeper arc, so the shoulders travel further forward on the way
  // down); elbow pole (out and back towards the feet, the elbow pointing away from the floor) that gives the FLARE
  // at the bottom
  const topPitch = () => root1d((a) => elbowOf(skel, frame(skel, p, base, pole, 1, a)) - ELBOW_TOP, R.top[0], R.top[1], { tol: 1e-6, scan: 11 }).x
  const wristTop = (z: number) => {
    palmPose.pos = [0, palmPose.pos[1], z]
    const w = (c: number, a: number) => frame(skel, p, base, pole, c, a)[skel.dof['wrist_l.flex']]
    return Math.min(w(1, topPitch()) + WRIST_TOP, w(0, bottomPitch()) + WRIST_BOTTOM)
  }
  const diamond = p.gripWidth < DIAMOND.below
  const flareTo = diamond ? DIAMOND.flare : FLARE[0] + FLARE[1] * Math.max(0, p.gripWidth - 1)
  const elbowOut = (t: number) => {
    pole = poleAt(t)
    // the diamond's hands sit inside the shoulders, so its elbow could also swing in under the chest: only outwards counts
    return flare(skel, frame(skel, p, base, pole, 0, bottomPitch()), diamond) - flareTo
  }
  // hand placement and elbow pole depend on each other once the bottom binds
  for (let pass = 0; pass < 6; pass++) {
    const z0 = palmPose.pos[2]
    palmPose.pos = [0, palmPose.pos[1], root1d(wristTop, R.hands[0], R.hands[1], { tol: 1e-5, scan: 7 }).x - (diamond ? DIAMOND.back : 0)]
    pole = poleAt(root1d(elbowOut, 0, 80, { tol: 1e-4, scan: 8 }).x)
    if (pass && Math.abs(palmPose.pos[2] - z0) < 1e-4) break
  }
  const elbowBottom = elbowOf(skel, frame(skel, p, base, pole, 0, bottomPitch()))
  const target = (c: number) => lerp(elbowBottom, ELBOW_TOP, c)
  const pitchFor = (c: number) => root1d((a) => elbowOf(skel, frame(skel, p, base, pole, c, a)) - target(c), R.rep[0], R.rep[1], { tol: 1e-6, scan: 17 }).x
  const cs = Array.from({ length: KNOTS }, (_, i) => i / (KNOTS - 1))
  const pitch = monotoneCubic(cs, cs.map(pitchFor))
  const implements_: ImplementSpec[] = [palms]
  let boxPose: ImplementPose | undefined
  let rests: Setup['rests']
  if (p.elevation !== 'floor') {
    const box = plyoBox({ height: BOX_H, width: p.elevation === 'hands' ? HANDS_BOX_W : PLYO_BOX.width })
    implements_.push(box)
    // hands: the palm heels just inside the edge nearer the feet; feet: the balls of the feet just behind its front
    // edge, the toes on the top
    const z = p.elevation === 'hands' ? palmPose.pos[2] - 0.135 + PLYO_BOX.depth / 2 : BALL_EDGE - PLYO_BOX.depth / 2
    boxPose = { id: box.id, pos: [0, 0, z], rot: qid() }
    rests = p.elevation === 'hands'
      ? [{ implement: box.id, regions: ['hand_l', 'hand_r'], tol: HAND_SINK }]
      : [{ implement: box.id, regions: ['foot_l', 'foot_r'], tol: FOOT_SINK_BOX }]
  }
  if (p.implement === 'band') {
    const under = (side: 'l' | 'r', at: V3) => ({ implement: palms.id, site: side, at: side === 'l' ? at : ([-at[0], at[1], at[2]] as V3), face: [0, 1, 0] as V3 })
    const delt = (s: 'l' | 'r') => ({ implement: `delt_${s}`, face: BAND_FACE })
    implements_.push(...['back', 'delt_l', 'delt_r', 'rear_l', 'rear_r'].map((id) => bandNode(id)), band({
      size: 'heavy',
      path: [
        under('l', BAND_PALM.mid), under('l', BAND_PALM.edge), delt('l'), 'rear_l',
        ...around('back', { r: BAND_BACK.r, from: BAND_BACK.from, to: BAND_BACK.to, n: 7, center: BAND_BACK.at }),
        'rear_r', delt('r'), under('r', BAND_PALM.edge), under('r', BAND_PALM.mid),
      ],
    }))
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
  if (p.implement === 'rings') return sampleRings(u, p, skel)
  const ctx = context(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  const q = frame(skel, p, ctx, ctx.pole, c, ctx.pitch(c))
  const implements_ = [ctx.palmPose, ...(ctx.boxPose ? [ctx.boxPose] : [])]
  if (p.implement === 'band') {
    const f = fk(skel, q)
    const mirror = (v: V3): V3 => [-v[0], v[1], v[2]]
    const back = segmentPose(skel, f, 'back', 'thorax2')
    const caps = bodyCapsules(skel, f)
    const dir = norm(qrot(back.rot, BAND_REAR_DIR))
    implements_.push(back)
    for (const s of ['l', 'r'] as const) {
      const m = (v: V3): V3 => (s === 'l' ? v : mirror(v))
      const delt = localToWorld(skel, f, `humerus_${s}`, m(BAND_DELT))
      const ang = BAND_BACK.from * DEG
      const arc = localToWorld(skel, f, 'thorax2', add(BAND_BACK.at, m([BAND_BACK.r[0] * Math.cos(ang), 0, BAND_BACK.r[1] * Math.sin(ang)])))
      // on the back of the shoulder (thorax frame off the joint centre), lifted only as far as the upper arm needs
      const near = caps.filter((c) => c.region === `upperarm_${s}`)
      const base = add(segPos(skel, f, `humerus_${s}`), qrot(back.rot, m(BAND_REAR)))
      const rear = clearNode(near, delt, arc, base, dir, 0.004, 0.06)
      // world-aligned nodes, so the strip's face (BAND_FACE) is a world direction
      implements_.push({ id: `delt_${s}`, pos: delt, rot: qid() }, { id: `rear_${s}`, pos: rear, rot: qid() })
    }
    implements_.push(bandPose())
  }
  return { q, implements: implements_, contacts: ctx.setup.contacts }
}

export const pushUp: Template<P> = {
  id: 'push-up',
  driver: 'root',
  params: SCHEMAS['push-up'],
  implemented: true,
  setup: (p, skel) => {
    const why = unsupported(p)
    if (why) throw new Error(`push-up: variant not implemented yet (${why})`)
    return p.implement === 'rings' ? ringContext(p, skel).setup : context(p, skel).setup
  },
  sample,
}

/** internals for the unit tests */
export const _pushUp = { context, ringContext, flare }
