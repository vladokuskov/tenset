import { attachHand, jointByName, legKinematics, plantFoot, root1d, writeLeg, type FootTarget, type LegSolve } from '../constraints.ts'
import { bodyCapsules } from '../collide.ts'
import { centerOfMass, fk, segPos, sitePos } from '../fk.ts'
import { eulerAngles, limbRotation, twoBone } from '../ik.ts'
import { dumbbell, type ImplementSpec } from '../implements.ts'
import { splitBench } from '../implements/legs-knee.ts'
import { plyoBox, PLYO_BOX } from '../implements/shared.ts'
import { add, clamp, DEG, lerp, qaxis, qconj, qid, qmul, qrot, sub, type Quat, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Side, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, loopDuration, minJerk, phaseAt, type Tempo } from '../timing.ts'
import { dumbbellContacts, dumbbellPoses } from './arms.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { setPelvis } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Lunge family, root space: the hips are placed (height keyed by depth, fore-aft by balance: the centre of mass with
// the dumbbells goes where the feet share the weight) and the legs are solved to their feet. The right leg works: it
// stays planted in front (split squat, reverse lunge) or on the box (step-up), or steps out and back (forward lunge,
// the in-place form of the walking lunge). The foot that moves swings in joint space between its planted poses,
// matching their position, rate and acceleration, so lift-off and touch-down join without a jolt. Ranges
// (motion-authoring research, lunge): front knee ~5 -> 90-100, rear knee -> 80-100, rear hip extended at the bottom.
// The front knee bends in the plane of its toes, the trunk stays within torsoAngle of upright, the dumbbells hang
// straight down.

type P = ParamsOf<'lunge'>
type Kind = 'split' | 'reverse' | 'forward' | 'step_up'
type Moving = Exclude<Kind, 'split'>
const KIND_LIST: Kind[] = ['split', 'reverse', 'forward', 'step_up']

const DB_KG = 16
const TOE_OUT = 6
/** feet this far from the midline (hip width apart), m */
const HALF_WIDTH = 0.125
/** knees at the top: standing tall, not locked */
const TOP_KNEE = 3
/** front knee flexion cap at the bottom, deg (research 90-100; the split squat sinks a little deeper) */
const FRONT_KNEE_MAX: Record<Kind, number> = { split: 105, reverse: 100, forward: 100, step_up: 100 }
/** the rear kneecap stops this far above the floor, m */
const REAR_KNEE_CLEAR = 0.035
/** trailing leg at the bottom of the step-up, deg */
const STEP_TRAIL_KNEE = 35
/** share of the body weight on the back foot at the bottom (split squat: at the top and at the bottom) */
const REAR_SHARE: Record<Kind, number> = { split: 0.3, reverse: 0.35, forward: 0.4, step_up: 0.7 }
const SPLIT_TOP_SHARE = 0.12
/** front midfoot to rear ball (split squat: to the rear ankle) as a fraction of stepLength x leg length */
const STEP_SCALE: Record<Kind, number> = { split: 0.72, reverse: 0.84, forward: 0.84, step_up: 0 }
/** floor tolerance for a rear foot on its ball, mm: the rigid forefoot capsule sinks ~63 mm at REAR_PITCH.bottom */
const REAR_FLOOR_TOL = 65
/** reverse lunge rear foot on its ball: heel lift at touch-down and at the bottom, deg */
const REAR_PITCH = { land: 32, bottom: 58 }
/** knee bend of the moving leg at touch-down and at lift-off, deg: the setup solves when those happen */
const TOUCH_KNEE: Record<Moving, number> = { reverse: 65, forward: 60, step_up: 25 }
const OFF_KNEE: Record<Moving, number> = { reverse: 82, forward: 90, step_up: 34.5 }
/** the weight starts moving towards the back foot at this fraction of the touch-down depth (a controlled fall back) */
const WEIGHT_FROM: Record<Moving, number> = { reverse: 0.2, forward: 1, step_up: 0.15 }
/** way up: concentric progress by which the weight is off the back foot */
const UP_WEIGHT: Record<Moving, number> = { reverse: 0.7, forward: 0.6, step_up: 0.9 }
/** hip and knee bend added mid-swing, deg: on the way down and on the way up */
const SWING_BEND: Record<Moving, { down: [number, number]; up: [number, number] }> = {
  reverse: { down: [15, 40], up: [20, 50] },
  forward: { down: [20, 55], up: [15, 50] },
  step_up: { down: [-10, 40], up: [0, 70] },
}
/** pelvis hinge (tilt with the spine held) at touch-down, deg; the step-up leans over the box foot all the way down */
const HINGE: Record<Kind, number> = { split: 0, reverse: 10, forward: 0, step_up: 16 }
/** pelvis shift over the standing foot while the other foot is in the air, m */
const SHIFT = 0.035
/** dumbbells hang this far outside the shoulder joints, m, and the grip this far below them */
const HANG = { out: 0.085, down: 0.69 }
const PLATFORM: Record<P['platformHeight'], number> = { low: 0.2, mid: 0.3, knee: 0.45 }
/** split squat bench seat height, m */
const BENCH_HEIGHT: Record<P['platformHeight'], number> = { low: 0.3, mid: 0.38, knee: 0.44 }
/** split squat rear foot: top of the foot down, toes back (deg about X from standing), toes flat on the pad, skin
 * sink and how far the pad reaches past the forefoot contact, m */
