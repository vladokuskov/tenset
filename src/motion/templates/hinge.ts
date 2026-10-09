import { attachHand, handFrame, implementFromHand, legKinematics, plantFoot, root1d, writeLeg, type FootTarget } from '../constraints.ts'
import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts, type Capsule } from '../collide.ts'
import { centerOfPressure, fk, localToWorld, type FK } from '../fk.ts'
import { dls } from '../ik.ts'
import { barbell, cableForce, cableHandle, dumbbell, PLATE_20_RADIUS, siteWorld, type ImplementSpec, type Part } from '../implements.ts'
import { rack } from '../implements/back.ts'
import { kettlebell, kettlebellDims } from '../implements/free-weights.ts'
import { floorSpot } from '../implements/hinge.ts'
import { add, clamp, DEG, lerp, norm, qaxis, qconj, qfromBasis, qid, qmul, qrot, reject, scale, sub, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Side, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, minJerk, phaseAt, type Tempo } from '../timing.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { monotoneCubic } from './solve.ts'
import { hipMidLocal, makeStance, plantedContacts, setPelvis, stanceWidth, stand, type StanceName, type StanceSetup } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Hinge. Hip and knee flexion are keyed; each frame the pelvis tilt follows from them, the ankles are solved so the
// bar sits over the midfoot (dumbbells, single leg and cable: the centre of pressure of body + load), and the arms
// hang straight from the shoulders at the angle that lays the load on the front of the legs (the lats pull the bar
// in), or towards the low pulley for the pull-through. Spine neutral within a few degrees; lockout at hip and knee
// ~0 with the body leaning as one line.
// Research (motion-authoring): RDL knees held ~15-25 deg, hip flexion 0 -> ~70-90 [C]; conventional deadlift stance
// 32 cm, toe-out 14, grip 55 cm (Escamilla 2000); lockout with no hyperextension beyond ~5 deg.

type P = ParamsOf<'hinge'>
type Kind = 'bar' | 'db' | 'single' | 'cable' | 'kb' | 'back'

export const TOP_KNEE = 3
export const TOP_HIP = 2
/** hip flexion at the bottom of a hang-start rep, deg (RDL ~70-90; the single leg reaches about horizontal) */
export const BOTTOM_HIP: Record<Kind, number> = { bar: 82, db: 82, single: 86, cable: 74, kb: 82, back: 80 }
/** neutral spine: lumbar and thoracic flexion at the bottom, deg (inside the 10 deg band) */
export const SPINE = { lumbar: 5, thorax: 6 }
/** bar and dumbbells slide down the front of the legs: capsule clearance, m */
export const ON_LEGS = 0.004
/** the fists round the bar may press this far into the thighs (inside the 8 mm hand-thigh tolerance), m */
const HANDS_ON_THIGHS = -0.004
const HAND_R = 0.04
/** elbows just short of straight: the reach the arm model uses (the IK then bends them a few degrees) */
const ARM_ELBOW = 7
const BAR_PLATES = 20
const FLOOR_PLATES = 40
const DB_KG = 18
const SINGLE_DB_KG = 16
/** dumbbells in front of the thighs, hands about shoulder width: grip centres this far from the midline, m */
const DB_X = 0.22
/** conventional pull: knees soft (deg) while the bar passes them (eccentric progress); shoulders over the bar at the
 * floor. Hips hinge evenly, the knees bend on a power curve through that point, so the hips lead and nothing jerks */
const FLOOR_SOFT_KNEE = 14
const FLOOR_KNEE_AT = 0.6
/** a floor start with kneeAngle at or below this (the schema default 20 is the conventional pull's) pulls stiff-legged */
const STIFF_KNEE_MAX = 18
/**
 * Plates on the floor put the hips at ~120 deg flexion for this figure (liftoff ~110-120, Escamilla 2000): the thigh
 * presses the belly and lower ribs (34 mm into the ribs' capsule, 70 mm into the belly's) and the knees push out into
 * the straight arms (17 mm). Soft tissue, lead decision; the deep squat has the same kind of allowance for the belly.
 */
const FLOOR_START_TOL = {
  'thigh_l / trunk': 36, 'thigh_r / trunk': 36, 'thigh_l / trunk (lumbar3)': 72, 'thigh_r / trunk (lumbar3)': 72,
  'forearm_l / thigh_l': 20, 'forearm_r / thigh_r': 20, 'forearm_l / shank_l': 16, 'forearm_r / shank_r': 16,
}
/**
 * Sumo (wide floor pull): the grip sits inside the knees and so inside the shoulders, and at lockout the hanging upper
 * arms press ~15 mm into the sides of the chest (lats; soft tissue, lead decision). At the floor the straight arms hang
 * between the thighs and the triceps press ~27 mm into the inner thighs' thick capsules (soft tissue on soft tissue,
 * lead decision; a narrower grip moves it only a few mm)
 */
const SUMO_TOL = { 'trunk / upperarm_l': 16, 'trunk / upperarm_r': 16, 'thigh_l / upperarm_l': 28, 'thigh_r / upperarm_r': 28 }
/**
 * Sumo: feet wide (stance `width` x shoulder width; wider needs the ankles past their limit to balance standing),
 * knees out over the toes reaching `knee` deg at the floor with the hips low and the trunk ~45-50 deg from vertical;
 * knees and hips bend together (the knees a little behind, `lag` of a quadratic on eccentric progress) instead of the
 * conventional hips-first schedule
 */
const SUMO = { width: 1.65, knee: 92, lag: 0.5 }
/**
 * floor start: shoulders a few cm ahead of the bar (straight-arm angle, deg) with the bar against the shins. Resting
 * the arms on the legs instead stopped the knees short of the bar (the forearms met the thighs first), which left the
 * shins vertical and the hips level with the shoulders, a stiff-leg start
 */
export const FLOOR_ARM = 3
/** pull-through: low pulley behind the heels, stack load, how far the arms follow the cable towards it */
export const PULLEY_BACK = 0.7
const PULLEY_Y = 0.1
const CABLE_KG = 18
const CABLE_FOLLOW = 0.6
/** rope ends: the fists side by side in front of the groin, the strands running back between the legs */
const ROPE = { x: 0.1, y: 0.33 }
/** the straight rope arms as capsules along the shoulder-grip line (fraction of the line, radius m): upper arm below
 * the armpit, forearm, fist round the grip. They keep off the thighs and rest on the chest and belly, pressing in at
 * most this far (m, inside the 10-20 mm soft-tissue tolerances) */
