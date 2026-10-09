import { attachHand, jointByName, legKinematics, plantFoot, root1d, writeLeg, type FootTarget, type LegSolve } from '../constraints.ts'
import { bodyCapsules } from '../collide.ts'
import { centerOfMass, fk, localToWorld, segPos, sitePos } from '../fk.ts'
import { eulerAngles, limbRotation, twoBone } from '../ik.ts'
import { barbell, dumbbell, siteWorld, type ImplementSpec } from '../implements.ts'
import { splitBench } from '../implements/legs-knee.ts'
import { plyoBox, PLYO_BOX } from '../implements/shared.ts'
import { add, clamp, DEG, lerp, qaxis, qconj, qid, qmul, qrot, sub, type Quat, type V3 } from '../math.ts'
import { setDofs, setScapula, zeroQ, type Contact, type ImplementPose, type Pose, type Side, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, loopDuration, minJerk, phaseAt, type Tempo } from '../timing.ts'
import { dumbbellContacts, dumbbellPoses } from './arms.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { setPelvis } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'
import { kbGoblet, kbGobletArms, kbGobletPose } from './squat/holds.ts'
import { gobletArms, gobletDumbbell, gobletPose } from './squat.ts'

// Lunge family, root space: the hips are placed (height keyed by depth, fore-aft by balance: the centre of mass with
// the dumbbells goes where the feet share the weight) and the legs are solved to their feet. The right leg works: it
// stays planted in front (split squat, reverse lunge) or on the box (step-up), or steps out and back (forward lunge,
// the in-place form of the walking lunge). The foot that moves swings in joint space between its planted poses,
// matching their position, rate and acceleration, so lift-off and touch-down join without a jolt. The step-up is
// different: both feet stand on the box at the top, and the trailing foot follows a world-space path back over the
// box edge and down to the floor (and back up) while the centre of mass stays over the box foot, fore-aft and
// sideways; the weight moves onto the box foot before the trailing foot lifts and off it only after it lands. Ranges
// (motion-authoring research, lunge): front knee ~5 -> 90-100, rear knee -> 80-100, rear hip extended at the bottom.
// The front knee bends in the plane of its toes, the trunk stays within torsoAngle of upright, the dumbbells hang
// straight down.

type P = ParamsOf<'lunge'>
type Kind = 'split' | 'split_floor' | 'reverse' | 'forward' | 'step_up' | 'lateral' | 'curtsy' | 'cossack'
type Moving = Exclude<Kind, 'split' | 'split_floor' | 'lateral' | 'cossack'>
/** what is carried: dumbbells at the sides, nothing, a bar on the upper back (free or on the Smith rails), a
 * kettlebell held by the horns at the chest or a dumbbell held upright at the chest (goblet) */
type Load = 'db' | 'none' | 'barbell' | 'smith' | 'kb' | 'goblet'
/** the lunges whose moving foot swings in joint space */
type Stepping = Exclude<Moving, 'step_up'>
const KIND_LIST: Kind[] = ['split', 'split_floor', 'reverse', 'forward', 'step_up', 'lateral', 'curtsy', 'cossack']
/** the lunges played in place from a fixed stance (no foot moves) */
const IN_PLACE: Kind[] = ['split', 'split_floor', 'lateral', 'cossack']

const DB_KG = 16
/** goblet dumbbell, kg */
const GOBLET_KG = 20
const TOE_OUT = 6
/** feet this far from the midline (hip width apart), m */
const HALF_WIDTH = 0.125
/** step-up feet a little closer, under the hip joints: less of a sideways shift to get the weight over the box foot */
const STEP_HALF_WIDTH = 0.1
/** knees at the top: standing tall, not locked */
const TOP_KNEE = 3
/** front knee flexion cap at the bottom, deg (research 90-100; the split squat sinks a little deeper) */
const FRONT_KNEE_MAX: Record<Kind, number> = { split: 105, split_floor: 100, reverse: 100, forward: 100, step_up: 100, lateral: 95, curtsy: 100, cossack: 130 }
/** the rear kneecap stops this far above the floor, m */
const REAR_KNEE_CLEAR = 0.035
/** trailing leg at the bottom of the step-up, deg */
const STEP_TRAIL_KNEE = 20
/** share of the body weight on the back foot at the bottom (split squat: at the top and at the bottom) */
const REAR_SHARE: Record<Exclude<Kind, 'step_up'>, number> = { split: 0.3, split_floor: 0.35, reverse: 0.35, forward: 0.4, lateral: 0.15, curtsy: 0.35, cossack: 0 }
const SPLIT_TOP_SHARE = 0.12
/** floor split squat: share on the back foot at the top (the hips start between the feet and move over the front foot
 * as they drop), the rear heel lift at the top (deg; the bottom's is REAR_PITCH.bottom) and the least rear knee bend
 * standing tall in the split stance */
const FLOOR_SPLIT = { topShare: 0.5, pitch: 30, rearKnee: 6 }
/** bar on the upper back (the squat's high-bar site), 60 kg, grip as the back squat's */
const BAR = { plateKg: 20, grip: 2.1, wristBias: 10 }
/** body regions the bar rests on, where it may sink into the soft tissue a little (as the squat's high bar) */
const BAR_REST = ['trunk', 'girdle_l', 'girdle_r', 'neck', 'upperarm_l', 'upperarm_r']
const ARM_DOFS = ['clavicle_*.prot', 'clavicle_*.elev', 'scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev', 'grip_*.close']
/** front midfoot to rear ball (split squat: to the rear ankle) as a fraction of stepLength x leg length */
const STEP_SCALE: Record<Kind, number> = { split: 0.72, split_floor: 0.7, reverse: 0.84, forward: 0.84, step_up: 0, lateral: 0.55, curtsy: 0.7, cossack: 1 }
/** floor tolerance for a rear foot on its ball, mm: the rigid forefoot capsule sinks ~63 mm at REAR_PITCH.bottom */
const REAR_FLOOR_TOL = 65
/** the same for the step-up's trailing foot on its ball (heel up STEP.roll.off): ~33 mm (lead decision) */
const STEP_FLOOR_TOL = 35
/** reverse lunge rear foot on its ball: heel lift at touch-down and at the bottom, deg */
const REAR_PITCH = { land: 32, bottom: 58 }
/** knee bend of the moving leg at touch-down and at lift-off, deg: the setup solves when those happen */
const TOUCH_KNEE: Record<Moving, number> = { reverse: 65, forward: 60, step_up: 30, curtsy: 65 }
const OFF_KNEE: Record<Moving, number> = { reverse: 82, forward: 90, step_up: 41, curtsy: 90 }
/** the weight starts moving towards the back foot at this fraction of the touch-down depth (a controlled fall back) */
const WEIGHT_FROM: Record<Stepping, number> = { reverse: 0.2, forward: 1, curtsy: 0.2 }
/** way up: concentric progress by which the weight is off the back foot */
const UP_WEIGHT: Record<Stepping, number> = { reverse: 0.7, forward: 0.6, curtsy: 0.7 }
/** hip and knee bend added mid-swing, deg: on the way down and on the way up */
const SWING_BEND: Record<Stepping, { down: [number, number]; up: [number, number] }> = {
  reverse: { down: [15, 40], up: [20, 50] },
  forward: { down: [20, 55], up: [15, 50] },
  curtsy: { down: [5, 50], up: [20, 50] },
}
/** pelvis hinge (tilt with the spine held) at touch-down, deg; the step-up leans over the box foot all the way down */
const HINGE: Record<Kind, number> = { split: 0, split_floor: 0, reverse: 10, forward: 0, step_up: 26, lateral: 0, curtsy: 10, cossack: 0 }
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
/** step-up: the trailing foot's spot behind the box, m */
const TRAIL_BEHIND = 0.22
/**
 * step-up weight: share on the left foot (fore-aft and sideways between the midfeet) standing on the box and at the
 * bottom; depth at which the left foot leaves the box and concentric progress by which it is back on it (it touches
 * down and lifts off at TOUCH_KNEE / OFF_KNEE); while it is in the air the centre of mass sits this far inside the box
 * foot's centre line and this far behind its midfoot, m; the trailing foot touches down and lifts off on its ball with
 * the heel this far up, deg
 */