const BENCH_FOOT = { pitch: 145, toes: 35, sink: 0.004, overhang: 0.04 }
/** split squat rear ankle: pointed past the usual -50 deg so the top of the foot lies on the pad (lead decision) */
const BENCH_ANKLE: [number, number] = [-70, 40]
/** skin on the top of the foot (foot frame from the ankle, m): over the ball and over the midfoot */
const DORSUM: V3[] = [[0, -0.04, 0.133], [0, -0.01, 0.076]]
/** how far the rear foot's collision capsules may sink into the split squat bench, mm (lead decision) */
const BENCH_FOOT_TOL = 55
/** step-up top: standing tall on the box foot with the other knee driven up (LEG_DOFS order) */
const KNEE_DRIVE = [75, 4, -4, 95, -10, 0, 0]
/** step-up: the trailing foot's spot behind the box, m */
const TRAIL_BEHIND = 0.4

/** the moving foot leaves home at this depth on the way down and is home by this concentric progress on the way up
 * (the hips start down and finish rising on both feet; the step-up's home is the knee drive, in the air) */
const HOME: Record<Moving, [number, number]> = { reverse: [0.06, 0.85], forward: [0.06, 0.95], step_up: [0, 1] }
/** step-up tuck: fractions of the swing over which the hip and knee bends rise and fall */
const TUCK = { hipRise: 0.5, kneeRise: 0.4, fall: 0.5 }
/** quintic smoothstep on [0, 1], clamped */
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (10 - 15 * x + 6 * x * x))
/** how long the planted motion carries into a swing, in loop fraction (~0.15 s) */
const SWING_EASE = 0.04
/** the moving leg's DOFs, in swing curve order */
const LEG_DOFS = ['hip_*.flex', 'hip_*.abd', 'hip_*.rot', 'knee_*.flex', 'ankle_*.df', 'ankle_*.inv', 'toe_*.flex']

/** a swing: loop fraction span and the planted leg's angles, rates and accelerations (per unit u) at both ends */
type Curve = { u0: number; u1: number; p0: number[]; v0: number[]; a0: number[]; p1: number[]; v1: number[]; a1: number[]; bend: [number, number]; early: boolean }

type Ctx = {
  kind: Kind
  tempo: Tempo
  setup: Setup
  torso: number
  /** right foot planted (split squat, reverse lunge, step-up) or its landing spot (forward lunge) */
  front: FootTarget
  frontMid: V3
  /** forward lunge: the right foot's home beside the left one */
  frontHome?: FootTarget
  /** left foot home beside the right one; reverse and forward lunge: its ball spot behind */
  rearHome: FootTarget
  rearBall?: V3
  /** split squat: the rear foot on the bench */
  rearFixed?: FootTarget
  /** step-up: the left foot's spot on the floor behind the box */
  trail?: FootTarget
  box?: { spec: ImplementSpec; pose: ImplementPose; back: number; top: number }
  bench?: { spec: ImplementSpec; pose: ImplementPose }
  hipTop: number
  hipBottom: number
  /** depth at which the moving foot touches down, and concentric progress where it leaves the floor */
  touch: number
  off: number
  down?: Curve
  up?: Curve
}