const ROPE_ARM: [number, number, number, number][] = [[0.25, 0.46, 0.054, -0.006], [0.46, 0.84, 0.044, -0.004], [0.84, 1.05, 0.058, -0.004]]
/**
 * the same for two hands on a kettlebell handle: the hands meet at the midline, so the straight arms converge across
 * the front of the chest and belly; they press in up to these depths (m) so the bell hangs near the thighs instead of
 * out in front. The upper arms then press ~25 mm into the sides of the chest (lats; soft tissue, lead decision, as the
 * sumo grip's 16 mm)
 */
const KB_TOL = { 'trunk / upperarm_l': 26, 'trunk / upperarm_r': 26, 'trunk / upperarm_l (thorax2)': 26, 'trunk / upperarm_r (thorax2)': 26 }
const KB_ARM: [number, number, number, number][] = [[0.25, 0.46, 0.054, -0.02], [0.46, 0.84, 0.044, -0.03], [0.84, 1.05, 0.058, -0.03]]
/** single leg: stance foot this far off the midline; free leg bent behind at the top, then in line with the trunk */
const SINGLE_FOOT_X = 0.07
const FREE_TOP = { hip: -12, knee: 45, df: 5 }
const FREE_BOTTOM = { knee: 6, df: 18 }
/** the free leg swings just clear of the stance leg (which slants in under the body) */
const FREE_ABD = 8
const SINGLE_ARM = -2
/** the dumbbell hangs almost straight below its shoulder, the hand this far in towards the midline, m */
const SINGLE_IN = 0.01
/** kettlebells (kg): two hands on the handle in front of the thighs, between the feet for the sumo pull, one hand on
 * the single leg. The single-leg bell hangs further in, so it runs down the inside of the stance shin, m. Two hands
 * on the handle: shoulders protracted (deg) so the converging arms pass in front of the chest. Sumo: the knees stay
 * soft at the top (deg; the wide, nearly straight legs cannot lean the body forward over a bell held in front) */
export const KB = { rdl: 20, sumo: 24, single: 16, singleIn: 0.02, prot: 20, sumoTopKnee: 8 }
/** good morning: bar on the upper back (high-bar site), elbows down and back as in the high-bar squat */
const BACK_BAR = { wristBias: 10 }
const BACK_BAR_REST = ['trunk', 'girdle_l', 'girdle_r', 'neck', 'upperarm_l', 'upperarm_r']
const BACK_ARM_DOFS = ['clavicle_*.prot', 'clavicle_*.elev', 'scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev', 'grip_*.close']
/**
 * rack pull: the bar rests on the spotter arms this far below the knee joints (m), the rack's front uprights this far
 * in front of the bar (the arms reach back towards the lifter, who faces the rack)
 */
export const PINS = { below: 0.03, rack: 0.45, hooks: 1.4 }
/**
 * B-stance (kickstand): the front foot this far off the midline, the back foot's ball at `backX`, `behind` the front
 * heel (any closer and its bent knee sticks out past the front thigh), its heel lifted `pitch` deg, toes flat
 */
export const SPLIT = { x: 0.08, backX: 0.1, behind: 0.06, pitch: 32, floorTol: 40 }

type Ctx = {
  kind: Kind
  tempo: Tempo
  setup: Setup
  /** planted feet (single leg: the stance foot only) */
  feet: FootTarget[]
  stance: StanceSetup
  /** single leg: stance side */
  side: Side
  gripX: number
  reach: number
  palm: (side: Side) => V3
  kneeAt: (s: number) => number
  hipAt: (s: number) => number
  /** single leg: pelvis shift over the stance foot at the top and the bottom */
  tx: [number, number]
  load?: ImplementSpec
  dbs?: ImplementSpec[]
  pulley?: V3
  /** bar height with the plates on the floor */
  floorY?: number
  /** floor pull: straight-arm angle by eccentric progress, the resting-on-the-legs solve with the knee bump smoothed out */
  phiAt?: (s: number) => number
  /** floor pull: how far (0-1, by eccentric progress) the arms are held at FLOOR_ARM or more instead of resting on the legs */
  armFloor?: (s: number) => number
  /** kettlebell: both hands on its handle (kind kb), or the single-leg load (then also dbs[0]) */
  bell?: ImplementSpec
  /** single leg: the loaded hand this far in from its shoulder, m */
  inward: number
  /** good morning: arm DOFs holding the bar on the back (relative to the thorax, so constant through the rep) */
  barArms?: [number, number][]
  /** B-stance: the back foot on its ball (feet[0] is the front, stance foot) */
  back?: FootTarget
  /** rack pull: the rack whose spotter arms the bar starts on */
  rack?: ImplementPose
  /** sumo kettlebell: the straight arms hold the bell over the midfoot (it stands between the heels at the bottom) */
  overMid?: boolean
}

type Grips = { l: V3; r: V3; phi: number }

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })
const ramp = (x: number) => minJerk(clamp(x, 0, 1))
const other = (s: Side): Side => (s === 'l' ? 'r' : 'l')

function kindOf(p: P): Kind | string {
  const sumoKb = p.implement === 'kettlebell' && p.hold === 'hands' && p.stance === 'wide'
  if (p.start === 'floor' && p.implement !== 'barbell' && !sumoKb) return `floor start with ${p.implement}`
  if (p.start === 'pins' && !(p.implement === 'barbell' && p.hold === 'hands' && p.stance !== 'single_leg' && p.stance !== 'split')) return `pins start with ${p.implement} ${p.hold} / ${p.stance}`
  if (p.implement === 'barbell') {
    if (p.hold === 'back_high') return p.start === 'hang' && p.stance !== 'single_leg' && p.stance !== 'split' ? 'back' : `good morning ${p.start} / ${p.stance}`
    return p.hold === 'hands' && p.stance !== 'single_leg' && p.stance !== 'split' ? 'bar' : `barbell hold ${p.hold} / ${p.stance}`
  }
  if (p.implement === 'dumbbell') {
    if (p.stance === 'single_leg') return p.hold === 'opposite_hand' ? 'single' : `single-leg dumbbell hold ${p.hold}`
    return p.hold === 'front_of_thighs' ? 'db' : `dumbbell hold ${p.hold}`
  }
  if (p.implement === 'kettlebell') {
    if (p.stance === 'single_leg') return p.hold === 'opposite_hand' ? 'single' : `single-leg kettlebell hold ${p.hold}`
    return p.hold === 'hands' && p.stance !== 'split' ? 'kb' : `kettlebell hold ${p.hold} / ${p.stance}`
  }
  if (p.implement === 'cable') return p.attachment === 'rope' && p.cableHeight === 'low' && p.stance !== 'single_leg' && p.stance !== 'split' ? 'cable' : `cable ${p.attachment ?? 'no attachment'} / ${p.cableHeight}`
  return `implement ${p.implement}`
}