const STEP = { topShare: 0.15, bottomShare: 0.25, leave: 0.14, land: 0.9, inside: 0.035, back: 0.07, roll: { touch: 28, off: 30 } }
/** step-up swing up: fraction of the swing over which the foot rises to the box */
const RISE = 0.65
/**
 * step-up swing: sole clearance over the box edge (m), the most dorsiflexion mid-swing, where the foot hangs from the
 * shin instead of staying level (deg), and on the way up how far the heel draws back (m); the fraction of the swing
 * spent moving along (down: the first part, up: the last), the point after which the foot drops on the way down, and
 * how far it passes inside its planted line mid-swing (m)
 */
const STEP_PATH = { down: { clear: 0.08, ankle: 20 }, up: { clear: 0.1, ankle: 15, back: 0.06 }, first: 0.55, second: 0.4, inward: 0.08 }

/** the moving foot leaves home at this depth on the way down and is home by this concentric progress on the way up
 * (the hips start down and finish rising on both feet) */
const HOME: Record<Stepping, [number, number]> = { reverse: [0.06, 0.85], forward: [0.06, 0.95], curtsy: [0.06, 0.85] }
/**
 * Lateral lunge, in place from a wide stance (the step out is the setup): the hips sit back and over the right foot and
 * come back to centre, moving sideways as depth to the power `lag` (they drop before they shift, so the near straight
 * left leg keeps its foot); the left knee bends at most `straight` deg and both feet stay flat, the working foot turned
 * out `toeOut.work` and the trailing foot `toeOut.trail` deg (its tilt goes into the ankle; turned out, less of it is
 * eversion). Standing on one foot (curtsy swing) the centre of mass sits `inside` its midfoot, m. Curtsy: the left foot
 * lands on its ball behind and CURTSY_ACROSS across the right foot's line, m.
 */
const LATERAL = { inside: 0.03, straight: 6, toeOut: { work: 10, trail: 30 }, lag: 2 }
/**
 * Cossack squat, in place from a very wide stance (STEP_SCALE.cossack): the hips sink over the right foot, flat and
 * turned out `toeOut.work`, as deep as its heel stays down (ankle dorsiflexion `df`, capped by FRONT_KNEE_MAX.cossack),
 * shifting sideways exactly as far as keeps the left leg straight (knee LATERAL.straight); the centre of mass sits
 * `back` m behind the right midfoot, the trunk leans torsoAngle. The left foot, turned out `toeOut.trail`, rolls back
 * on its heel, toes up `lift` deg at the bottom. The arms reach forward for balance, `reach` deg from the trunk plus its
 * lean (just under level). The heel pivot sinks the rigid heel capsule up to ~20 mm into the floor at full lift, where
 * the real heel rolls (`floorTol`, mm, lead decision). Author judgment; one working-side rep per loop (3b alternating
 * precedent).
 * Depth (wave 3 retry): the straight left leg reaching its heel sets how low the hips can go, so the stance is a full
 * leg length plus hip width (STEP_SCALE.cossack 1, ~1.15 m heel to heel) and the pelvis lists `list` deg (left side up)
 * by the bottom, the spine bending `unlist` of it back. That keeps the left hip inside its 50 deg abduction (~44) and
 * reaches knee ~110 / hip ~93 with the right heel down (as deep as the bodyweight squat, 408); the left foot turned out
 * `toeOut.trail` keeps its ankle inside 30 deg inversion as it rolls (left hip external rotation ~36-44 of 45). A
 * heel-to-hip Cossack (knee ~140) needs hip abduction past 50 or ankle dorsiflexion past 40 on this skeleton.
 */
const COSSACK = { toeOut: { work: 30, trail: 50 }, lift: 45, floorTol: 25, df: 38, back: 0.06, list: 12, unlist: 0.75, reach: 78 }
/** goblet kettlebell reverse lunge: the back foot lifts off a little earlier, while the knee is still bent this far
 * (deg; with the upright goblet trunk the planted knee straightens faster through the rise) */
const KB_OFF_KNEE = 92
const CURTSY_ACROSS = 0.1
/** front-foot-elevated split squat: step height by platformHeight, m, and the step's footprint */
const FFE: Record<P['platformHeight'], number> = { low: 0.1, mid: 0.15, knee: 0.2 }
const FFE_BOX = { width: 0.4, depth: 0.36 }
/** front-foot-elevated split squat: the front knee bends deeper so the back knee drops past the step's height, deg */
const FFE_FRONT_KNEE = 122
/** quintic smoothstep on [0, 1], clamped */
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (10 - 15 * x + 6 * x * x))
/** how long the planted motion carries into a swing, in loop fraction (~0.15 s) */
const SWING_EASE = 0.04
/** the moving leg's DOFs, in swing curve order */
const LEG_DOFS = ['hip_*.flex', 'hip_*.abd', 'hip_*.rot', 'knee_*.flex', 'ankle_*.df', 'ankle_*.inv', 'toe_*.flex']

/** a swing: loop fraction span and the planted leg's angles, rates and accelerations (per unit u) at both ends */
type Curve = { u0: number; u1: number; p0: number[]; v0: number[]; a0: number[]; p1: number[]; v1: number[]; a1: number[]; bend: [number, number] }