/**
 * depth 0 (top) .. 1 (bottom); swing 0 (moving foot home) .. 1 (at its bottom spot); weight 0 (all on the standing
 * foot) .. 1 (the bottom's share on the back foot); u, while the moving foot is in the air
 */
type State = { depth: number; swing: number; weight: number; up: boolean; u?: number }

function kindOf(p: P): Kind | string {
  if (p.implement !== 'dumbbell') return p.implement
  if (p.hold !== 'sides') return `hold ${p.hold}`
  if (p.side !== 'right') return 'left working side'
  if (p.direction === 'in_place') return p.rearFootElevated ? 'split' : 'split squat with the rear foot on the floor'
  if (p.rearFootElevated) return `${p.direction} with the rear foot elevated`
  if (p.direction === 'step_up') return 'step_up'
  return p.direction
}

// ---------- timeline ----------

const ramp = (x: number, a: number, b: number) => minJerk(clamp((x - a) / (b - a), 0, 1))

/**
 * Depth eases per phase (minimum jerk). Down: the moving foot leaves home as the hips start to drop and lands at
 * touch-down depth, the weight moves back with depth. Up: the weight moves onto the working foot while the moving foot
 * leaves at lift-off and swings home by the end of the rise.
 */
function stateAt(ctx: Ctx, u: number): State {
  const ph = phaseAt(u, ctx.tempo)
  const depth = 1 - ph.c
  if (ctx.kind === 'split') return { depth, swing: 0, weight: 1, up: false }
  const [leave, land] = HOME[ctx.kind as Moving]
  const s = ph.name === 'con' ? upState(ctx, ph.progress, 1 - ramp(ph.progress, ctx.off, land)) : downState(ctx, depth, ramp(depth, leave, ctx.touch))
  return s.swing > 0 && s.swing < 1 ? { ...s, u } : s
}

function downState(ctx: Ctx, depth: number, swing: number): State {
  return { depth, swing, weight: ramp(depth, WEIGHT_FROM[ctx.kind as Moving] * ctx.touch, 1), up: false }
}

function upState(ctx: Ctx, p: number, swing: number): State {
  return { depth: 1 - minJerk(p), swing, weight: 1 - ramp(p, 0, UP_WEIGHT[ctx.kind as Moving]), up: true }
}

/**
 * Swing angles at u: a smoothstep from the start pose to the end pose, plus the planted motion at each end carried
 * in and out (its rate and acceleration, fading over SWING_EASE and gone by the far end), plus a hip and knee bend that is flat at both ends.
 * Position, rate and acceleration match the planted phases at lift-off and touch-down.
 */
function swingAt(c: Curve, u: number): number[] {
  const d = c.u1 - c.u0
  const s = clamp(u - c.u0, 0, d), e = d - s, t = s / d
  const step = t * t * t * (10 - 15 * t + 6 * t * t)
  // around the box the leg stays tucked through the middle of the swing (the knee tucks first, the hip follows)
  const plateau = (rise: number, fall: number) => smooth(t / rise) * smooth((1 - t) / fall)
  const b = 64 * (t * (1 - t)) ** 3
  const bumps = c.early ? [plateau(TUCK.hipRise, TUCK.fall), plateau(TUCK.kneeRise, TUCK.fall)] : [b, b]
  const k = SWING_EASE
  const fs = Math.exp(-s / k), fe = Math.exp(-e / k)
  return c.p0.map((x, i) => {
    const out = (c.v0[i] * s + ((c.a0[i] + (2 * c.v0[i]) / k) / 2) * s * s) * fs
    const into = (-c.v1[i] * e + ((c.a1[i] - (2 * c.v1[i]) / k) / 2) * e * e) * fe
    return x + (c.p1[i] - x) * step + out * (1 - step) + into * step + (i === 0 ? c.bend[0] * bumps[0] : i === 3 ? c.bend[1] * bumps[1] : 0)
  })
}