/** one planted stance foot carries the balance: single leg, and the B-stance's front foot */
const oneFoot = (ctx: Ctx) => ctx.kind === 'single' || !!ctx.back

/** kettlebell centre for a grip point on its handle (hanging: handle straight up) */
const bellAt = (ctx: Ctx, grip: V3): V3 => sub(grip, [0, ctx.bell!.sites.handle.pos[1], 0])

// ---------- body ----------

/** spine, shoulder girdle, grip closure and (single leg) the free leg for eccentric progress s */
function posture(skel: Skeleton, q: Float64Array, ctx: Ctx, s: number) {
  const lumbar = SPINE.lumbar * s, thorax = SPINE.thorax * s
  setDofs(skel, q, { 'lumbar.flex': lumbar, 'thorax.flex': thorax, 'clavicle_*.prot': ctx.kind === 'kb' ? KB.prot : ctx.kind === 'cable' ? 16 * (1 - s) : -4, 'clavicle_*.elev': -3, 'grip_*.close': 1 })
  if (ctx.kind !== 'single') return
  const free = other(ctx.side)
  setDofs(skel, q, {
    [`hip_${free}.flex`]: lerp(FREE_TOP.hip, -(lumbar + thorax), ramp(s / 0.7)),
    [`hip_${free}.abd`]: FREE_ABD,
    [`hip_${free}.rot`]: 0,
    [`knee_${free}.flex`]: lerp(FREE_TOP.knee, FREE_BOTTOM.knee, ramp(s / 0.8)),
    [`ankle_${free}.df`]: lerp(FREE_TOP.df, FREE_BOTTOM.df, s),
    [`grip_${ctx.side}.close`]: 0.25,
  })
}

/** neutral neck: the head stays nearly in line with the trunk, eyes a little ahead */
function gaze(skel: Skeleton, q: Float64Array) {
  const d = skel.dof
  const pitch = q[d['pelvis.tilt']] + q[d['lumbar.flex']] + q[d['thorax.flex']]
  setDofs(skel, q, { 'neck.flex': -0.14 * pitch, 'head.flex': -0.08 * pitch })
}

/** hip midpoint (x = tx) whose leg on `foot` reaches it with the given knee flexion and ankle dorsiflexion */
function hipsFor(skel: Skeleton, foot: FootTarget, knee: number, df: number, tilt: number, tx: number): V3 {
  const pelvisRot = qaxis([1, 0, 0], tilt * DEG)
  const off = qrot(pelvisRot, sub(skel.segments[skel.seg[`femur_${foot.side}`]].offset, hipMidLocal(skel)))
  const lt = skel.segments[skel.seg.femur_l].length, ls = skel.segments[skel.seg.tibia_l].length
  const a = df * DEG, k = knee * DEG
  // planar guess, then the height that makes the hip-ankle distance match the knee angle across the stance width
  const z = foot.ankle[2] + ls * Math.sin(a) - lt * Math.sin(k - a)
  const reach = Math.sqrt(lt * lt + ls * ls + 2 * lt * ls * Math.cos(k))
  const dx = tx + off[0] - foot.ankle[0], dz = z - foot.ankle[2]
  const y = foot.ankle[1] + Math.sqrt(Math.max(0.01, reach * reach - dx * dx - dz * dz))
  const res = (x: number[]) => {
    const leg = legKinematics(skel, foot.side, add([tx, x[0], x[1]], off), pelvisRot, foot)
    return [(leg.knee - knee) * DEG, (leg.ankle[0] - df) * DEG]
  }
  const s = dls(res, [y - off[1], z - off[2]], { tol: 1e-10, iters: 40 })
  return [tx, s.x[0], s.x[1]]
}

function place(skel: Skeleton, q: Float64Array, ctx: Ctx, knee: number, df: number, tilt: number, tx: number) {
  if (!oneFoot(ctx)) return stand(skel, q, ctx.stance, { knee, df, tilt })
  const foot = ctx.feet[0]
  setPelvis(skel, q, hipsFor(skel, foot, knee, df, tilt, tx), tilt)
  const f = fk(skel, q)
  writeLeg(skel, q, foot.side, legKinematics(skel, foot.side, f.pos[skel.seg[`femur_${foot.side}`]], f.rot[skel.seg.pelvis], foot))
  if (!ctx.back) return
  // B-stance: the back leg reaches its foot on the ball, the toes flat on the floor
  const b = ctx.back
  writeLeg(skel, q, b.side, legKinematics(skel, b.side, f.pos[skel.seg[`femur_${b.side}`]], f.rot[skel.seg.pelvis], b))
  setDofs(skel, q, { [`toe_${b.side}.flex`]: -SPLIT.pitch })
}

/** legs for knee flexion and ankle dorsiflexion, with the pelvis tilted so the (stance) hip sits at `hip` flexion */
function placeHip(skel: Skeleton, q: Float64Array, ctx: Ctx, knee: number, df: number, hip: number, tx: number) {
  const i = skel.dof[`hip_${oneFoot(ctx) ? ctx.side : 'l'}.flex`]
  let tilt = hip - knee + df
  for (let k = 0; k < 4; k++) {
    place(skel, q, ctx, knee, df, tilt, tx)
    const e = hip - q[i]
    if (Math.abs(e) < 1e-6) break
    tilt += e
  }
}

// ---------- hands and load ----------

const LEGS = /^(thigh|shank)_/

/** grip targets for a straight-arm angle phi (deg, + = hands behind the shoulders) in the sagittal plane */
function gripsAt(skel: Skeleton, f: FK, ctx: Ctx, phi: number): Grips {
  const at = (side: Side, x: number): V3 => {
    const gh = f.pos[skel.seg[`humerus_${side}`]]
    const rv = Math.sqrt(Math.max(0.01, ctx.reach * ctx.reach - (x - gh[0]) ** 2))
    return [x, gh[1] - rv * Math.cos(phi * DEG), gh[2] - rv * Math.sin(phi * DEG)]
  }
  if (ctx.kind === 'single') {
    // the dumbbell hangs just inside its shoulder, the free hand straight below its own
    const loaded = other(ctx.side)
    const x = f.pos[skel.seg[`humerus_${loaded}`]][0] - (loaded === 'l' ? ctx.inward : -ctx.inward)
    return loaded === 'l' ? { l: at('l', x), r: at('r', f.pos[skel.seg.humerus_r][0]), phi } : { l: at('l', f.pos[skel.seg.humerus_l][0]), r: at('r', x), phi }
  }
  if (ctx.back) {
    // B-stance: the hips shift over the front foot, the hands stay either side of the body's midline
    const mid = (f.pos[skel.seg.humerus_l][0] + f.pos[skel.seg.humerus_r][0]) / 2
    return { l: at('l', mid + ctx.gripX), r: at('r', mid - ctx.gripX), phi }
  }
  const l = at('l', ctx.gripX)
  return { l, r: [-l[0], l[1], l[2]], phi }
}