type Ctx = {
  kind: Kind
  load: Load
  /** bar loads: the bar, its arm DOFs (solved once, constant: the bar rides on the thorax) and the Smith rail line */
  bar?: ImplementSpec
  barArms?: [number, number][]
  railZ?: number
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
  /** cossack squat: the left heel's spot, the pivot its toes lift about */
  rearHeel?: V3
  /** split squat: the rear foot on the bench */
  rearFixed?: FootTarget
  /** step-up: the left foot's spot on the floor behind the box */
  trail?: FootTarget
  box?: { spec: ImplementSpec; pose: ImplementPose; back: number; top: number }
  /** front-foot-elevated split squat: the step under the front foot */
  frontStep?: { spec: ImplementSpec; pose: ImplementPose }
  /** the load held at the chest (goblet kettlebell or dumbbell) */
  kb?: ImplementSpec
  bench?: { spec: ImplementSpec; pose: ImplementPose }
  hipTop: number
  /** step-up: hip height standing tall with the weight over the box foot (the pelvis shifted over it) */
  hipSide?: number
  hipBottom: number
  /** depth at which the moving foot touches down, and concentric progress where it leaves the floor */
  touch: number
  off: number
  down?: Curve
  up?: Curve
  /** step-up: loop fractions where the trailing foot leaves the box, touches down, bears most weight (the bottom),
   * lifts off and lands back on the box */
  step?: { leave: number; touch: number; mid: number; off: number; land: number }
}

/**
 * depth 0 (top) .. 1 (bottom); swing 0 (moving foot home) .. 1 (at its bottom spot); weight 0 (all on the standing
 * foot) .. 1 (the bottom's share on the back foot); u, while the moving foot is in the air
 */
type State = { depth: number; swing: number; weight: number; up: boolean; u?: number; rear?: number; roll?: number }

function loadOf(p: P): Load | null {
  if (p.implement === 'kettlebell') return p.hold === 'goblet' ? 'kb' : null
  if (p.implement === 'dumbbell') return p.hold === 'sides' ? 'db' : p.hold === 'goblet' ? 'goblet' : null
  // bodyweight: arms hanging (sides) or, on the cossack squat, reaching forward (hands)
  if (p.implement === 'bodyweight') return p.hold === 'sides' || (p.hold === 'hands' && p.direction === 'cossack') ? 'none' : null
  return p.hold === 'back_high' ? p.implement : null
}

function kindOf(p: P): Kind | string {
  const load = loadOf(p)
  if (!load) return `${p.implement} hold ${p.hold}`
  if (p.side !== 'right') return 'left working side'
  if (p.frontFootElevated && (p.direction !== 'in_place' || p.rearFootElevated || load !== 'db')) return `${p.implement} ${p.direction} with the front foot elevated`
  if (p.direction === 'in_place') {
    if (!p.rearFootElevated) return 'split_floor'
    return load === 'db' ? 'split' : `${p.implement} split squat with the rear foot elevated`
  }
  if (p.rearFootElevated) return `${p.direction} with the rear foot elevated`
  // a free bar on the back or a goblet kettlebell steps back; everything else that steps carries dumbbells
  if (p.direction === 'reverse' && (load === 'barbell' || load === 'kb')) return 'reverse'
  // the lateral lunge holds a dumbbell at the chest (at the sides it would hang into the working thigh); only it does
  if (p.direction === 'lateral') return load === 'goblet' ? 'lateral' : `lateral lunge ${p.implement} hold ${p.hold}`
  if (p.direction === 'cossack') return p.implement === 'bodyweight' && p.hold === 'hands' ? 'cossack' : `cossack squat ${p.implement} hold ${p.hold}`
  if (load === 'goblet') return `goblet dumbbell ${p.direction}`
  if (load !== 'db') return `${p.implement} ${p.direction}`
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
  if (IN_PLACE.includes(ctx.kind)) return { depth, swing: 0, weight: 1, up: false }
  if (ctx.kind === 'step_up') return stepState(ctx, u)
  const [leave, land] = HOME[ctx.kind as Stepping]
  const s = ph.name === 'con' ? upState(ctx, ph.progress, 1 - ramp(ph.progress, ctx.off, land)) : downState(ctx, depth, ramp(depth, leave, ctx.touch))
  return s.swing > 0 && s.swing < 1 ? { ...s, u } : s
}

function downState(ctx: Ctx, depth: number, swing: number): State {
  return { depth, swing, weight: ramp(depth, WEIGHT_FROM[ctx.kind as Stepping] * ctx.touch, 1), up: false }
}

function upState(ctx: Ctx, p: number, swing: number): State {
  return { depth: 1 - minJerk(p), swing, weight: 1 - ramp(p, 0, UP_WEIGHT[ctx.kind as Stepping]), up: true }
}

/**
 * Step-up: down, the weight moves onto the box foot, the left foot leaves the box at STEP.leave and touches down
 * behind it on its ball, takes its share of the weight as the heel lowers into the bottom pause, and gives it back as
 * the heel rises again; it lifts off once the weight is on the box foot, swings back onto the box by STEP.land and the
 * weight settles between the feet. `rear` is the share on the left foot, `roll` its heel lift on the floor.
 */
function stepState(ctx: Ctx, u: number): State {
  const ph = phaseAt(u, ctx.tempo)
  const depth = 1 - ph.c
  const m = ctx.step!
  const base = { depth, weight: 0, up: ph.name === 'con' }
  // back on the box, the weight settles between the feet through the rest of the rise and the top pause
  if (u >= m.land) return { ...base, swing: 0, rear: STEP.topShare * ramp(u, m.land, 1) }
  if (ph.name === 'top' || (ph.name === 'ecc' && u < m.leave)) return { ...base, swing: 0, rear: STEP.topShare * (1 - ramp(depth, 0, STEP.leave)) }
  if ((ph.name === 'ecc' && u < m.touch) || (ph.name === 'con' && u >= m.off)) return { ...base, swing: 0.5, rear: 0, u }
  if (u < m.mid) {
    const w = ramp(u, m.touch, m.mid)
    return { ...base, swing: 1, rear: STEP.bottomShare * w, roll: STEP.roll.touch * (1 - w) }
  }
  const w = 1 - ramp(u, m.mid, m.off)
  return { ...base, swing: 1, rear: STEP.bottomShare * w, roll: STEP.roll.off * (1 - w) }
}

/**
 * Step-up trailing foot in the air: down, it moves back past the box edge first and then drops to the floor; up, it
 * rises above the box first and then moves forward onto it. Minimum-jerk ends: still at lift-off and at touch-down.
 */