// ---------- body ----------

/** trunk lean from vertical (deg) shared by pelvis, lumbar and thorax; returns the pelvis tilt */
function trunk(skel: Skeleton, q: Float64Array, lean: number) {
  setDofs(skel, q, { 'lumbar.flex': 0.3 * lean, 'thorax.flex': 0.25 * lean, 'clavicle_*.prot': -4, 'clavicle_*.elev': 3, 'grip_*.close': 1 })
  return 0.45 * lean
}

function hinge(ctx: Ctx, d: number) {
  if (ctx.kind === 'split') return 0
  if (ctx.kind === 'step_up') return HINGE.step_up * ramp(d, 0, 1)
  const t = ctx.touch
  const hat = d <= t ? Math.sin((Math.PI * d) / (2 * t)) ** 2 : Math.cos((Math.PI * (d - t)) / (2 * (1 - t))) ** 2
  return HINGE[ctx.kind] * hat
}

function gaze(skel: Skeleton, q: Float64Array) {
  const d = skel.dof
  const pitch = q[d['pelvis.tilt']] + q[d['lumbar.flex']] + q[d['thorax.flex']]
  setDofs(skel, q, { 'neck.flex': -0.5 * pitch, 'head.flex': -0.25 * pitch })
}

const KNEE_AXIS: V3 = [1, 0, 0]

/** leg IK to a foot with the knee bending towards `pole` (the split squat's rear foot points backwards) */
function legTowards(skel: Skeleton, side: Side, hip: V3, pelvisRot: Quat, foot: FootTarget, pole: V3): LegSolve {
  const lt = skel.segments[skel.seg[`femur_${side}`]].length
  const ls = skel.segments[skel.seg[`tibia_${side}`]].length
  const ik = twoBone(hip, foot.ankle, lt, ls, pole, { minFlex: 0.5, soft: 2 })
  const femur = limbRotation(hip, ik.mid, ik.hinge, KNEE_AXIS)
  const tibia = qmul(femur, qaxis(KNEE_AXIS, ik.flex * DEG))
  const h = eulerAngles(skel, jointByName(skel, `hip_${side}`), qmul(qconj(pelvisRot), femur))
  const a = eulerAngles(skel, jointByName(skel, `ankle_${side}`), qmul(qconj(tibia), foot.rot))
  return { hip: h.values, knee: ik.flex, ankle: a.values, residual: a.residual, shortfall: ik.shortfall, femur, tibia, kneePos: ik.mid }
}

/** foot on its ball at `ball`, heel lifted `pitch` deg, toes out `yaw` deg */
function footOnBall(skel: Skeleton, side: Side, ball: V3, pitch: number, yaw: number): FootTarget {
  const rot = qmul(qaxis([0, 1, 0], (side === 'l' ? yaw : -yaw) * DEG), qaxis([1, 0, 0], pitch * DEG))
  return { side, rot, ankle: sub(ball, qrot(rot, skel.data.sites[`ball_${side}`].local)) }
}

const ballOf = (skel: Skeleton, f: FootTarget) => add(f.ankle, qrot(f.rot, skel.data.sites[`ball_${f.side}`].local))
const midOf = (skel: Skeleton, f: FootTarget) => add(f.ankle, qrot(f.rot, skel.data.sites[`midfoot_${f.side}`].local))

/** both feet where they are planted (the moving foot at home or at its bottom spot), toes, and the balance target */
type Feet = { r: FootTarget; l: FootTarget; toes: { l: number; r: number }; poleL?: V3; comZ: number; shift: number; moving?: Side; drive?: boolean }