function barPose(ctx: Ctx, g: Grips): ImplementPose {
  return { id: ctx.load!.id, pos: [0, (g.l[1] + g.r[1]) / 2, (g.l[2] + g.r[2]) / 2], rot: qid() }
}

/** two hands on the kettlebell's handle, the bell hanging below */
function kbPose(ctx: Ctx, g: Grips): ImplementPose {
  return { id: ctx.bell!.id, pos: bellAt(ctx, [0, (g.l[1] + g.r[1]) / 2, (g.l[2] + g.r[2]) / 2]), rot: qid() }
}

/** good morning: the bar on the high-bar site of the upper back, the grips on it */
function backGrips(skel: Skeleton, f: FK, ctx: Ctx): Grips {
  const c = localToWorld(skel, f, 'thorax2', skel.data.sites.back_high.local)
  const pose: ImplementPose = { id: ctx.load!.id, pos: c, rot: qid() }
  return { l: siteWorld(ctx.load!, pose, 'l').pos, r: siteWorld(ctx.load!, pose, 'r').pos, phi: 0 }
}

/** rope: the carabiner towards the pulley from the hands, the ends in the hands */
function ropePose(ctx: Ctx, g: Grips): ImplementPose {
  const mid: V3 = [0, (g.l[1] + g.r[1]) / 2, (g.l[2] + g.r[2]) / 2]
  const rot = qfromBasis([1, 0, 0], norm(sub(ctx.pulley!, mid)))
  const site = ctx.load!.sites.l.pos
  return { id: ctx.load!.id, pos: sub(mid, qrot(rot, [0, site[1], site[2]])), rot }
}

/** smooth minimum (length scale SOFT): the contact point slides from thigh to knee to shin without kinks */
const SOFT = 0.004
function softMin(ds: number[]): number {
  const m = Math.min(...ds)
  let sum = 0
  for (const d of ds) sum += Math.exp(-(d - m) / SOFT)
  return m - SOFT * Math.log(sum)
}

const clears = (a: Pick<Capsule, 'a' | 'b' | 'r'>, set: Capsule[], off = 0) => set.map((c) => capsuleClearance(c, a) - off)

/** how far the load and hands are from resting on the legs (0 = resting), m */
function contact(skel: Skeleton, f: FK, caps: Capsule[], ctx: Ctx, g: Grips): number {
  const legs = caps.filter((c) => LEGS.test(c.region))
  const ds: number[] = []
  if (ctx.kind === 'bar') {
    const bar = barPose(ctx, g).pos
    ds.push(...clears({ a: [-0.655, bar[1], bar[2]], b: [0.655, bar[1], bar[2]], r: 0.014 }, legs, ON_LEGS))
    for (const side of ['l', 'r'] as const) {
      const gh = f.pos[skel.seg[`humerus_${side}`]]
      ds.push(...clears({ a: add(gh, scale(sub(g[side], gh), 0.5)), b: g[side], r: HAND_R }, legs, HANDS_ON_THIGHS))
    }
    return softMin(ds)
  }
  if (ctx.kind === 'db' || ctx.kind === 'single') {
    const pts = ctx.kind === 'db' ? [g.l, g.r] : [g[other(ctx.side)]]
    for (const p of pts) for (const sd of placeParts(ctx.dbs![0], { id: 'db', pos: ctx.bell ? bellAt(ctx, p) : p, rot: qid() })) for (const c of legs) ds.push(capsuleSolidClearance(c, sd) - ON_LEGS)
    return softMin(ds)
  }
  if (ctx.kind === 'kb') {
    for (const sd of placeParts(ctx.bell!, kbPose(ctx, g))) for (const c of legs) ds.push(capsuleSolidClearance(c, sd) - ON_LEGS)
    // the straight arms converge on the handle in front of the belly, as the rope's
    const trunk = caps.filter((c) => c.region === 'trunk')
    const thighs = caps.filter((c) => c.region.startsWith('thigh_'))
    for (const side of ['l', 'r'] as const) {
      const gh = f.pos[skel.seg[`humerus_${side}`]]
      const along = (t: number) => add(gh, scale(sub(g[side], gh), t))
      for (const [t0, t1, r, press] of KB_ARM) {
        const arm = { a: along(t0), b: along(t1), r }
        ds.push(...clears(arm, thighs, ON_LEGS), ...clears(arm, trunk, press))
      }
    }
    return softMin(ds)
  }
  // rope: arms and strands keep off the thighs and the trunk
  const body = caps.filter((c) => c.region.startsWith('thigh_') || c.region === 'trunk')
  const thighs = body.filter((c) => c.region !== 'trunk')
  const trunk = body.filter((c) => c.region === 'trunk')
  const pose = ropePose(ctx, g)
  for (const side of ['l', 'r'] as const) {
    const grip = g[side]
    const gh = f.pos[skel.seg[`humerus_${side}`]]
    const along = (t: number) => add(gh, scale(sub(grip, gh), t))
    for (const [t0, t1, r, press] of ROPE_ARM) {
      const arm = { a: along(t0), b: along(t1), r }
      ds.push(...clears(arm, thighs, ON_LEGS), ...clears(arm, trunk, press))
    }
    ds.push(...clears({ a: pose.pos, b: siteWorld(ctx.load!, pose, side).pos, r: 0.012 }, thighs, ON_LEGS))
  }
  return softMin(ds)
}

/** arm angle for this frame: resting the load on the legs, or (cable) towards the pulley unless the legs stop it */
function solveGrips(skel: Skeleton, f: FK, ctx: Ctx, s: number): Grips {
  if (ctx.kind === 'back') return backGrips(skel, f, ctx)
  if (ctx.phiAt) return gripsAt(skel, f, ctx, ctx.phiAt(s))
  let pref = Infinity
  if (ctx.kind === 'cable') {
    const gh = scale(add(f.pos[skel.seg.humerus_l], f.pos[skel.seg.humerus_r]), 0.5)
    pref = (CABLE_FOLLOW * Math.atan2(gh[2] - ctx.pulley![2], gh[1] - ctx.pulley![1])) / DEG
  } else if (ctx.kind === 'single') pref = SINGLE_ARM
  // sumo kettlebell: over the midfoot once the bell clears the legs; standing tall it rests on the front of the thighs
  else if (ctx.overMid) pref = root1d((phi) => kbPose(ctx, gripsAt(skel, f, ctx, phi)).pos[2] - ctx.stance.midfoot[2], -45, 60, { tol: 1e-7, scan: 21 }).x
  const caps = bodyCapsules(skel, f)
  const res = (phi: number) => {
    const c = contact(skel, f, caps, ctx, gripsAt(skel, f, ctx, phi))
    return pref === Infinity ? c : softMin([(pref - phi) * 0.002, c])
  }
  const phi = root1d(res, -45, 60, { tol: 1e-7, scan: 21 }).x
  const w = ctx.armFloor?.(s) ?? 0
  return gripsAt(skel, f, ctx, phi + w * Math.max(0, FLOOR_ARM - phi))
}