function stepFoot(skel: Skeleton, ctx: Ctx, s: State): { foot: FootTarget; toes: number; ankle: { w: number; df: number; reach: number } } {
  const m = ctx.step!
  const [u0, u1] = s.up ? [m.off, m.land] : [m.leave, m.touch]
  const t = clamp((s.u! - u0) / (u1 - u0), 0, 1)
  const roll = s.up ? STEP.roll.off : STEP.roll.touch
  const home = ctx.rearHome.ankle, trail = trailAt(skel, ctx, roll).ankle
  const { first, second } = STEP_PATH
  const { clear, ankle: df } = s.up ? STEP_PATH.up : STEP_PATH.down
  // along: 0 at the box spot, 1 at the floor spot; drop: 0 up on the box, 1 down on the floor
  const along = s.up ? 1 - smooth((t - 1 + first) / first) : smooth(t / first)
  const drop = s.up ? 1 - smooth(t / RISE) : smooth((t - second) / (1 - second))
  const lift = clear * (s.up ? smooth((1 - t) / 0.5) : smooth(t / 0.25)) * (1 - drop)
  const b = 64 * (t * (1 - t)) ** 3
  // the swinging foot passes under the body, which has shifted over the box foot, so the thigh clears the dumbbell
  const inward = STEP_PATH.inward * smooth(t / 0.3) * smooth((1 - t) / 0.3)
  // up: the heel draws back as the knee flexes, so the shin clears the box edge
  const tb = t / 0.6
  const back = s.up && tb < 1 ? STEP_PATH.up.back * 64 * (tb * (1 - tb)) ** 3 : 0
  const ankle: V3 = [lerp(home[0], trail[0], along) - inward, lerp(home[1], trail[1], drop) + lift, lerp(home[2], trail[2], along) - back]
  // the heel is up by `roll` at the floor end
  const heel = roll * (s.up ? 1 - smooth(t / 0.8) : smooth((t - 0.2) / 0.8))
  // the reach limit lets go by touch-down, where the target is within reach anyway
  const reach = smooth(t / 0.25) * smooth((1 - t) / 0.25)
  return { foot: { side: 'l', rot: qmul(ctx.rearHome.rot, qaxis([1, 0, 0], heel * DEG)), ankle }, toes: -heel, ankle: { w: b, df, reach } }
}

/** step-up trailing foot on the floor, on its ball with the heel `roll` deg up */
const trailAt = (skel: Skeleton, ctx: Ctx, roll: number) => (roll > 0 ? footOnBall(skel, 'l', ballOf(skel, ctx.trail!), roll, TOE_OUT) : ctx.trail!)

/**
 * Swing angles at u: a smoothstep from the start pose to the end pose, plus the planted motion at each end carried
 * in and out (its rate and acceleration, fading over SWING_EASE and gone by the far end), plus a hip and knee bend that is flat at both ends.
 * Position, rate and acceleration match the planted phases at lift-off and touch-down.
 */
function swingAt(c: Curve, u: number): number[] {
  const d = c.u1 - c.u0
  const s = clamp(u - c.u0, 0, d), e = d - s, t = s / d
  const step = t * t * t * (10 - 15 * t + 6 * t * t)
  const b = 64 * (t * (1 - t)) ** 3
  const k = SWING_EASE
  const fs = Math.exp(-s / k), fe = Math.exp(-e / k)
  return c.p0.map((x, i) => {
    const out = (c.v0[i] * s + ((c.a0[i] + (2 * c.v0[i]) / k) / 2) * s * s) * fs
    const into = (-c.v1[i] * e + ((c.a1[i] - (2 * c.v1[i]) / k) / 2) * e * e) * fe
    return x + (c.p1[i] - x) * step + out * (1 - step) + into * step + (i === 0 ? c.bend[0] * b : i === 3 ? c.bend[1] * b : 0)
  })
}

// ---------- body ----------

/** trunk lean from vertical (deg) shared by pelvis, lumbar and thorax; returns the pelvis tilt */
function trunk(skel: Skeleton, q: Float64Array, lean: number) {
  setDofs(skel, q, { 'lumbar.flex': 0.3 * lean, 'thorax.flex': 0.25 * lean, 'clavicle_*.prot': -4, 'clavicle_*.elev': 3, 'grip_*.close': 1 })
  return 0.45 * lean
}