function feetAt(skel: Skeleton, ctx: Ctx, s: State): Feet {
  const share = REAR_SHARE[ctx.kind] * s.weight
  const air = Math.sin(Math.PI * s.swing) ** 2
  const landed = s.swing >= 0.5
  switch (ctx.kind) {
    case 'split': {
      const rear = ctx.rearFixed!
      // the hips sit back as they drop: more of the weight goes to the bench at the bottom
      const back = lerp(SPLIT_TOP_SHARE, REAR_SHARE.split, s.depth)
      return { r: ctx.front, l: rear, toes: { l: BENCH_FOOT.toes, r: 0 }, poleL: [0, 0, 1], comZ: ctx.frontMid[2] - back * (ctx.frontMid[2] - rear.ankle[2]), shift: 0 }
    }
    case 'reverse': {
      const land = ctx.rearBall!
      const pitch = REAR_PITCH.land + (REAR_PITCH.bottom - REAR_PITCH.land) * s.weight
      const l = landed ? footOnBall(skel, 'l', land, pitch, TOE_OUT) : ctx.rearHome
      // over one foot the centre of mass sits towards its heel
      const over = ctx.frontMid[2] - 0.06 * (s.up ? minJerk(s.swing) : ramp(s.depth, 0, ctx.touch))
      return { r: ctx.front, l, toes: { l: landed ? -Math.min(58, pitch) : 0, r: 0 }, comZ: over - share * (over - land[2]), shift: -SHIFT * air, moving: 'l' }
    }
    case 'forward': {
      const ball = ctx.rearBall!
      const pitch = REAR_PITCH.bottom * ramp(s.depth, 0.05, 1)
      const split = ball[2] + (1 - REAR_SHARE.forward) * (ctx.frontMid[2] - ball[2])
      const comZ = lerp(midOf(skel, ctx.rearHome)[2], split, 1 - (1 - s.depth) ** 3)
      return { r: landed ? ctx.front : ctx.frontHome!, l: footOnBall(skel, 'l', ball, pitch, TOE_OUT), toes: { l: -Math.min(58, pitch), r: 0 }, comZ, shift: SHIFT * air, moving: 'r' }
    }
    case 'step_up': {
      const trail = ctx.trail!
      return { r: ctx.front, l: trail, toes: { l: 0, r: 0 }, comZ: ctx.frontMid[2] - share * (ctx.frontMid[2] - midOf(skel, trail)[2]), shift: -SHIFT * air, moving: 'l', drive: !landed }
    }
  }
}

/** dumbbells as point loads at the grips */
function loads(skel: Skeleton, q: Float64Array) {
  const f = fk(skel, q)
  return (['l', 'r'] as const).map((s) => ({ mass: DB_KG, pos: sitePos(skel, f, `grip_${s}`) }))
}

/** arms hanging straight down from the shoulders, palms in, the dumbbells clear of the legs */
function hangArms(skel: Skeleton, q: Float64Array) {
  const f = fk(skel, q)
  for (const s of ['l', 'r'] as const) {
    const sx = s === 'l' ? 1 : -1
    const sh = segPos(skel, f, `humerus_${s}`)
    const pos: V3 = [sh[0] + sx * HANG.out, sh[1] - HANG.down, sh[2]]
    attachHand(skel, q, s, { pos, axis: [0, 0, 1], palm: [-sx, 0, 0] }, { pole: [sx * 0.25, 0, -1], planeHint: 0 })
  }
}

/** arm angles close to the hang, used while balancing (the loads' fore-aft position barely depends on them) */
function roughArms(skel: Skeleton, q: Float64Array) {
  setDofs(skel, q, { 'shoulder_*.plane': -20, 'shoulder_*.elev': 8, 'shoulder_*.rot': 0, 'elbow_*.flex': 8, 'forearm_*.pro': 0, 'scapula_*.uprot': 2 })
}

/** legs to their feet; a swinging leg (`air`, LEG_DOFS order) or the step-up's knee drive is set in joint space */
function placeLegs(skel: Skeleton, q: Float64Array, feet: Feet, air?: number[]) {
  const f = fk(skel, q)
  const rot = f.rot[skel.seg.pelvis]
  for (const s of ['l', 'r'] as const) {
    const set = air && feet.moving === s ? air : feet.drive && feet.moving === s ? KNEE_DRIVE : undefined
    if (set) {
      LEG_DOFS.forEach((k, i) => (q[skel.dof[k.replace('*', s)]] = set[i]))
      continue
    }
    const hip = f.pos[skel.seg[`femur_${s}`]]
    writeLeg(skel, q, s, s === 'l' && feet.poleL ? legTowards(skel, s, hip, rot, feet.l, feet.poleL) : legKinematics(skel, s, hip, rot, feet[s]))
    q[skel.dof[`toe_${s}.flex`]] = feet.toes[s]
  }
}