/** floor pull: how far the bar is from resting against the shins, m */
function barToShins(skel: Skeleton, f: FK, ctx: Ctx, g: Grips): number {
  const bar = barPose(ctx, g).pos
  const shins = bodyCapsules(skel, f).filter((c) => c.region.startsWith('shank_'))
  return Math.min(...clears({ a: [-0.655, bar[1], bar[2]], b: [0.655, bar[1], bar[2]], r: 0.014 }, shins, ON_LEGS))
}

function handleAxis(ctx: Ctx, g: Grips, side: Side): V3 {
  if (ctx.kind !== 'cable') return [1, 0, 0]
  return siteWorld(ctx.load!, ropePose(ctx, g), side).axis!
}

const ARM_DOFS = ['scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']

/** point an arm (humerus) along a world direction, joint space: the free hand, and a cheap stand-in while balancing */
function hangArm(skel: Skeleton, q: Float64Array, side: Side, dir: V3, elbow = 4) {
  const t = fk(skel, q).rot[skel.seg.thorax2]
  const local = qrot(qconj(t), dir)
  const m: V3 = side === 'l' ? local : [-local[0], local[1], local[2]]
  const elev = Math.acos(clamp(-m[1], -1, 1)) / DEG
  const plane = elev < 2 ? 90 : Math.atan2(m[2], m[0]) / DEG
  setDofs(skel, q, {
    [`shoulder_${side}.plane`]: plane, [`shoulder_${side}.elev`]: elev, [`shoulder_${side}.rot`]: 0, [`scapula_${side}.uprot`]: 0,
    [`elbow_${side}.flex`]: elbow, [`wrist_${side}.flex`]: 0, [`wrist_${side}.dev`]: 0,
  })
}

/** elbow direction for the hanging arms: back and out on a bar; hands held in towards the midline point the elbows
 * out, so the carrying angle swings the forearms forward instead of tucking the elbows into the waist */
const POLE: Record<Kind, [number, number]> = { bar: [0.75, -0.65], db: [1, -0.25], single: [1, -0.25], cable: [1, -0.3], kb: [0.92, -0.38], back: [0.4, -0.7] }

function armTo(skel: Skeleton, q: Float64Array, ctx: Ctx, g: Grips, side: Side) {
  const lat = side === 'l' ? 1 : -1
  const [out, back] = POLE[ctx.kind]
  // hanging arms: the scapulae stay set (lats on), so the shoulder joint stays where the arm model put it
  attachHand(skel, q, side, { pos: g[side], axis: handleAxis(ctx, g, side), palm: ctx.palm(side) }, { pole: [out * lat, 0, back], planeHint: 90, wristBias: 0, uprot: 0 })
}

/** both arms onto their grips (two-handed and symmetric holds solve the left arm and mirror it); `rough` points them
 * along the shoulder-grip lines instead, for the balance search */