function hinge(ctx: Ctx, d: number) {
  if (ctx.kind === 'split' || ctx.kind === 'split_floor') return 0
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

/**
 * Knee pole that keeps the bending knee over the foot's heel-toe line. Standing on one leg the hip sits outside the
 * foot, so a knee bending straight towards the toes would drift outside them (bow-legged); instead the thigh angles in
 * from the hip, as the mechanical axis does in a well-aligned single-leg squat. Falls back to the toes' direction when
 * the knee is too straight to steer.
 */
/** foot on its heel site at `heel`, toes lifted `lift` deg about it, turned out `yaw` deg */
function footOnHeel(skel: Skeleton, side: Side, heel: V3, lift: number, yaw: number): FootTarget {
  const rot = qmul(qaxis([0, 1, 0], (side === 'l' ? yaw : -yaw) * DEG), qaxis([1, 0, 0], -lift * DEG))
  return { side, rot, ankle: sub(heel, qrot(rot, skel.data.sites[`heel_${side}`].local)) }
}

/** foot on its ball at `ball`, heel lifted `pitch` deg, toes out `yaw` deg */
function footOnBall(skel: Skeleton, side: Side, ball: V3, pitch: number, yaw: number): FootTarget {
  const rot = qmul(qaxis([0, 1, 0], (side === 'l' ? yaw : -yaw) * DEG), qaxis([1, 0, 0], pitch * DEG))
  return { side, rot, ankle: sub(ball, qrot(rot, skel.data.sites[`ball_${side}`].local)) }
}

const ballOf = (skel: Skeleton, f: FootTarget) => add(f.ankle, qrot(f.rot, skel.data.sites[`ball_${f.side}`].local))
const midOf = (skel: Skeleton, f: FootTarget) => add(f.ankle, qrot(f.rot, skel.data.sites[`midfoot_${f.side}`].local))

/** both feet where they are planted (the moving foot at home or at its bottom spot), toes, and the balance target */
type Feet = { r: FootTarget; l: FootTarget; toes: { l: number; r: number }; poleL?: V3; comZ: number; comX?: number; shift: number; moving?: Side; ankleL?: { w: number; df: number; reach: number }; kneeL?: number }

function feetAt(skel: Skeleton, ctx: Ctx, s: State): Feet {
  const share = ctx.kind === 'step_up' ? 0 : REAR_SHARE[ctx.kind] * s.weight
  const air = Math.sin(Math.PI * s.swing) ** 2
  const landed = s.swing >= 0.5
  switch (ctx.kind) {
    case 'split': {
      const rear = ctx.rearFixed!
      // the hips sit back as they drop: more of the weight goes to the bench at the bottom
      const back = lerp(SPLIT_TOP_SHARE, REAR_SHARE.split, s.depth)
      return { r: ctx.front, l: rear, toes: { l: BENCH_FOOT.toes, r: 0 }, poleL: [0, 0, 1], comZ: ctx.frontMid[2] - back * (ctx.frontMid[2] - rear.ankle[2]), shift: 0 }
    }
    case 'split_floor': {
      // the rear foot stays on its ball, the heel lifting further as the rear knee drops
      const ball = ctx.rearBall!
      const pitch = lerp(FLOOR_SPLIT.pitch, REAR_PITCH.bottom, s.depth)
      const back = lerp(FLOOR_SPLIT.topShare, REAR_SHARE.split_floor, s.depth)
      return { r: ctx.front, l: footOnBall(skel, 'l', ball, pitch, TOE_OUT), toes: { l: -Math.min(58, pitch), r: 0 }, comZ: ctx.frontMid[2] - back * (ctx.frontMid[2] - ball[2]), shift: 0 }
    }
    case 'curtsy':
    case 'reverse': {
      const land = ctx.rearBall!
      const pitch = REAR_PITCH.land + (REAR_PITCH.bottom - REAR_PITCH.land) * s.weight
      const l = landed ? footOnBall(skel, 'l', land, pitch, TOE_OUT) : ctx.rearHome
      // over one foot the centre of mass sits towards its heel
      const over = ctx.frontMid[2] - 0.06 * (s.up ? minJerk(s.swing) : ramp(s.depth, 0, ctx.touch))
      const feet: Feet = { r: ctx.front, l, toes: { l: landed ? -Math.min(58, pitch) : 0, r: 0 }, comZ: over - share * (over - land[2]), shift: -SHIFT * air, moving: 'l' }
      // curtsy: the rear foot lands across behind the front one, so the hips move over towards both feet sideways
      if (ctx.kind === 'curtsy') {
        const over = ctx.frontMid[0] + LATERAL.inside
        const shifted = s.up ? 1 - minJerk(1 - Math.min(1, 2 * s.swing)) : minJerk(Math.min(1, 3 * s.swing))
        feet.comX = landed ? over + share * (land[0] - over) : lerp(0, over, shifted)
      }
      return feet
    }
    case 'lateral': {
      // both feet flat; the hips move over towards the right foot as they sit back and down
      const split = ctx.frontMid[0] + REAR_SHARE.lateral * (midOf(skel, ctx.rearHome)[0] - ctx.frontMid[0])
      return { r: ctx.front, l: ctx.rearHome, toes: { l: 0, r: 0 }, comZ: ctx.frontMid[2] - 0.01, comX: lerp(0, split, s.depth ** LATERAL.lag), shift: 0 }
    }
    case 'cossack': {
      // the right foot flat; the left foot rolls back on its heel, toes coming up as the hips sink over the right foot
      const l = footOnHeel(skel, 'l', ctx.rearHeel!, COSSACK.lift * ramp(s.depth, 0.15, 1), COSSACK.toeOut.trail)
      // the hips shift over as they drop, keeping the left leg straight
      return { r: ctx.front, l, toes: { l: 0, r: 0 }, poleL: qrot(ctx.rearHome.rot, [0, 0, 1]), comZ: ctx.frontMid[2] - COSSACK.back, kneeL: LATERAL.straight, shift: 0 }
    }
    case 'forward': {
      const ball = ctx.rearBall!
      const pitch = REAR_PITCH.bottom * ramp(s.depth, 0.05, 1)
      const split = ball[2] + (1 - REAR_SHARE.forward) * (ctx.frontMid[2] - ball[2])
      const comZ = lerp(midOf(skel, ctx.rearHome)[2], split, 1 - (1 - s.depth) ** 3)
      return { r: landed ? ctx.front : ctx.frontHome!, l: footOnBall(skel, 'l', ball, pitch, TOE_OUT), toes: { l: -Math.min(58, pitch), r: 0 }, comZ, shift: SHIFT * air, moving: 'r' }
    }
    case 'step_up': {
      // the centre of mass on the line between the midfeet at the left foot's share, over the box foot in the air
      const air = s.u !== undefined ? stepFoot(skel, ctx, s) : undefined
      const l = air ? air.foot : landed ? trailAt(skel, ctx, s.roll ?? 0) : ctx.rearHome
      const toes = air ? air.toes : landed ? -(s.roll ?? 0) : 0
      const w = s.rear ?? 0
      const r = ctx.frontMid, m = midOf(skel, l)
      return { r: ctx.front, l, toes: { l: toes, r: 0 }, comZ: lerp(r[2] - STEP.back, m[2], w), comX: lerp(r[0] + STEP.inside, m[0], w), shift: 0, ankleL: air?.ankle }
    }
  }
}

/** dumbbells as point loads at the grips, a free bar at its site on the back */
function loads(skel: Skeleton, ctx: Ctx, q: Float64Array) {
  const f = fk(skel, q)
  if (ctx.load === 'barbell') return [{ mass: ctx.bar!.mass, pos: barAt(skel, f) }]
  if (ctx.load === 'kb') return [{ mass: ctx.kb!.mass, pos: kbGobletPose(skel, f, ctx.kb!).pos }]
  if (ctx.load === 'goblet') return [{ mass: ctx.kb!.mass, pos: gobletPose(skel, f, ctx.kb!).pos }]
  if (ctx.load !== 'db') return []
  return (['l', 'r'] as const).map((s) => ({ mass: DB_KG, pos: sitePos(skel, f, `grip_${s}`) }))
}

/** bar centre on the upper back (the high-bar site in the thorax frame) */
const barAt = (skel: Skeleton, f: ReturnType<typeof fk>): V3 => localToWorld(skel, f, 'thorax2', skel.data.sites.back_high.local)

/** hands on a bar riding on the back: solved once standing and mirrored (as the back squat's high bar) */
function solveBarArms(skel: Skeleton, bar: ImplementSpec): [number, number][] {
  const q = zeroQ(skel)
  trunk(skel, q, 3)
  setPelvis(skel, q, [0, 0.95, 0], 1.35)
  const f = fk(skel, q)
  const thorax = f.rot[skel.seg.thorax2]
  const T = (x: number, y: number, z: number) => qrot(thorax, [x, y, z])
  const g = siteWorld(bar, { id: bar.id, pos: barAt(skel, f), rot: qid() }, 'l')
  attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm: T(0, 0.3, 1) }, { pole: T(0.4, -0.7, -0.6), wristBias: BAR.wristBias, planeHint: -90 })
  return ARM_DOFS.flatMap((k) => {
    const x = q[skel.dof[k.replace('*', 'l')]]
    return [[skel.dof[k.replace('*', 'l')], x], [skel.dof[k.replace('*', 'r')], x]] as [number, number][]
  })
}