/** the pose for a state: hips at the keyed height, moved fore and aft until the centre of mass sits at feet.comZ */
function solve(skel: Skeleton, ctx: Ctx, s: State, feet: Feet, air?: number[]): Float64Array {
  const q = zeroQ(skel)
  const y = lerp(ctx.hipTop, ctx.hipBottom, s.depth)
  const tilt = trunk(skel, q, 3 + (ctx.torso - 3) * s.depth) + hinge(ctx, s.depth)
  roughArms(skel, q)
  const place = (z: number) => {
    setPelvis(skel, q, [feet.shift, y, z], tilt)
    placeLegs(skel, q, feet, air)
  }
  const com = () => centerOfMass(skel, fk(skel, q), loads(skel, q))[2]
  const r = root1d((z) => {
    place(z)
    return com() - feet.comZ
  }, feet.comZ - 0.4, feet.comZ + 0.4, { tol: 1e-7 })
  place(r.x)
  hangArms(skel, q)
  gaze(skel, q)
  return q
}

/** full pose for a loop state: a foot in the air follows its swing curve */
function poseFor(skel: Skeleton, ctx: Ctx, s: State): Float64Array {
  const curve = s.u === undefined ? undefined : s.up ? ctx.up : ctx.down
  const feet = feetAt(skel, ctx, s)
  return solve(skel, ctx, s, feet, curve && swingAt(curve, s.u!))
}

// ---------- setup ----------

const kneeOf = (skel: Skeleton, q: Float64Array, s: Side) => q[skel.dof[`knee_${s}.flex`]]

/** lowest point of the rear knee over the floor (thigh and shin capsules), m */
function rearKneeHeight(skel: Skeleton, q: Float64Array) {
  const caps = bodyCapsules(skel, fk(skel, q)).filter((c) => /^(thigh|shank)_l$/.test(c.region))
  return Math.min(...caps.map((c) => Math.min(c.a[1], c.b[1]) - c.r))
}

const planted = (skel: Skeleton, f: FootTarget, sites = ['heel', 'ball']) =>
  sites.map((site): Contact => ({ site: `${site}_${f.side}`, kind: 'planted', target: { world: add(f.ankle, qrot(f.rot, skel.data.sites[`${site}_${f.side}`].local)) } }))