function arms(skel: Skeleton, q: Float64Array, ctx: Ctx, g: Grips, rough = false) {
  if (ctx.barArms) {
    for (const [i, x] of ctx.barArms) q[i] = x
    return
  }
  const f = fk(skel, q)
  const dir = (s: Side) => norm(sub(g[s], f.pos[skel.seg[`humerus_${s}`]]))
  if (ctx.kind === 'single') {
    const loaded = other(ctx.side)
    if (rough) hangArm(skel, q, loaded, dir(loaded))
    else armTo(skel, q, ctx, g, loaded)
    setDofs(skel, q, { [`forearm_${ctx.side}.pro`]: 20 })
    hangArm(skel, q, ctx.side, dir(ctx.side), 12)
    return
  }
  if (rough) hangArm(skel, q, 'l', dir('l'))
  else armTo(skel, q, ctx, g, 'l')
  for (const k of ARM_DOFS) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

function midfoot(skel: Skeleton, foot: FootTarget): V3 {
  return add(foot.ankle, qrot(foot.rot, skel.data.sites[`midfoot_${foot.side}`].local))
}

function implementPoses(skel: Skeleton, q: Float64Array, ctx: Ctx, g: Grips): ImplementPose[] {
  if (ctx.kind === 'bar') return ctx.rack ? [barPose(ctx, g), ctx.rack] : [barPose(ctx, g)]
  if (ctx.kind === 'back') return [barPose(ctx, g)]
  if (ctx.kind === 'kb') return [kbPose(ctx, g)]
  if (ctx.kind === 'cable') return [ropePose(ctx, g), { id: 'stack', pos: [0, 0, 0], rot: qid() }]
  const f = fk(skel, q)
  const sides: Side[] = ctx.kind === 'db' ? ['l', 'r'] : [other(ctx.side)]
  const out = sides.map((s, k): ImplementPose => {
    const h = handFrame(skel, f, s)
    if (ctx.bell) {
      // the bell hangs plumb from the handle in the hand, turned with the hand about the vertical
      const rot = qfromBasis(norm(reject(h.axis, [0, 1, 0])), [0, 1, 0])
      return { id: ctx.bell.id, pos: sub(h.pos, qrot(rot, ctx.bell.sites.handle.pos)), rot }
    }
    return { id: ctx.dbs![k].id, pos: h.pos, rot: implementFromHand(h.axis, h.palm) }
  })
  if (oneFoot(ctx)) out.push({ id: 'spot', pos: midfoot(skel, ctx.feet[0]), rot: qid() })
  return out
}

// ---------- balance ----------

function loads(ctx: Ctx, g: Grips) {
  if (ctx.kind === 'db') return [{ mass: DB_KG, pos: g.l }, { mass: DB_KG, pos: g.r }]
  if (ctx.kind === 'single') return ctx.bell ? [{ mass: ctx.bell.mass, pos: bellAt(ctx, g[other(ctx.side)]) }] : [{ mass: SINGLE_DB_KG, pos: g[other(ctx.side)] }]
  if (ctx.kind === 'kb') return [{ mass: ctx.bell!.mass, pos: kbPose(ctx, g).pos }]
  if (ctx.kind === 'back') return [{ mass: ctx.load!.mass, pos: barPose(ctx, g).pos }]
  return []
}

/** sideways and forward offset of the balance point from its support, m */
function offset(skel: Skeleton, q: Float64Array, ctx: Ctx, g: Grips): [number, number] {
  const mid = oneFoot(ctx) ? midfoot(skel, ctx.feet[0]) : ctx.stance.midfoot
  if (ctx.kind === 'bar') return [0, barPose(ctx, g).pos[2] - mid[2]]
  const forces = []
  if (ctx.kind === 'cable') {
    const pose = ropePose(ctx, g)
    forces.push(cableForce({ pulley: ctx.pulley!, implement: pose.id, point: [0, 0, 0], kg: CABLE_KG }, pose))
  }
  const [x, z] = centerOfPressure(skel, fk(skel, q), loads(ctx, g), forces)
  return [x - mid[0], z - mid[2]]
}

// ---------- frame ----------

type Frame = { q: Float64Array; g: Grips; df: number }

function solveFrame(skel: Skeleton, ctx: Ctx, s: number, knee: number, hip: number): Frame {
  const q = zeroQ(skel)
  posture(skel, q, ctx, s)
  const tx = lerp(ctx.tx[0], ctx.tx[1], s)
  const build = (df: number, rough: boolean) => {
    setDofs(skel, q, { 'scapula_*.uprot': 0 })
    placeHip(skel, q, ctx, knee, df, hip, tx)
    gaze(skel, q)
    const g = solveGrips(skel, fk(skel, q), ctx, s)
    if (rough || ctx.kind !== 'bar') arms(skel, q, ctx, g, rough)
    return g
  }
  const r = root1d((df) => offset(skel, q, ctx, build(df, true))[1], -20, 25, { tol: 1e-7, scan: 9 })
  const g = build(r.x, false)
  if (ctx.kind === 'bar') arms(skel, q, ctx, g)
  return { q, g, df: r.x }
}

// ---------- setup ----------

/** straight-arm reach from the shoulder joint to the grip that the arm IK meets with the elbows at ARM_ELBOW */
function reachOf(skel: Skeleton, ctx: Ctx): number {
  const q = zeroQ(skel)
  posture(skel, q, ctx, 0)
  const f = fk(skel, q)
  const side: Side = ctx.kind === 'single' ? other(ctx.side) : 'l'
  const gh = f.pos[skel.seg[`humerus_${side}`]]
  const x = ctx.kind === 'single' ? gh[0] - (side === 'l' ? ctx.inward : -ctx.inward) : ctx.gripX
  const elbow = (d: number) => {
    const g: V3 = [x, gh[1] - Math.sqrt(Math.max(0.01, d * d - (x - gh[0]) ** 2)), gh[2]]
    const grips: Grips = side === 'l' ? { l: g, r: [-g[0], g[1], g[2]], phi: 0 } : { l: [-g[0], g[1], g[2]], r: g, phi: 0 }
    armTo(skel, q, ctx, grips, side)
    return q[skel.dof[`elbow_${side}.flex`]] - ARM_ELBOW
  }
  return root1d(elbow, 0.55, 0.75, { tol: 1e-6, scan: 8 }).x
}

/**
 * Good morning: the arms on the bar on the upper back, solved once standing (elbow and palm directions in the thorax
 * frame, as the high-bar squat) and mirrored; the arm DOFs are relative to the thorax, so they hold through the rep
 */
function solveBackArms(skel: Skeleton, ctx: Ctx): [number, number][] {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'clavicle_*.prot': -12, 'clavicle_*.elev': 4, 'grip_*.close': 1 })
  stand(skel, q, ctx.stance, { knee: TOP_KNEE, df: 0, tilt: 0 })
  const f = fk(skel, q)
  const thorax = f.rot[skel.seg.thorax2]
  const T = (x: number, y: number, z: number) => qrot(thorax, [x, y, z])
  const g = backGrips(skel, f, ctx).l
  attachHand(skel, q, 'l', { pos: g, axis: T(1, 0, 0), palm: T(0, 0.3, 1) }, { pole: T(0.4, -0.7, -0.6), wristBias: BACK_BAR.wristBias, planeHint: -90 })
  return BACK_ARM_DOFS.flatMap((k) => {
    const x = q[skel.dof[k.replace('*', 'l')]]
    return [[skel.dof[k.replace('*', 'l')], x], [skel.dof[k.replace('*', 'r')], x]] as [number, number][]
  })
}

function ropeSpec(): ImplementSpec {
  const base = cableHandle({ id: 'handle', attachment: 'rope' })
  const { x, y } = ROPE
  return {
    ...base,
    parts: [cyl([0, 0, 0], [x, -y, 0], 0.012), cyl([0, 0, 0], [-x, -y, 0], 0.012)],
    sites: { l: { pos: [x * 0.87, -y * 0.87, 0], axis: norm([x, -y, 0]) }, r: { pos: [-x * 0.87, -y * 0.87, 0], axis: norm([-x, -y, 0]) } },
  }
}

/** single leg: pelvis shift that puts the centre of pressure over the stance foot sideways */
function sideShift(skel: Skeleton, ctx: Ctx, s: number) {
  let tx = 0
  for (let k = 0; k < 4; k++) {
    ctx.tx = [tx, tx]
    const fr = solveFrame(skel, ctx, s, ctx.kneeAt(s), ctx.hipAt(s))
    tx -= offset(skel, fr.q, ctx, fr.g)[0] * 1.15
  }
  return tx
}

/**
 * Pulling from the floor the bar rides the legs over the knee bump: resting on the legs frame by frame swings the arms
 * (and with them the balance lean) a few degrees within two frames of the fast concentric. Opening the resting angle over a window (a lower envelope: the bar
 * never presses deeper than resting) and averaging it keeps the bar on the shins and thighs with a few mm to spare
 * where the knee sticks out.
 */
const PHI_SAMPLES = 81
const PHI_WINDOW = 0.045
/** stiff-leg pull: the bar rides the knee bump with straighter legs, so the arm angle is smoothed wider */
const STIFF_PHI_WINDOW = 0.09

function smoothPhi(skel: Skeleton, ctx: Ctx, window = PHI_WINDOW): (s: number) => number {
  const xs = Array.from({ length: PHI_SAMPLES }, (_, k) => k / (PHI_SAMPLES - 1))
  const raw = xs.map((s) => solveFrame(skel, ctx, s, ctx.kneeAt(s), ctx.hipAt(s)).g.phi)
  const w = Math.round(window * (PHI_SAMPLES - 1))
  const win = (a: number[], k: number) => a.slice(Math.max(0, k - w), Math.min(a.length, k + w + 1))
  const eroded = raw.map((_, k) => Math.min(...win(raw, k)))
  const opened = eroded.map((_, k) => {
    const v = win(eroded, k)
    return v.reduce((a, x) => a + x, 0) / v.length
  })
  return monotoneCubic(xs, opened)
}