/** the arms for the load: on the bar, or hanging (dumbbells; empty hands relaxed) */
function setArms(skel: Skeleton, ctx: Ctx, q: Float64Array) {
  if (ctx.barArms) for (const [i, x] of ctx.barArms) q[i] = x
  else if (ctx.load === 'kb') kbGobletArms(skel, q, ctx.kb!)
  else if (ctx.load === 'goblet') gobletArms(skel, q, ctx.kb!)
  else if (ctx.kind === 'cossack') {
    // arms reaching forward for balance, just under level whatever the trunk's lean
    const up = qrot(fk(skel, q).rot[skel.seg.thorax2], [0, 1, 0])
    const lean = Math.atan2(up[2], up[1]) / DEG
    setDofs(skel, q, { 'shoulder_*.plane': 90, 'shoulder_*.elev': COSSACK.reach + lean, 'elbow_*.flex': 8, 'forearm_*.pro': 40, 'grip_*.close': 0.2 })
    setScapula(skel, q, 'l')
    setScapula(skel, q, 'r')
  } else {
    hangArms(skel, q)
    if (ctx.load === 'none') setDofs(skel, q, { 'grip_*.close': 0.3 })
  }
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

/** knee bends where the step-up's swinging foot starts to be pulled in towards the hip, and the least it keeps, deg */
const REACH_KNEE = { soft: 25, min: 5 }

/** a foot in the air pulled in towards the hip, smoothly, so the leg never locks out reaching for it */
function withinReach(skel: Skeleton, hip: V3, foot: FootTarget, weight: number): FootTarget {
  const a = skel.segments[skel.seg[`femur_${foot.side}`]].length, b = skel.segments[skel.seg[`tibia_${foot.side}`]].length
  const reach = (knee: number) => Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(knee * DEG))
  const l0 = reach(REACH_KNEE.soft), w = reach(REACH_KNEE.min) - l0
  const v = sub(foot.ankle, hip), d = Math.hypot(...v)
  if (d <= l0) return foot
  const k = 1 + weight * ((l0 + w * Math.tanh((d - l0) / w)) / d - 1)
  return { ...foot, ankle: add(hip, [v[0] * k, v[1] * k, v[2] * k]) }
}

/** legs to their feet; a swinging leg (`air`, LEG_DOFS order) is set in joint space */
function placeLegs(skel: Skeleton, q: Float64Array, feet: Feet, air?: number[]) {
  const f = fk(skel, q)
  const rot = f.rot[skel.seg.pelvis]
  for (const s of ['l', 'r'] as const) {
    const set = air && feet.moving === s ? air : undefined
    if (set) {
      LEG_DOFS.forEach((k, i) => (q[skel.dof[k.replace('*', s)]] = set[i]))
      continue
    }
    const hip = f.pos[skel.seg[`femur_${s}`]]
    const foot = s === 'l' && feet.ankleL ? withinReach(skel, hip, feet.l, feet.ankleL.reach) : feet[s]
    writeLeg(skel, q, s, s === 'l' && feet.poleL ? legTowards(skel, s, hip, rot, feet.l, feet.poleL) : legKinematics(skel, s, hip, rot, foot))
    if (s === 'l' && feet.kneeL !== undefined) {
      // cossack: the ankle's two DOFs cannot quite turn the rolled foot as asked, so its heel lands off target; move the
      // ankle target by the miss until the heel is on its spot
      const heel = add(feet.l.ankle, qrot(feet.l.rot, skel.data.sites.heel_l.local))
      let target = feet.l
      for (let k = 0; k < 6; k++) {
        const miss = sub(heel, sitePos(skel, fk(skel, q), 'heel_l'))
        target = { ...target, ankle: add(target.ankle, miss) }
        writeLeg(skel, q, s, legTowards(skel, s, hip, rot, target, feet.poleL!))
      }
    }
    q[skel.dof[`toe_${s}.flex`]] = feet.toes[s]
    if (s === 'l' && feet.ankleL) {
      // mid-swing the foot hangs from the shin: dorsiflexion past the cap eases off (smoothly, softplus)
      const i = skel.dof['ankle_l.df'], k = 4
      q[i] -= feet.ankleL.w * k * Math.log1p(Math.exp((q[i] - feet.ankleL.df) / k))
    }
  }
}