function context(p: P, skel: Skeleton): Ctx {
  const k = kindOf(p)
  if (!(KIND_LIST as string[]).includes(k)) throw new Error(`lunge: variant not implemented yet (${k})`)
  const kind = k as Kind
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const leg = segPos(skel, fk(skel, zeroQ(skel)), 'femur_r')[1]
  const D = STEP_SCALE[kind] * p.stepLength * leg
  const implements_: ImplementSpec[] = [dumbbell({ id: 'db_l', mass: DB_KG }), dumbbell({ id: 'db_r', mass: DB_KG })]
  const contacts: Contact[] = [...dumbbellContacts()]
  const base = { kind, tempo, torso: p.torsoAngle, setup: undefined as unknown as Setup, hipTop: 0, hipBottom: 0, touch: 0.6, off: 0.3 }
  let ctx: Ctx
  if (kind === 'split') {
    // rear foot laces-down on the bench, toes back and lying on the pad; the pad's near end just past the forefoot
    const h = BENCH_HEIGHT[p.platformHeight]
    const rot = qaxis([1, 0, 0], BENCH_FOOT.pitch * DEG)
    const low = DORSUM.map((d) => qrot(rot, d)).reduce((a, b) => (b[1] < a[1] ? b : a))
    const ankle: V3 = [HALF_WIDTH, h - low[1] - BENCH_FOOT.sink, -0.55]
    const rear: FootTarget = { side: 'l', rot, ankle }
    const bench = splitBench({ height: h })
    const pose: ImplementPose = { id: bench.id, pos: [0, 0, ankle[2] + low[2] + BENCH_FOOT.overhang], rot: qid() }
    const front = plantFoot(skel, 'r', [-HALF_WIDTH, 0, ankle[2] + D], TOE_OUT)
    implements_.push(bench)
    contacts.push(...planted(skel, front))
    ctx = { ...base, front, frontMid: midOf(skel, front), rearHome: rear, rearFixed: rear, bench: { spec: bench, pose } }
  } else if (kind === 'reverse') {
    const front = plantFoot(skel, 'r', [-HALF_WIDTH, 0, 0.3], TOE_OUT)
    const frontMid = midOf(skel, front)
    contacts.push(...planted(skel, front))
    ctx = { ...base, front, frontMid, rearHome: plantFoot(skel, 'l', [HALF_WIDTH, 0, 0.3], TOE_OUT), rearBall: [HALF_WIDTH, 0, frontMid[2] - D] }
  } else if (kind === 'forward') {
    const rearHome = plantFoot(skel, 'l', [HALF_WIDTH, 0, -0.35], TOE_OUT)
    const rearBall = ballOf(skel, rearHome)
    const front = plantFoot(skel, 'r', [-HALF_WIDTH, 0, rearBall[2] + D], TOE_OUT)
    contacts.push(...planted(skel, rearHome, ['ball']))
    ctx = { ...base, front, frontMid: midOf(skel, front), frontHome: plantFoot(skel, 'r', [-HALF_WIDTH, 0, -0.35], TOE_OUT), rearHome, rearBall }
  } else {
    const top = PLATFORM[p.platformHeight]
    const spec = plyoBox({ height: top })
    const pose: ImplementPose = { id: spec.id, pos: [0, 0, 0.25], rot: qid() }
    const back = pose.pos[2] - PLYO_BOX.depth / 2
    // right heel a little in from the box's near edge, the left foot beside it at the top
    const heel = skel.data.sites.heel_r.local, mid = skel.data.sites.midfoot_r.local
    const front = plantFoot(skel, 'r', [-HALF_WIDTH, 0, back + 0.05 + (mid[2] - heel[2])], TOE_OUT, top)
    implements_.push(spec)
    contacts.push(...planted(skel, front))
    ctx = {
      ...base, front, frontMid: midOf(skel, front),
      rearHome: plantFoot(skel, 'l', [HALF_WIDTH, 0, front.ankle[2] + mid[2]], TOE_OUT, top),
      trail: plantFoot(skel, 'l', [HALF_WIDTH, 0, back - TRAIL_BEHIND], TOE_OUT),
      box: { spec, pose, back, top },
    }
  }
  ctx.setup = { implements: implements_, contacts, tempo, symmetric: false }
  // the rear foot on its ball: the toes lie flat (toe joint) but the collision model's forefoot capsule belongs to the
  // rigid foot and dips under the floor as the heel rises (lead decision, see REAR_FLOOR_TOL)
  if (kind === 'reverse' || kind === 'forward') ctx.setup.tolerances = { floor: REAR_FLOOR_TOL }
  if (kind === 'split') {
    ctx.setup.limits = { 'ankle_l.df': BENCH_ANKLE }
    // the foot's collision capsules are thicker than the forefoot: resting the skin on the pad sinks them into it
    ctx.setup.rests = [{ implement: 'split_bench', regions: ['foot_l'], tol: BENCH_FOOT_TOL }]
  }

  // hip heights: standing tall at the top; at the bottom the front knee reaches its cap or the rear knee its floor
  // clearance (step-up: the trailing leg reaches its spot behind the box with STEP_TRAIL_KNEE of bend)
  const hipWhere = (s: State, f: (q: Float64Array) => number, lo: number, hi: number, set: (y: number) => void) =>
    root1d((y) => {
      set(y)
      return f(solve(skel, ctx, s, feetAt(skel, ctx, s)))
    }, lo, hi, { tol: 1e-5, scan: 16 }).x
  const top: State = { depth: 0, swing: 0, weight: kind === 'split' ? 1 : 0, up: false }
  const bottom: State = { depth: 1, swing: 1, weight: 1, up: false }
  ctx.hipTop = hipWhere(top, (q) => kneeOf(skel, q, 'r') - TOP_KNEE, 0.6, 1.6, (y) => (ctx.hipTop = y))
  const atBottom = (f: (q: Float64Array) => number, lo: number) => hipWhere(bottom, f, lo, ctx.hipTop, (y) => (ctx.hipBottom = y))
  ctx.hipBottom = kind === 'step_up'
    ? atBottom((q) => kneeOf(skel, q, 'l') - STEP_TRAIL_KNEE, 0.6)
    : Math.max(atBottom((q) => kneeOf(skel, q, 'r') - FRONT_KNEE_MAX[kind], 0.3), atBottom((q) => rearKneeHeight(skel, q) - REAR_KNEE_CLEAR, 0.3))
  if (kind !== 'split') swings(skel, ctx, kind)
  return ctx
}