function palmFor(p: P, kind: Kind) {
  return (side: Side): V3 => {
    if (kind === 'cable' || p.grip === 'neutral') return [side === 'l' ? -1 : 1, 0, 0]
    return p.grip === 'supinated' ? [0, 0, 1] : [0, 0, -1]
  }
}

const context = memo((p: P, skel: Skeleton): Ctx => {
  const kind = kindOf(p)
  if (!['bar', 'db', 'single', 'cable', 'kb', 'back'].includes(kind)) throw new Error(`hinge: variant not implemented yet (${kind})`)
  const k = kind as Kind
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const side: Side = p.side === 'left' ? 'l' : 'r'
  const sx = side === 'l' ? 1 : -1
  const single = k === 'single'
  const split = p.stance === 'split'
  const pins = p.start === 'pins'
  const sumo = (k === 'bar' || k === 'kb') && p.start === 'floor' && p.stance === 'wide'
  const width = sumo ? SUMO.width * skel.data.shoulderWidth : split ? SPLIT.x + SPLIT.backX : stanceWidth(skel, p.stance as StanceName)
  const stance = single ? makeStance(skel, 2 * SINGLE_FOOT_X, p.toeOut) : makeStance(skel, width, p.toeOut)
  const feet = single ? [plantFoot(skel, side, [side === 'l' ? SINGLE_FOOT_X : -SINGLE_FOOT_X, 0, 0], p.toeOut)] : split ? [plantFoot(skel, side, [sx * SPLIT.x, 0, 0], p.toeOut)] : stance.feet
  const contacts: Contact[] = plantedContacts(skel, { feet, midfoot: stance.midfoot })
  const implements_: ImplementSpec[] = []
  const ctx: Ctx = {
    kind: k, tempo, setup: { implements: implements_, contacts, tempo, symmetric: !single && !split }, feet, stance, side,
    gripX: 0, reach: 0, palm: palmFor(p, k), kneeAt: () => TOP_KNEE, hipAt: () => TOP_HIP, tx: [0, 0], inward: SINGLE_IN,
  }
  const grip = (id: string, s: Side, site: string): Contact => ({ site: `grip_${s}`, kind: 'grip', target: { implement: id, grip: site } })
  if (split) {
    // B-stance: the back foot's ball beside the front heel, heel up; balance over the front foot
    const front = feet[0], b = other(side)
    const heel = add(front.ankle, qrot(front.rot, skel.data.sites[`heel_${side}`].local))
    const yaw = (b === 'l' ? p.toeOut : -p.toeOut) * DEG
    const rot = qmul(qaxis([0, 1, 0], yaw), qaxis([1, 0, 0], SPLIT.pitch * DEG))
    const ball: V3 = [-sx * SPLIT.backX, 0, heel[2] - SPLIT.behind]
    ctx.back = { side: b, rot, ankle: sub(ball, qrot(rot, skel.data.sites[`ball_${b}`].local)) }
    contacts.push({ site: `ball_${b}`, kind: 'planted', target: { world: ball } })
  }
  if (k === 'bar') {
    const floor = p.start === 'floor' || pins
    const bar = barbell({ gripWidth: p.gripWidth * skel.data.shoulderWidth, plateKg: floor ? FLOOR_PLATES : BAR_PLATES })
    ctx.load = bar
    ctx.gripX = bar.sites.l.pos[0]
    implements_.push(bar)
    contacts.push(grip(bar.id, 'l', 'l'), grip(bar.id, 'r', 'r'))
    ctx.setup.balance = { point: { implement: bar.id }, over: 'midfoot', tol: 0.025 }
    if (pins) {
      // rack pull: the bar rests on the spotter arms just below the knees
      const f0 = fk(skel, zeroQ(skel))
      const knee = f0.pos[skel.seg.tibia_l][1] - f0.pos[skel.seg.foot_l][1] - skel.data.sites.heel_l.local[1]
      ctx.floorY = knee - PINS.below + 0.001
    } else if (floor) {
      ctx.floorY = PLATE_20_RADIUS + 0.001
      ctx.setup.tolerances = { body: sumo ? { ...FLOOR_START_TOL, ...SUMO_TOL } : FLOOR_START_TOL }
    }
  } else if (k === 'kb') {
    const bell = kettlebell({ id: 'kb', kg: sumo ? KB.sumo : KB.rdl })
    ctx.bell = bell
    ctx.gripX = bell.sites.handle_l.pos[0]
    implements_.push(bell)
    contacts.push(grip(bell.id, 'l', 'handle_l'), grip(bell.id, 'r', 'handle_r'))
    ctx.setup.balance = { point: 'com', over: 'midfoot', tol: 0.025 }
    ctx.setup.tolerances = { body: KB_TOL }
    if (sumo) {
      // the bell stands on the floor between the heels, the arms hang straight down to its handle
      ctx.floorY = kettlebellDims(bell.mass).base + bell.sites.handle.pos[1] + 0.001
      ctx.overMid = true
    }
  } else if (k === 'back') {
    const bar = barbell({ gripWidth: p.gripWidth * skel.data.shoulderWidth, plateKg: BAR_PLATES })
    ctx.load = bar
    implements_.push(bar)
    contacts.push(grip(bar.id, 'l', 'l'), grip(bar.id, 'r', 'r'))
    ctx.barArms = solveBackArms(skel, ctx)
    ctx.setup.balance = { point: 'com', over: 'midfoot', tol: 0.025 }
    ctx.setup.rests = [{ implement: bar.id, regions: BACK_BAR_REST, tol: 20 }]
  } else if (k === 'db') {
    ctx.dbs = [dumbbell({ id: 'db_l', mass: DB_KG }), dumbbell({ id: 'db_r', mass: DB_KG })]
    ctx.gripX = DB_X
    implements_.push(...ctx.dbs)
    contacts.push(grip('db_l', 'l', 'c'), grip('db_r', 'r', 'c'))
    ctx.setup.balance = { point: 'com', over: 'midfoot', tol: 0.025 }
    if (split) {
      implements_.push(floorSpot())
      ctx.setup.balance = { point: 'com', over: { implement: 'spot', sites: ['c'] }, tol: 0.025 }
      // the back foot on its ball: the toes lie flat (toe joint) but the rigid foot's forefoot capsule dips under the
      // floor as the heel rises (the lunge's rear foot precedent)
      ctx.setup.tolerances = { floor: SPLIT.floorTol }
    }
  } else if (k === 'single') {
    if (p.implement === 'kettlebell') {
      const bell = kettlebell({ id: 'kb', kg: KB.single })
      ctx.bell = bell
      ctx.dbs = [bell]
      ctx.inward = KB.singleIn
      implements_.push(bell, floorSpot())
      contacts.push(grip(bell.id, other(side), 'handle'))
    } else {
      const db = dumbbell({ id: 'db', mass: SINGLE_DB_KG })
      ctx.dbs = [db]
      implements_.push(db, floorSpot())
      contacts.push(grip('db', other(side), 'c'))
    }
    ctx.setup.balance = { point: 'com', over: { implement: 'spot', sites: ['c'] }, tol: 0.025 }
  } else {
    const rope = ropeSpec()
    ctx.load = rope
    ctx.gripX = rope.sites.l.pos[0]
    ctx.pulley = [0, PULLEY_Y, stance.midfoot[2] - PULLEY_BACK]
    implements_.push(rope, {
      id: 'stack', kind: 'bench', mass: 0, com: [0, 0, 0],
      parts: [cyl([0, 0, ctx.pulley[2] - 0.12], [0, 2.1, ctx.pulley[2] - 0.12], 0.05), cyl([0, PULLEY_Y, ctx.pulley[2]], [0, PULLEY_Y, ctx.pulley[2] - 0.12], 0.04)],
      sites: {},
    })
    contacts.push(grip(rope.id, 'l', 'l'), grip(rope.id, 'r', 'r'))
    ctx.setup.cables = [{ pulley: ctx.pulley, implement: rope.id, point: [0, 0, 0], kg: CABLE_KG }]
    ctx.setup.balance = { point: 'com', over: 'midfoot', tol: 0.025 }
  }

  if (k !== 'back') ctx.reach = reachOf(skel, ctx)
  if (pins) {
    // rack pull: the knees bend to kneeAngle while the hips take the bar down to the pins, as the stiff-leg pull
    const kb = p.kneeAngle
    ctx.kneeAt = (s) => TOP_KNEE + (kb - TOP_KNEE) * ramp(s)
    ctx.armFloor = (s) => ramp((s - FLOOR_KNEE_AT) / (1 - FLOOR_KNEE_AT))
    const hb = root1d((hb) => solveFrame(skel, ctx, 1, kb, hb).g.l[1] - ctx.floorY!, 20, 110, { tol: 1e-6, scan: 9 }).x
    ctx.hipAt = (s) => TOP_HIP + (hb - TOP_HIP) * s
    ctx.phiAt = smoothPhi(skel, ctx, STIFF_PHI_WINDOW)
    const g = solveFrame(skel, ctx, 1, ctx.kneeAt(1), ctx.hipAt(1)).g
    const z = (g.l[2] + g.r[2]) / 2 + PINS.rack
    const spec = rack({ hookHeight: PINS.hooks, safetyHeight: ctx.floorY! - 0.001 })
    implements_.push(spec)
    ctx.rack = { id: spec.id, pos: [0, 0, z], rot: qaxis([0, 1, 0], Math.PI) }
  } else if (ctx.floorY !== undefined) {
    // conventional pull: hips first until the bar passes the knees, then the knees; calibrated so the plates sit on
    // the floor with the bar over the midfoot and against the shins, the shoulders just in front of it
    const schedule = (kb: number, hb: number) => {
      const p = Math.log((FLOOR_SOFT_KNEE - TOP_KNEE) / (kb - TOP_KNEE)) / Math.log(FLOOR_KNEE_AT)
      ctx.kneeAt = (s) => TOP_KNEE + (kb - TOP_KNEE) * Math.pow(clamp(s, 0, 1), p)
      ctx.hipAt = (s) => TOP_HIP + (hb - TOP_HIP) * s
    }
    const hipFor = (kb: number) => root1d((hb) => solveFrame(skel, ctx, 1, kb, hb).g.l[1] - ctx.floorY!, 40, 130, { tol: 1e-6, scan: 9 }).x
    ctx.armFloor = (s) => ramp((s - FLOOR_KNEE_AT) / (1 - FLOOR_KNEE_AT))
    if (sumo) {
      // the upright trunk keeps the shoulders over the bar on their own: the bar stays resting on the shins (the
      // kettlebell hangs between them)
      ctx.armFloor = undefined
      const kb = SUMO.knee
      const top = k === 'kb' ? KB.sumoTopKnee : TOP_KNEE
      ctx.kneeAt = (s) => top + (kb - top) * lerp(s, s * s, SUMO.lag)
      const hb = hipFor(kb)
      ctx.hipAt = (s) => TOP_HIP + (hb - TOP_HIP) * s
    } else if (p.kneeAngle <= STIFF_KNEE_MAX) {
      // stiff-leg pull: the knees stay at kneeAngle and the hips alone take the bar to the floor
      const kb = p.kneeAngle
      ctx.kneeAt = (s) => TOP_KNEE + (kb - TOP_KNEE) * ramp(s)
      const hb = hipFor(kb)
      ctx.hipAt = (s) => TOP_HIP + (hb - TOP_HIP) * s
    } else {
      const shins = (kb: number) => {
        const fr = solveFrame(skel, ctx, 1, kb, hipFor(kb))
        return barToShins(skel, fk(skel, fr.q), ctx, fr.g)
      }
      const kb = root1d(shins, 45, 95, { tol: 1e-4, scan: 10 }).x
      schedule(kb, hipFor(kb))
    }
  } else {
    const kb = p.kneeAngle
    const hb = BOTTOM_HIP[k]
    ctx.kneeAt = (s) => TOP_KNEE + (kb - TOP_KNEE) * ramp(s / 0.6)
    ctx.hipAt = (s) => TOP_HIP + (hb - TOP_HIP) * s
    if (single || split) {
      const top = sideShift(skel, ctx, 0), bottom = sideShift(skel, ctx, 1)
      ctx.tx = [top, bottom]
    }
  }
  if (ctx.floorY !== undefined && !ctx.phiAt) ctx.phiAt = smoothPhi(skel, ctx, p.kneeAngle <= STIFF_KNEE_MAX ? STIFF_PHI_WINDOW : PHI_WINDOW)
  return ctx
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const s = 1 - phaseAt(u, ctx.tempo).c
  const fr = solveFrame(skel, ctx, s, ctx.kneeAt(s), ctx.hipAt(s))
  return { q: fr.q, implements: implementPoses(skel, fr.q, ctx, fr.g), contacts: ctx.setup.contacts }
}

export const hinge: Template<P> = {
  id: 'hinge',
  driver: 'implement',
  params: SCHEMAS.hinge,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