/** the pose for a state: hips at the keyed height, moved fore and aft until the centre of mass sits at feet.comZ */
function solve(skel: Skeleton, ctx: Ctx, s: State, feet: Feet, air?: number[]): Float64Array {
  const q = zeroQ(skel)
  const top = ctx.hipSide === undefined ? ctx.hipTop : lerp(ctx.hipSide, ctx.hipTop, clamp((s.rear ?? 0) / STEP.topShare, 0, 1))
  const y = lerp(top, ctx.hipBottom, s.depth)
  const tilt = trunk(skel, q, 3 + (ctx.torso - 3) * s.depth) + hinge(ctx, s.depth)
  // cossack: the spine bends back against the pelvis's list, so the trunk leans only a little over the working leg
  if (ctx.kind === 'cossack') setDofs(skel, q, { 'lumbar.bend': COSSACK.unlist * 0.6 * COSSACK.list * s.depth, 'thorax.bend': COSSACK.unlist * 0.4 * COSSACK.list * s.depth })
  if (ctx.barArms) for (const [i, x] of ctx.barArms) q[i] = x
  else roughArms(skel, q)
  const place = (x: number, z: number) => {
    setPelvis(skel, q, [x, y, z], tilt, 0, ctx.kind === 'cossack' ? COSSACK.list * s.depth : 0)
    placeLegs(skel, q, feet, air)
  }
  const com = () => centerOfMass(skel, fk(skel, q), loads(skel, ctx, q))
  // the Smith rails carry the bar on a fixed line, so the hips go where the bar sits on it instead of balancing
  const measure = () => (ctx.railZ !== undefined ? barAt(skel, fk(skel, q))[2] - ctx.railZ : com()[2] - feet.comZ)
  const at = (x: number) => {
    const r = root1d((z) => {
      place(x, z)
      return measure()
    }, feet.comZ - 0.4, feet.comZ + 0.4, { tol: 1e-7 })
    place(x, r.x)
    return r.x
  }
  let x = feet.shift
  let z = at(x)
  // sideways (step-up): secant on the pelvis shift until the centre of mass is at comX
  const sideways = () => {
    let x0 = x, e0 = com()[0] - feet.comX!
    x = x0 - e0
    for (let i = 0; i < 6; i++) {
      z = at(x)
      const e = com()[0] - feet.comX!
      if (Math.abs(e) < 1e-6 || e === e0) break
      const next = x - (e * (x - x0)) / (e - e0)
      x0 = x
      e0 = e
      x = next
    }
    z = at(x)
  }
  if (feet.kneeL !== undefined) {
    // cossack: the hips move over the right foot as far as keeps the left knee at kneeL (the left leg straight)
    x = root1d((xx) => {
      z = at(xx)
      return kneeOf(skel, q, 'l') - feet.kneeL!
    }, 0.02, -0.7, { tol: 1e-7, scan: 36 }).x
    z = at(x)
  } else if (feet.comX !== undefined) {
    sideways()
    // the step-up leans far enough that the rough arms misplace the dumbbells: balance again with the arms hanging
    for (let i = 0; i < 2; i++) {
      hangArms(skel, q)
      z = at(x)
      sideways()
    }
  }
  place(x, z)
  setArms(skel, ctx, q)
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
  const load = loadOf(p)!
  const implements_: ImplementSpec[] = load === 'db' ? [dumbbell({ id: 'db_l', mass: DB_KG }), dumbbell({ id: 'db_r', mass: DB_KG })] : []
  const contacts: Contact[] = load === 'db' ? [...dumbbellContacts()] : []
  const bar = load === 'barbell' || load === 'smith' ? barbell({ gripWidth: BAR.grip * skel.data.shoulderWidth, plateKg: BAR.plateKg }) : undefined
  if (bar) {
    implements_.push(bar)
    contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: bar.id, grip: 'l' } }, { site: 'grip_r', kind: 'grip', target: { implement: bar.id, grip: 'r' } })
  }
  // a load held at the chest: a kettlebell by the horns, a dumbbell upright with the palms cupped under its top head
  const kb = load === 'kb' ? kbGoblet() : load === 'goblet' ? gobletDumbbell(GOBLET_KG) : undefined
  if (kb) {
    const [l, r] = load === 'kb' ? ['horn_l', 'horn_r'] : ['cup_l', 'cup_r']
    implements_.push(kb)
    contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: kb.id, grip: l } }, { site: 'grip_r', kind: 'grip', target: { implement: kb.id, grip: r } })
  }
  const base = { kind, load, bar, barArms: bar && solveBarArms(skel, bar), kb, tempo, torso: p.torsoAngle, setup: undefined as unknown as Setup, hipTop: 0, hipBottom: 0, touch: 0.6, off: 0.3 }
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
  } else if (kind === 'split_floor') {
    // long split stance on the floor: front foot flat, the rear foot on its ball behind (deficit: the front foot on a step)
    const h = p.frontFootElevated ? FFE[p.platformHeight] : 0
    const front = plantFoot(skel, 'r', [-HALF_WIDTH, 0, 0.3], TOE_OUT, h)
    const frontMid = midOf(skel, front)
    const rearBall: V3 = [HALF_WIDTH, 0, frontMid[2] - D]
    contacts.push(...planted(skel, front), { site: 'ball_l', kind: 'planted', target: { world: rearBall } })
    ctx = { ...base, front, frontMid, rearHome: footOnBall(skel, 'l', rearBall, FLOOR_SPLIT.pitch, TOE_OUT), rearBall }
    if (h > 0) {
      const spec = plyoBox({ id: 'step', height: h, width: FFE_BOX.width, depth: FFE_BOX.depth })
      implements_.push(spec)
      ctx.frontStep = { spec, pose: { id: 'step', pos: [frontMid[0], 0, frontMid[2]], rot: qid() } }
    }
  } else if (kind === 'reverse' || kind === 'curtsy') {
    const front = plantFoot(skel, 'r', [-HALF_WIDTH, 0, 0.3], TOE_OUT)
    const frontMid = midOf(skel, front)
    contacts.push(...planted(skel, front))
    // curtsy: the left foot lands behind and across the right foot's line
    const x = kind === 'curtsy' ? frontMid[0] - CURTSY_ACROSS : HALF_WIDTH
    ctx = { ...base, front, frontMid, rearHome: plantFoot(skel, 'l', [HALF_WIDTH, 0, 0.3], TOE_OUT), rearBall: [x, 0, frontMid[2] - D] }
  } else if (kind === 'lateral') {
    // wide stance, both feet flat and planted
    const half = HALF_WIDTH + D / 2
    const rearHome = plantFoot(skel, 'l', [half, 0, 0], LATERAL.toeOut.trail)
    const front = plantFoot(skel, 'r', [-half, 0, 0], LATERAL.toeOut.work)
    contacts.push(...planted(skel, rearHome), ...planted(skel, front))
    ctx = { ...base, front, frontMid: midOf(skel, front), rearHome }
  } else if (kind === 'cossack') {
    // very wide stance; the left heel stays put as its toes come up, so only the heel is planted
    const half = HALF_WIDTH + D / 2
    const rearHome = plantFoot(skel, 'l', [half, 0, 0], COSSACK.toeOut.trail)
    const front = plantFoot(skel, 'r', [-half, 0, 0], COSSACK.toeOut.work)
    contacts.push(...planted(skel, rearHome, ['heel']), ...planted(skel, front))
    ctx = { ...base, front, frontMid: midOf(skel, front), rearHome, rearHeel: add(rearHome.ankle, qrot(rearHome.rot, skel.data.sites.heel_l.local)) }
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
    const front = plantFoot(skel, 'r', [-STEP_HALF_WIDTH, 0, back + 0.05 + (mid[2] - heel[2])], TOE_OUT, top)
    implements_.push(spec)
    contacts.push(...planted(skel, front))
    ctx = {
      ...base, front, frontMid: midOf(skel, front),
      rearHome: plantFoot(skel, 'l', [STEP_HALF_WIDTH, 0, front.ankle[2] + mid[2]], TOE_OUT, top),
      trail: plantFoot(skel, 'l', [STEP_HALF_WIDTH, 0, back - TRAIL_BEHIND], TOE_OUT),
      box: { spec, pose, back, top },
    }
  }
  ctx.setup = { implements: implements_, contacts, tempo, symmetric: false }
  // the rear foot on its ball: the toes lie flat (toe joint) but the collision model's forefoot capsule belongs to the
  // rigid foot and dips under the floor as the heel rises (lead decision, see REAR_FLOOR_TOL)
  if (kind === 'reverse' || kind === 'forward' || kind === 'split_floor' || kind === 'curtsy') ctx.setup.tolerances = { floor: REAR_FLOOR_TOL }
  if (kb) ctx.setup.rests = [{ implement: kb.id, regions: ['trunk', 'hand_l', 'hand_r'], tol: 15 }]
  if (bar) ctx.setup.rests = [{ implement: bar.id, regions: BAR_REST, tol: 20 }]
  if (kind === 'step_up') ctx.setup.tolerances = { floor: STEP_FLOOR_TOL }
  if (kind === 'cossack') ctx.setup.tolerances = { floor: COSSACK.floorTol }
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
  const top: State = { depth: 0, swing: 0, weight: IN_PLACE.includes(kind) ? 1 : 0, up: false, rear: STEP.topShare }
  const bottom: State = { depth: 1, swing: 1, weight: 1, up: false, rear: STEP.bottomShare }
  const heights = () => {
    ctx.hipTop = hipWhere(top, (q) => kneeOf(skel, q, 'r') - TOP_KNEE, 0.6, 1.6, (y) => (ctx.hipTop = y))
    // floor split squat: standing tall is as far as the rear leg reaches with its ball planted
    if (kind === 'split_floor') {
      const tall = ctx.hipTop
      ctx.hipTop = Math.min(tall, hipWhere(top, (q) => kneeOf(skel, q, 'l') - FLOOR_SPLIT.rearKnee, tall - 0.3, tall, (y) => (ctx.hipTop = y)))
    }
    // step-up: standing tall too with the weight over the box foot, the pelvis shifted over it
    if (kind === 'step_up') ctx.hipSide = hipWhere({ ...top, rear: 0 }, (q) => kneeOf(skel, q, 'r') - TOP_KNEE, 0.6, 1.6, (y) => (ctx.hipSide = y))
    const atBottom = (f: (q: Float64Array) => number, lo: number) => hipWhere(bottom, f, lo, ctx.hipTop, (y) => (ctx.hipBottom = y))
    ctx.hipBottom = kind === 'step_up'
      ? atBottom((q) => kneeOf(skel, q, 'l') - STEP_TRAIL_KNEE, 0.6)
      : kind === 'lateral'
        // the trailing leg stays near straight with its foot flat
        ? Math.max(atBottom((q) => kneeOf(skel, q, 'r') - FRONT_KNEE_MAX.lateral, 0.3), atBottom((q) => kneeOf(skel, q, 'l') - LATERAL.straight, 0.3))
        : kind === 'cossack'
          // as deep as the right heel stays down (its ankle at COSSACK.df) or the knee cap; the left leg stays straight
          // (searched down from the top: far below, the straight left leg no longer reaches its heel)
          ? hipWhere(bottom, (q) => Math.max(q[skel.dof['ankle_r.df']] - COSSACK.df, kneeOf(skel, q, 'r') - FRONT_KNEE_MAX.cossack), ctx.hipTop, 0.3, (y) => (ctx.hipBottom = y))
        : Math.max(atBottom((q) => kneeOf(skel, q, 'r') - (ctx.frontStep ? FFE_FRONT_KNEE : FRONT_KNEE_MAX[kind]), 0.3), atBottom((q) => rearKneeHeight(skel, q) - REAR_KNEE_CLEAR, 0.3))
  }
  heights()
  if (load === 'smith') {
    // the rail line through the bar where both legs are long standing tall (front knee TOP_KNEE, rear knee
    // FLOOR_SPLIT.rearKnee), searched round where the balanced body puts the bar; the rails then hold the bar on that
    // line, so the hips drop straight down between the feet, and the hip heights are found again
    const tall: State = { depth: 0, swing: 0, weight: 1, up: false }
    const z0 = barAt(skel, fk(skel, solve(skel, ctx, tall, feetAt(skel, ctx, tall))))[2]
    const reach = (sd: 'l' | 'r', knee: number) => hipWhere(top, (q) => kneeOf(skel, q, sd) - knee, 0.6, 1.2, (y) => (ctx.hipTop = y))
    ctx.railZ = root1d((z) => {
      ctx.railZ = z
      return reach('r', TOP_KNEE) - reach('l', FLOOR_SPLIT.rearKnee)
    }, z0 - 0.12, z0 + 0.04, { tol: 1e-4, scan: 8 }).x
    implements_.push(smithFrame(ctx.railZ))
    heights()
  }
  if (kind === 'step_up') stepSwings(skel, ctx)
  else if (!IN_PLACE.includes(kind)) swings(skel, ctx, kind as Stepping)
  return ctx
}