/** touch-down depth and lift-off progress for the moving leg's knee bend, then its swing curves between them */
function swings(skel: Skeleton, ctx: Ctx, kind: Moving) {
  const side: Side = kind === 'forward' ? 'r' : 'l'
  const knee = (s: State) => kneeOf(skel, solve(skel, ctx, s, feetAt(skel, ctx, s)), side)
  ctx.touch = root1d((t) => {
    ctx.touch = t
    return knee(downState(ctx, t, 1)) - TOUCH_KNEE[kind]
  }, 0.15, 0.97, { tol: 1e-6, scan: 24 }).x
  ctx.off = root1d((o) => knee(upState(ctx, o, 1)) - OFF_KNEE[kind], 0.02, 0.8, { tol: 1e-6, scan: 24 }).x

  const [ecc, pb, con, pt] = ctx.tempo
  const T = loopDuration(ctx.tempo)
  const eccAt = (d: number) => (pt / 2 + ecc * root1d((x) => minJerk(x) - d, 0, 1, { tol: 1e-10 }).x) / T
  const conAt = (p: number) => (pt / 2 + ecc + pb + con * p) / T
  const [leave, land] = HOME[kind]
  const at = { leave: leave > 0 ? eccAt(leave) : pt / 2 / T, touch: eccAt(ctx.touch), off: conAt(ctx.off), home: conAt(land) }
  // the moving leg's planted angles at u with the foot home (swing 0) or at its bottom spot (swing 1)
  const leg = (u: number, swing: 0 | 1) => {
    const ph = phaseAt(u, ctx.tempo)
    const s = ph.name === 'con' ? upState(ctx, ph.progress, swing) : downState(ctx, 1 - ph.c, swing)
    const q = solve(skel, ctx, s, feetAt(skel, ctx, s))
    return LEG_DOFS.map((k) => q[skel.dof[k.replace('*', side)]])
  }
  const h = 2e-4
  const end = (u: number, swing: 0 | 1) => {
    const [a, b, c] = [leg(u - h, swing), leg(u, swing), leg(u + h, swing)]
    return { p: b, v: b.map((_, i) => (c[i] - a[i]) / (2 * h)), a: b.map((x, i) => (c[i] - 2 * x + a[i]) / (h * h)) }
  }
  const curve = (u0: number, s0: 0 | 1, u1: number, s1: 0 | 1, bend: [number, number], early = false): Curve => {
    const e0 = end(u0, s0), e1 = end(u1, s1)
    return { u0, u1, p0: e0.p, v0: e0.v, a0: e0.a, p1: e1.p, v1: e1.v, a1: e1.a, bend, early }
  }
  ctx.down = curve(at.leave, 0, at.touch, 1, SWING_BEND[kind].down, kind === 'step_up')
  ctx.up = curve(at.off, 1, at.home, 0, SWING_BEND[kind].up, kind === 'step_up')
}

const contextOf = memo(context)

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = contextOf(p, skel)
  const q = poseFor(skel, ctx, stateAt(ctx, u))
  const implements_: ImplementPose[] = [...dumbbellPoses(skel, q)]
  if (ctx.bench) implements_.push(ctx.bench.pose)
  if (ctx.box) implements_.push(ctx.box.pose)
  return { q, implements: implements_, contacts: ctx.setup.contacts }
}

export const lunge: Template<P> = {
  id: 'lunge',
  driver: 'root',
  params: SCHEMAS.lunge,
  implemented: true,
  setup: (p, skel) => contextOf(p, skel).setup,
  sample,
}