/** step-up: the trailing foot touches down and lifts off behind the box on its ball with TOUCH_KNEE / OFF_KNEE of bend */
function stepSwings(skel: Skeleton, ctx: Ctx) {
  const knee = (s: State) => kneeOf(skel, solve(skel, ctx, s, feetAt(skel, ctx, s)), 'l')
  ctx.touch = root1d((t) => knee({ depth: t, swing: 1, weight: 0, up: false, rear: 0, roll: STEP.roll.touch }) - TOUCH_KNEE.step_up, STEP.leave + 0.02, 0.99, { tol: 1e-6, scan: 24 }).x
  ctx.off = root1d((p) => knee({ depth: 1 - minJerk(p), swing: 1, weight: 0, up: true, rear: 0, roll: STEP.roll.off }) - OFF_KNEE.step_up, 0.02, 0.5, { tol: 1e-6, scan: 24 }).x
  const [ecc, pb, con, pt] = ctx.tempo
  const T = loopDuration(ctx.tempo)
  const eccAt = (d: number) => (pt / 2 + ecc * root1d((x) => minJerk(x) - d, 0, 1, { tol: 1e-10 }).x) / T
  const conAt = (p: number) => (pt / 2 + ecc + pb + con * p) / T
  ctx.step = { leave: eccAt(STEP.leave), touch: eccAt(ctx.touch), mid: (pt / 2 + ecc) / T, off: conAt(ctx.off), land: conAt(STEP.land) }
}

/** touch-down depth and lift-off progress for the moving leg's knee bend, then its swing curves between them */
function swings(skel: Skeleton, ctx: Ctx, kind: Stepping) {
  const side: Side = kind === 'forward' ? 'r' : 'l'
  const knee = (s: State) => kneeOf(skel, solve(skel, ctx, s, feetAt(skel, ctx, s)), side)
  ctx.touch = root1d((t) => {
    ctx.touch = t
    return knee(downState(ctx, t, 1)) - TOUCH_KNEE[kind]
  }, 0.15, 0.97, { tol: 1e-6, scan: 24 }).x
  ctx.off = root1d((o) => knee(upState(ctx, o, 1)) - (ctx.load === 'kb' ? KB_OFF_KNEE : OFF_KNEE[kind]), 0.02, 0.8, { tol: 1e-6, scan: 24 }).x

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
  const curve = (u0: number, s0: 0 | 1, u1: number, s1: 0 | 1, bend: [number, number]): Curve => {
    const e0 = end(u0, s0), e1 = end(u1, s1)
    return { u0, u1, p0: e0.p, v0: e0.v, a0: e0.a, p1: e1.p, v1: e1.v, a1: e1.a, bend }
  }
  ctx.down = curve(at.leave, 0, at.touch, 1, SWING_BEND[kind].down)
  ctx.up = curve(at.off, 1, at.home, 0, SWING_BEND[kind].up)
}

/** Smith rails and top crossbar on the rail line (the composer draws the machine round the bar) */
function smithFrame(z: number): ImplementSpec {
  const cyl = (a: V3, b: V3, r: number) => ({ shape: 'cylinder' as const, a, b, r })
  return { id: 'smith', kind: 'bench', mass: 0, com: [0, 0, 0], parts: [cyl([0.6, 0, z], [0.6, 2.25, z], 0.025), cyl([-0.6, 0, z], [-0.6, 2.25, z], 0.025), cyl([-0.6, 2.25, z], [0.6, 2.25, z], 0.03)], sites: {} }
}

const contextOf = memo(context)

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = contextOf(p, skel)
  const q = poseFor(skel, ctx, stateAt(ctx, u))
  const implements_: ImplementPose[] = ctx.load === 'db' ? [...dumbbellPoses(skel, q)] : []
  if (ctx.kb) implements_.push((ctx.load === 'kb' ? kbGobletPose : gobletPose)(skel, fk(skel, q), ctx.kb))
  if (ctx.frontStep) implements_.push(ctx.frontStep.pose)
  if (ctx.bar) implements_.push({ id: ctx.bar.id, pos: barAt(skel, fk(skel, q)), rot: qid() })
  if (ctx.railZ !== undefined) implements_.push({ id: 'smith', pos: [0, 0, 0], rot: qid() })
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
