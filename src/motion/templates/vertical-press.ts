import { attachHand, handFrame, plantFoot, root1d, solveLegs, type FootTarget } from '../constraints.ts'
import { bodyCapsules, restAgainst } from '../collide.ts'
import { centerOfMass, fk, segPos, sitePos } from '../fk.ts'
import { barbell, bench, comWorld, siteWorld, type ImplementSpec, type Part } from '../implements.ts'
import { band, bandHandle, bandNode, bandPose, poseHandle } from '../implements/index.ts'
import { pressHandles, PRESS_MACHINE, pressMachineFrame, type PressGeometry } from '../implements/press-vertical-bodyweight.ts'
import { dls } from '../ik.ts'
import { add, DEG, lerp, norm, qaxis, qid, qrot, scale, sub, type V3 } from '../math.ts'
import { clearNode, closestOn, runClearance, smooth } from './press-cable.ts'
import { setDofs, shoulderRhythm, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, minJerk, phaseAt, type Tempo } from '../timing.ts'
import { comWithDumbbells, dumbbellContacts, dumbbellPoses, handDumbbells } from './arms.ts'
import { mirrorArm as mirrorIsoArm, poseArm, relaxedArm, thoraxFrame } from './isolation.ts'
import { kbContacts, kbInHand, kbRests, kettlebells, KB_KG } from './press-kettlebell.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { monotoneCubic, secant } from './solve.ts'
import { makeStance, plantedContacts, setPelvis, stand, stanceWidth, type StanceSetup } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'
import { landmineContext, sampleLandmine, type LandmineCtx } from './press-landmine.ts'

// Vertical press, implement driver: the bar (or handle) path is keyed and the arms are solved onto it.
// Standing barbell: the bar rises straight up in front of the face, then drifts back over the midfoot once past the
// forehead, while the whole body balances over the feet (ankle lean keeps the system COM over the midfoot). The
// lifter starts leaning back a little with the bar just below the chin, keeps the head back while the bar passes the
// face, then brings the chest and head through under the bar at lockout. Smith: one vertical line on the rails, the
// body balancing alone. Seated dumbbells: from ear level to overhead, the hands closing in slightly. Machine: the
// handles swing up on an arc about a pivot behind the seat. Standing dumbbells: the seated path off the shoulders,
// ribs down, balanced over the midfoot. Seated barbell: the standing bar line and head motion on an upright bench.
// Endpoints: humeral elevation ~40-60 deg at the bottom to ~165-175 at lockout, elbow flexion bottom ~95-140 to ~0-10
// (motion-authoring research: Evangelista 2025 two-link OHP model; author judgment for the rest).
// Turned grips (wave 3b): the Arnold press starts seated with the dumbbells in front of the chin, palms facing the
// lifter and elbows forward, and turns the palms forward as the elbows sweep out to the sides on the way up; the
// one-arm kettlebell press starts in the rack (palm in, elbow tucked, the bell on the back of the forearm) and turns
// the palm forward to a lockout beside the ear, the free arm relaxed; the band press stands on the band (its middle
// under the feet) and presses the handles from the shoulders. Z press: the seated dumbbell path sitting on the floor,
// legs straight.

type P = ParamsOf<'vertical-press'>

// standing: the rig's elbow stops at 150, so the bar starts held just off the upper chest, below the chin
const BAR_BELOW_CHIN = 0.06
const BAR_ELBOW0 = 142
const LOCK_ELBOW = 5
const KNEE = 3
const BAR_PLATE_KG = 20
/** the hand solver's comfortable deviation band widened to the joint's range: it saturates only at the stops, where
 * the switch to an oblique hold would kink the arm */
const JOINT_DEV: [number, number] = [-35, 20]
/** wrist extension on the bar, deg: wrists stacked, the bar over the forearms (more puts the bar hand at the radial
 * stop near the bottom) */
const WRIST_EXT = 10
/** trunk lean, deg (negative = back): at the bottom, extra while the bar passes the face, at lockout */
const LEAN0 = -6
const PASS_LEAN = 2
const LEAN1 = -1
/** contraction over which the free bar drifts back over the midfoot (it has passed the forehead by the start) */
const BAR_BACK = [0.38, 1]
/** elbow pole at lockout (thorax frame): out to the sides over the head; the Smith locks out a little in front of the
 * head, so its elbows come in front earlier (otherwise the upper arm swings in over the last degrees) */
const BAR_POLE = [0.6, 0.05, 0.3]
const SMITH_POLE = [0.25, 0.05, 0.6]
/** Smith: the bar a little more in the fingers (deg across the palm), which keeps the wrist off its radial stop at
 * lockout in front of the head */
const SMITH_OBLIQUE = 4
/** contraction knots the ankle balance is solved at (interpolated between) */
const KNOTS = 17

/** seated dumbbells */
const DB_KG = 18
const DB_ELBOW0 = 110
/** dumbbell grip centre offsets from the shoulder joint (lateral, forward) at the bottom and the top, m */
const DB_FROM = [0.27, 0.05]
const DB_TO = [0.03, 0.01]
const DB_ELBOW1 = 8
const SEAT_HIP: V3 = [0, 0.56, 0]
/** machine: elbow flexion at the top of the arc (machines stop short of lockout), deg */
const MACHINE_ELBOW1 = 12
const MACHINE_ELBOW0 = 118

type Stand = {
  kind: 'bar' | 'smith'
  stance: StanceSetup
  bar: ImplementSpec
  /** bar line (world z) at the bottom and at lockout, bar height at the bottom and at lockout */
  z0: number
  z1: number
  y0: number
  y1: number
  /** balanced ankle dorsiflexion along the rep */
  df: (c: number) => number
}

/** the bar fields the bar path and the arms on it read (standing or seated) */
type BarLine = Pick<Stand, 'kind' | 'bar' | 'z0' | 'z1' | 'y0' | 'y1'>

/** standing dumbbells: path offsets from the shoulder joint (left), balanced ankle dorsiflexion along the rep */
type StandDb = { kind: 'sdb'; stance: StanceSetup; from: V3; to: V3; df: (c: number) => number }

/** seated barbell: the bar line in front of the face, as standing, with the body still on an upright bench */
type SeatedBar = BarLine & { seatedBar: true; feet: FootTarget[]; benchPose: ImplementPose }

type Seated = {
  kind: 'db' | 'machine'
  feet: FootTarget[]
  benchPose?: ImplementPose
  /** the still body when it is not the bench sit (sitting on the floor) */
  base?: Float64Array
  /** dumbbells that turn in the hands (Arnold press) */
  turn?: Turn
  /** dumbbells: grip paths per side (left), world */
  from?: V3
  to?: V3
  press?: PressGeometry
}

type Ctx = { tempo: Tempo; setup: Setup; v: Stand | Seated | StandDb | SeatedBar | StandTurn }

const ramp = (c: number, a: number, b: number) => minJerk((c - a) / (b - a))

const ARM = ['scapula_*.uprot', 'clavicle_*.elev', 'clavicle_*.prot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev', 'grip_*.close']

function mirrorArm(skel: Skeleton, q: Float64Array) {
  for (const k of ARM) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

function unsupported(p: P) {
  if (p.implement === 'kettlebell') return p.posture === 'standing' && p.laterality === 'unilateral' && p.grip === 'neutral' ? null : `kettlebell ${p.posture} ${p.laterality} ${p.grip}`
  if (p.laterality !== 'bilateral') return `laterality ${p.laterality}`
  if (p.rotate && !(p.implement === 'dumbbell' && p.posture === 'seated' && p.grip === 'supinated' && p.support !== 'floor')) return `rotate ${p.implement} ${p.posture} ${p.grip}`
  if (!p.rotate && p.grip === 'supinated') return 'supinated without rotate'
  if (p.support === 'floor') return p.implement === 'dumbbell' && p.posture === 'seated' ? null : `floor ${p.implement} ${p.posture}`
  if (p.implement === 'band') return p.posture === 'standing' && p.grip === 'pronated' ? null : `band ${p.posture} ${p.grip}`
  if (p.implement === 'barbell' && p.posture === 'standing') return null
  if (p.implement === 'smith' && p.posture === 'standing') return null
  if (p.implement === 'dumbbell' && p.posture === 'seated') return null
  if (p.implement === 'dumbbell' && p.posture === 'standing') return null
  if (p.implement === 'barbell' && p.posture === 'seated') return null
  if (p.implement === 'machine' && p.machine === 'shoulder_press_machine' && p.posture === 'seated') return null
  return `${p.implement}/${p.posture}`
}

/** clavicle from the rhythm rule for an arm elevation, plus a little extra shrug into lockout */
function girdle(skel: Skeleton, q: Float64Array, elev: number, plane: number, shrug: number) {
  const g = shoulderRhythm(elev, plane)
  setDofs(skel, q, { 'clavicle_l.elev': g.elev + shrug, 'clavicle_l.prot': g.prot })
}

/** left hand onto a target twice (the girdle follows the solved elevation), right mirrored */
type ArmTarget = Parameters<typeof attachHand>[3]
type ArmOpts = Parameters<typeof attachHand>[4]

function pressArm(skel: Skeleton, q: Float64Array, target: ArmTarget, o: ArmOpts, guess: [number, number], shrug: number) {
  girdle(skel, q, guess[0], guess[1], shrug)
  attachHand(skel, q, 'l', target, o)
  girdle(skel, q, q[skel.dof['shoulder_l.elev']], q[skel.dof['shoulder_l.plane']], shrug)
  attachHand(skel, q, 'l', target, o)
  mirrorArm(skel, q)
}

// ---------- standing ----------

/** posture keys along the rep: back a little more while the bar passes the face, head and chest through at lockout */
function keys(c: number) {
  const pass = ramp(c, 0, 0.15) - ramp(c, 0.45, 0.7)
  return {
    lean: lerp(LEAN0, LEAN1, ramp(c, 0.45, 0.95)) - PASS_LEAN * pass,
    back: 1 - ramp(c, 0.45, 0.9),
    through: ramp(c, 0.5, 1),
  }
}

/** trunk lean split between pelvis, lumbar and thorax; head back (chin in) or through */
function posture(skel: Skeleton, q: Float64Array, k: ReturnType<typeof keys>) {
  setDofs(skel, q, {
    'lumbar.flex': -2 + 0.35 * k.lean,
    'thorax.flex': 0.15 * k.lean,
    'neck.flex': -18 * k.back + 10 * k.through,
    'head.flex': 13 * k.back - 5 * k.through,
    'grip_*.close': 1,
  })
}

const tiltOf = (lean: number) => 3 + 0.5 * lean

/** straight up in front of the face, then back over the midfoot once it has passed the forehead */
function barPose(v: BarLine, c: number): ImplementPose {
  return { id: v.bar.id, pos: [0, lerp(v.y0, v.y1, c), lerp(v.z0, v.z1, ramp(c, BAR_BACK[0], BAR_BACK[1]))], rot: qid() }
}

/** hands onto the bar: elbows down and a little out in front at the bottom, out to the sides at lockout (the pole
 * stays well off the shoulder-wrist line, so the elbow's swivel is well conditioned) */
function barArms(skel: Skeleton, q: Float64Array, v: BarLine, c: number) {
  const g = siteWorld(v.bar, barPose(v, c), 'l')
  const thorax = fk(skel, q).rot[skel.seg.thorax2]
  const top = v.kind === 'smith' ? SMITH_POLE : BAR_POLE
  const pole = qrot(thorax, norm([lerp(0.5, top[0], c), lerp(-0.7, top[1], c), lerp(0.5, top[2], c)]))
  const target = { pos: g.pos, axis: g.axis!, palm: qrot(thorax, norm([0, lerp(0.6, 0.9, c), lerp(0.8, 0.3, c)])) }
  const oblique = v.kind === 'smith' ? { oblique: SMITH_OBLIQUE } : {}
  const o = { pole, wristBias: WRIST_EXT, planeHint: 30, devBand: JOINT_DEV }
  pressArm(skel, q, { ...target, ...oblique }, o, [lerp(40, 170, c), 60], 3 * c * c)
}

function standFrame(skel: Skeleton, v: Stand, c: number, df: number): Float64Array {
  const q = zeroQ(skel)
  const k = keys(c)
  posture(skel, q, k)
  stand(skel, q, v.stance, { knee: KNEE, df, tilt: tiltOf(k.lean) })
  barArms(skel, q, v, c)
  return q
}

/** ankle angle that puts the system COM (free bar) or the body COM (Smith) over the midfoot */
function balancedDf(skel: Skeleton, v: Stand, c: number): number {
  const load = v.kind === 'bar' ? [{ mass: v.bar.mass, pos: barPose(v, c).pos }] : []
  return secant((df) => centerOfMass(skel, fk(skel, standFrame(skel, v, c, df)), load)[2] - v.stance.midfoot[2], 4, 7, 1e-6, 12)
}

const balancedFrame = (skel: Skeleton, v: Stand, c: number) => standFrame(skel, v, c, balancedDf(skel, v, c))

function standContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const smith = p.implement === 'smith'
  const bar = barbell({ gripWidth: p.gripWidth * skel.data.shoulderWidth, plateKg: BAR_PLATE_KG })
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const v: Stand = { kind: smith ? 'smith' : 'bar', stance, bar, z0: 0, z1: stance.midfoot[2], y0: 0, y1: 0, df: () => 5 }
  const elbow = (q: Float64Array) => q[skel.dof['elbow_l.flex']]
  v.y0 = sitePos(skel, fk(skel, zeroQ(skel)), 'chin')[1] - BAR_BELOW_CHIN
  v.y1 = v.y0 + 0.55
  // bar line at the bottom: as close in front of the neck as the elbows allow (scanned from far to near: close in, the
  // forearm runs out of rotation); lockout height: arms straight
  v.z0 = root1d((z) => {
    v.z0 = z
    return elbow(balancedFrame(skel, v, 0)) - BAR_ELBOW0
  }, v.z1 + 0.22, v.z1 + 0.03, { tol: 1e-5, scan: 12 }).x
  // the Smith's rails are vertical: the bar stays on that line to lockout, a little in front of the head
  if (smith) v.z1 = v.z0
  v.y1 = root1d((y) => {
    v.y1 = y
    return elbow(balancedFrame(skel, v, 1)) - LOCK_ELBOW
  }, v.y0 + 0.35, v.y0 + 0.8, { tol: 1e-5, scan: 6 }).x
  const cs = Array.from({ length: KNOTS }, (_, i) => i / (KNOTS - 1))
  v.df = monotoneCubic(cs, cs.map((c) => balancedDf(skel, v, c)))
  const contacts: Contact[] = [
    ...plantedContacts(skel, v.stance),
    { site: 'grip_l', kind: 'grip', target: { implement: bar.id, grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: bar.id, grip: 'r' } },
  ]
  // the Smith frame is drawn around the bar by the family props (a taller frame than props/smith.ts)
  const setup: Setup = {
    implements: [bar],
    contacts,
    tempo,
    symmetric: true,
    balance: smith ? undefined : { point: 'com', over: 'midfoot', tol: 0.025 },
  }
  return { tempo, setup, v }
}

function sampleStand(u: number, skel: Skeleton, ctx: Ctx, v: Stand): Pose {
  const c = phaseAt(u, ctx.tempo).c
  return { q: standFrame(skel, v, c, v.df(c)), implements: [barPose(v, c)], contacts: ctx.setup.contacts }
}

// ---------- seated ----------

function seatedBody(skel: Skeleton, q: Float64Array, feet: FootTarget[]) {
  setDofs(skel, q, { 'lumbar.flex': -2, 'thorax.flex': 2, 'neck.flex': 0, 'head.flex': 0, 'grip_*.close': 1 })
  setPelvis(skel, q, SEAT_HIP, -4)
  solveLegs(skel, q, feet)
}

function seatedFeet(skel: Skeleton): FootTarget[] {
  const half = skel.segments[skel.seg.femur_l].offset[0] + 0.08
  const z = SEAT_HIP[2] + skel.segments[skel.seg.femur_l].length + 0.12
  return [plantFoot(skel, 'l', [half, 0, z], 14), plantFoot(skel, 'r', [-half, 0, z], 14)]
}

function feetContacts(skel: Skeleton, feet: FootTarget[]): Contact[] {
  const out: Contact[] = []
  for (const ft of feet) for (const site of ['heel', 'ball']) {
    const name = `${site}_${ft.side}`
    out.push({ site: name, kind: 'planted', target: { world: add(ft.ankle, qrot(ft.rot, skel.data.sites[name].local)) } })
  }
  return out
}

/** dumbbell in the left hand, handle across (palm forward), elbow out and down under the hand */
function dbArm(skel: Skeleton, q: Float64Array, pos: V3, c: number) {
  const thorax = fk(skel, q).rot[skel.seg.thorax2]
  const pole = qrot(thorax, norm([1, lerp(-0.6, -0.2, c), lerp(0.25, -0.05, c)]))
  const target = { pos, axis: qrot(thorax, [1, 0, 0]), palm: qrot(thorax, [0, 0.2, 1]) }
  pressArm(skel, q, target, { pole, wristBias: lerp(12, 6, c), planeHint: 30, devBand: JOINT_DEV }, [lerp(80, 160, c), 30], 2 * c * c)
}

function seatedFrame(skel: Skeleton, v: Seated, c: number): { q: Float64Array; implements: ImplementPose[] } {
  const q = v.base ? Float64Array.from(v.base) : zeroQ(skel)
  if (!v.base) seatedBody(skel, q, v.feet)
  if (v.kind === 'db') {
    if (v.turn) turnedArm(skel, q, v.turn, c)
    else dbArm(skel, q, add(scale(v.from!, 1 - c), scale(v.to!, c)), c)
    return { q, implements: [...dumbbellPoses(skel, q), ...(v.benchPose ? [v.benchPose] : [])] }
  }
  const g = v.press!
  const hp = pressHandles.pose(g, lerp(g.angle0, g.angle1, c))
  const s = siteWorld(pressHandles.spec(g), hp, 'l')
  const thorax = fk(skel, q).rot[skel.seg.thorax2]
  const o = { pole: qrot(thorax, norm([1, lerp(-0.55, -0.2, c), lerp(0.3, 0, c)])), wristBias: lerp(20, 8, c), planeHint: 40 }
  pressArm(skel, q, { pos: s.pos, axis: s.axis!, palm: qrot(thorax, [0, 0.4, 1]) }, o, [lerp(70, 150, c), 40], 2 * c * c)
  return { q, implements: [hp, { id: 'shoulder-press', pos: [0, 0, 0], rot: qid() }] }
}

/** the seated body and the upright bench fitted to it */
function seatBench(p: P, skel: Skeleton) {
  const feet = seatedFeet(skel)
  const q = zeroQ(skel)
  seatedBody(skel, q, feet)
  const f = fk(skel, q)
  const pelvis = segPos(skel, f, 'pelvis')
  const neck = segPos(skel, f, 'neck1')
  const up = norm(sub(neck, pelvis))
  const out = norm(qrot(f.rot[skel.seg.thorax2], [0, 0, -1]))
  // seat under the glutes and back pad against the back, resting on the measured body (sinking a little into the pads)
  const caps = bodyCapsules(skel, f)
  const trunk = caps.filter((k) => k.region === 'trunk')
  let hinge = add(add(pelvis, scale(out, 0.15)), scale(up, -0.08))
  const probe = bench({ backAngle: p.benchAngle, seatHeight: hinge[1] })
  const at = (part: Part, h: V3) => ({ ...part, center: add(h, (part as Part & { shape: 'box' }).center) }) as Part & { shape: 'box' }
  const seatPart = at(probe.parts[0], hinge)
  hinge = add(hinge, sub(restAgainst(caps.filter((k) => k.region === 'trunk' || /^thigh_[lr]1/.test(k.name)), seatPart, [0, -1, 0], -0.005).center, seatPart.center))
  const padPart = at(probe.parts[1], hinge)
  hinge = add(hinge, sub(restAgainst(trunk, padPart, out, -0.006).center, padPart.center))
  const benchSpec = bench({ backAngle: p.benchAngle, seatHeight: hinge[1] })
  const benchPose: ImplementPose = { id: benchSpec.id, pos: hinge, rot: qid() }
  return { feet, f, benchSpec, benchPose }
}

function dbContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  if (p.support === 'floor') return floorDbContext(skel, tempo)
  if (p.rotate) return arnoldContext(p, skel, tempo)
  const { feet, f, benchSpec, benchPose } = seatBench(p, skel)
  // grip paths: from ear level beside the head (forearms vertical under the dumbbells) to overhead, hands closing in
  const gh = segPos(skel, f, 'humerus_l')
  const v: Seated = { kind: 'db', feet, benchPose }
  const elbowAt = (at: V3, c: number) => {
    v.from = v.to = at
    return seatedFrame(skel, v, c).q[skel.dof['elbow_l.flex']]
  }
  const [bx, bz] = DB_FROM, [tx, tz] = DB_TO
  const from = add(gh, [bx, root1d((y) => elbowAt(add(gh, [bx, y, bz]), 0) - DB_ELBOW0, 0, 0.4, { tol: 1e-5, scan: 8 }).x, bz])
  const to = add(gh, [tx, root1d((y) => elbowAt(add(gh, [tx, y, tz]), 1) - DB_ELBOW1, 0.35, 0.8, { tol: 1e-5, scan: 8 }).x, tz])
  v.from = from
  v.to = to
  const setup: Setup = {
    implements: [...handDumbbells(DB_KG), benchSpec],
    contacts: [...feetContacts(skel, feet), ...dumbbellContacts()],
    tempo,
    symmetric: true,
  }
  return { tempo, setup, v }
}

function machineContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const feet = seatedFeet(skel)
  const q = zeroQ(skel)
  seatedBody(skel, q, feet)
  const f = fk(skel, q)
  const gh = segPos(skel, f, 'humerus_l')
  const chin = sitePos(skel, f, 'chin')
  // handles start at chin level in front of the shoulders, as far forward as puts the elbows at MACHINE_ELBOW0; the
  // arc's pivot sits behind the seat at that height
  const half = (p.gripWidth * skel.data.shoulderWidth) / 2
  const g: PressGeometry = { pivot: [0, 0, 0], half, arm: PRESS_MACHINE.arm, angle0: 0, angle1: 0, seat: SEAT_HIP[1], back: [0, 0, 0] }
  const v: Seated = { kind: 'machine', feet, press: g }
  const place = (z: number) => {
    g.pivot = [0, chin[1], z - PRESS_MACHINE.arm]
  }
  place(root1d((z) => {
    place(z)
    return seatedFrame(skel, v, 0).q[skel.dof['elbow_l.flex']] - MACHINE_ELBOW0
  }, gh[2] + 0.05, gh[2] + 0.4, { tol: 1e-5, scan: 7 }).x)
  g.angle1 = root1d((a) => {
    g.angle1 = a
    return seatedFrame(skel, v, 1).q[skel.dof['elbow_l.flex']] - MACHINE_ELBOW1
  }, 10, 60, { tol: 1e-5 }).x
  g.back = pressMachineFrame.fit(bodyCapsules(skel, f), g)
  const setup: Setup = {
    implements: [pressHandles.spec(g), pressMachineFrame.spec(g)],
    contacts: [
      ...feetContacts(skel, feet),
      { site: 'grip_l', kind: 'grip', target: { implement: 'handles', grip: 'l' } },
      { site: 'grip_r', kind: 'grip', target: { implement: 'handles', grip: 'r' } },
    ],
    tempo,
    symmetric: true,
  }
  return { tempo, setup, v }
}

function sampleSeated(u: number, skel: Skeleton, ctx: Ctx, v: Seated): Pose {
  const c = phaseAt(u, ctx.tempo).c
  const r = seatedFrame(skel, v, c)
  return { q: r.q, implements: r.implements, contacts: ctx.setup.contacts }
}

// ---------- standing dumbbells ----------

/** trunk lean, deg (negative = back): ribs down, a little back at the bottom, upright at lockout */
const SDB_LEAN: [number, number] = [-3, -1]

/** body standing at ankle dorsiflexion df, dumbbells on a path set relative to the shoulder joint */
function standDbFrame(skel: Skeleton, v: Pick<StandDb, 'stance' | 'from' | 'to'>, c: number, df: number): Float64Array {
  const q = zeroQ(skel)
  const lean = lerp(SDB_LEAN[0], SDB_LEAN[1], c)
  setDofs(skel, q, { 'lumbar.flex': -2 + 0.35 * lean, 'thorax.flex': 0.15 * lean, 'grip_*.close': 1 })
  stand(skel, q, v.stance, { knee: KNEE, df, tilt: tiltOf(lean) })
  const gh = segPos(skel, fk(skel, q), 'humerus_l')
  dbArm(skel, q, add(gh, add(scale(v.from, 1 - c), scale(v.to, c))), c)
  return q
}

function standDbContext(skel: Skeleton, tempo: Tempo): Ctx {
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const v: StandDb = { kind: 'sdb', stance, from: [0, 0, 0], to: [0, 0, 0], df: () => 5 }
  // the seated grip path (ear level to overhead, hands closing in), offsets from the shoulder joint
  const elbowAt = (off: V3, c: number) => {
    v.from = v.to = off
    return standDbFrame(skel, v, c, 5)[skel.dof['elbow_l.flex']]
  }
  const [bx, bz] = DB_FROM, [tx, tz] = DB_TO
  const from: V3 = [bx, root1d((y) => elbowAt([bx, y, bz], 0) - DB_ELBOW0, 0, 0.4, { tol: 1e-5, scan: 8 }).x, bz]
  const to: V3 = [tx, root1d((y) => elbowAt([tx, y, tz], 1) - DB_ELBOW1, 0.35, 0.8, { tol: 1e-5, scan: 8 }).x, tz]
  v.from = from
  v.to = to
  // the ankles put the body and dumbbells' centre of mass over the midfoot
  const com = comWithDumbbells(skel, DB_KG)
  const cs = Array.from({ length: KNOTS }, (_, i) => i / (KNOTS - 1))
  const dfs = cs.map((c) => secant((df) => com(standDbFrame(skel, v, c, df)) - stance.midfoot[2], 4, 7, 1e-6, 12))
  v.df = monotoneCubic(cs, dfs)
  const setup: Setup = {
    implements: handDumbbells(DB_KG),
    contacts: [...plantedContacts(skel, stance), ...dumbbellContacts()],
    tempo,
    symmetric: true,
    balance: { point: 'com', over: 'midfoot', tol: 0.025 },
  }
  return { tempo, setup, v }
}

function sampleStandDb(u: number, skel: Skeleton, ctx: Ctx, v: StandDb): Pose {
  const c = phaseAt(u, ctx.tempo).c
  const q = standDbFrame(skel, v, c, v.df(c))
  return { q, implements: dumbbellPoses(skel, q), contacts: ctx.setup.contacts }
}

// ---------- seated barbell ----------

/** seated on the upright bench: the head goes back while the bar passes the face and through under it at lockout */
function seatedBarFrame(skel: Skeleton, v: SeatedBar, c: number): Float64Array {
  const q = zeroQ(skel)
  seatedBody(skel, q, v.feet)
  const k = keys(c)
  setDofs(skel, q, { 'neck.flex': -18 * k.back + 10 * k.through, 'head.flex': 13 * k.back - 5 * k.through })
  barArms(skel, q, v, c)
  return q
}

function seatedBarContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const { feet, f, benchSpec, benchPose } = seatBench(p, skel)
  const bar = barbell({ gripWidth: p.gripWidth * skel.data.shoulderWidth, plateKg: BAR_PLATE_KG })
  const gh = segPos(skel, f, 'humerus_l')
  const y0 = sitePos(skel, f, 'chin')[1] - BAR_BELOW_CHIN
  const v: SeatedBar = { seatedBar: true, kind: 'bar', bar, feet, benchPose, z0: 0, z1: gh[2], y0, y1: y0 + 0.55 }
  const elbow = (c: number) => seatedBarFrame(skel, v, c)[skel.dof['elbow_l.flex']]
  // as standing: the bar starts as close in front of the neck as the elbows allow and locks out over the shoulders
  v.z0 = root1d((z) => {
    v.z0 = z
    return elbow(0) - BAR_ELBOW0
  }, gh[2] + 0.25, gh[2] + 0.06, { tol: 1e-5, scan: 12 }).x
  v.y1 = root1d((y) => {
    v.y1 = y
    return elbow(1) - LOCK_ELBOW
  }, y0 + 0.35, y0 + 0.8, { tol: 1e-5, scan: 6 }).x
  const setup: Setup = {
    implements: [bar, benchSpec],
    contacts: [
      ...feetContacts(skel, feet),
      { site: 'grip_l', kind: 'grip', target: { implement: bar.id, grip: 'l' } },
      { site: 'grip_r', kind: 'grip', target: { implement: bar.id, grip: 'r' } },
    ],
    tempo,
    symmetric: true,
  }
  return { tempo, setup, v }
}

function sampleSeatedBar(u: number, skel: Skeleton, ctx: Ctx, v: SeatedBar): Pose {
  const c = phaseAt(u, ctx.tempo).c
  return { q: seatedBarFrame(skel, v, c), implements: [barPose(v, c), v.benchPose], contacts: ctx.setup.contacts }
}

// ---------- turned grips: Arnold press, kettlebell, band; Z press ----------

/**
 * Arnold and kettlebell presses in joint space (the hand follows the arm, the load follows the hand): the humerus
 * rises from `elev[0]` to `elev[1]` deg while its plane swings from `plane[0]` (in front) towards the side, both linear in
 * contraction, the elbow
 * opens so the forearm stays about vertical (flexion 180 - elevation, capped at `elbow0`), and the palm turns about
 * the trunk's long axis by phi (thorax frame, left hand: 0 = palm to the face, 90 = palm in, 180 = palm forward),
 * the turn done by `until` of the press; `lean`: the forearm starts that far past vertical towards the face
 * (Arnold), easing out as the palms turn; `inward`: the forearm starts that far (deg) tilted in towards the midline
 * (the kettlebell rack, the fist under the chin), easing out the same way. The rig's forearm supinates to 90, so "palms to the face" starts a little
 * short of full supination. Research: humeral elevation ~165-175 and elbow ~0-10 at
 * lockout (motion-authoring research, as the other overhead presses).
 */
type Turn = { phi: [number, number]; plane: [number, number]; elev: [number, number]; elbow0: number; until: number; wrist: number; lean?: number; inward?: number }

/** Arnold press: elbows in front, the dumbbells before the chin, palms to the face; the elbows sweep out as the palms turn */
const ARNOLD: Turn = { phi: [18, 180], plane: [88, 22], elev: [52, 172], elbow0: 140, until: 0.9, wrist: 6, lean: 12 }
const ARNOLD_KG = 12
/** kettlebell: from the rack (palm in, the fist under the chin near the midline, the forearm tilted in, the elbow down in
 * front of the ribs, the bell on the back of the forearm against the upper arm and chest) to a lockout beside the ear,
 * palm forward */
const KB_TURN: Turn = { phi: [90, 180], plane: [90, 26], elev: [32, 172], elbow0: 145, until: 0.85, wrist: 0, inward: 36 }
/** band: palms forward from the front of the shoulders, elbows down and a little out, to overhead */
const BAND_TURN: Turn = { phi: [180, 180], plane: [50, 25], elev: [40, 172], elbow0: 140, until: 1, wrist: 8 }
/** band under the feet: where the strip crosses under each sole from the midfoot, m: the inner point under the sole, the
 * outer one just past the sole's edge, so the strip comes down beside the foot */
const BAND_SOLE = { in: 0.04, out: 0.052 }
/** where the strip passes the arm: how close (m) the straight run comes to it before the node moves in front of the
 * elbow, and how far in front of the elbow joint it then sits, m */
const BAND_FRONT = { near: 0.03, elbow: 0.075 }
/** sitting on the floor (Z press): pelvis tilt, hip abduction and ankle angle, deg; sink into the floor, m */
const FLOOR_SIT = { tilt: -4, abd: 5, ankle: -12, sink: 0.003 }

type BandRig = { handles: [ImplementSpec, ImplementSpec]; soles: [ImplementPose, ImplementPose] }

/** standing kettlebell or band press */
type StandTurn = { kind: 'turn'; stance: StanceSetup; df: (c: number) => number; turn: Turn; work: 'l' | 'r' | null; kb?: ImplementSpec; band?: BandRig }

/** grip ends from the shoulder joint: lateral and forward offsets given, the height that gives each end's elbow flexion */
function gripEnds(elbowAt: (off: V3, c: number) => number, from: number[], elbow0: number, to: number[]): [V3, V3] {
  const [bx, bz] = from, [tx, tz] = to
  const a: V3 = [bx, root1d((y) => elbowAt([bx, y, bz], 0) - elbow0, -0.15, 0.4, { tol: 1e-5, scan: 11 }).x, bz]
  const b: V3 = [tx, root1d((y) => elbowAt([tx, y, tz], 1) - DB_ELBOW1, 0.35, 0.8, { tol: 1e-5, scan: 8 }).x, tz]
  return [a, b]
}

/** left arm in joint space for contraction c, right mirrored */
function turnedArm(skel: Skeleton, q: Float64Array, t: Turn, c: number) {
  const fr = thoraxFrame(skel, q)
  const thorax = fk(skel, q).rot[skel.seg.thorax2]
  const w = ramp(c, 0, t.until)
  const elev = lerp(t.elev[0], t.elev[1], c)
  const palm = qrot(thorax, qrot(qaxis([0, 1, 0], lerp(t.phi[0], t.phi[1], w) * DEG), [0, 0, -1]))
  const elbow = Math.min(t.elbow0, 180 - elev + (t.lean ?? 0) * (1 - w))
  const bend = t.inward ? norm(add(fr.up, scale(fr.right, Math.tan(t.inward * (1 - w) * DEG)))) : fr.up
  poseArm(skel, q, 'l', { plane: lerp(t.plane[0], t.plane[1], c), elev, elbow, bend, palm, wrist: t.wrist })
  mirrorIsoArm(skel, q)
}

function arnoldContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const { feet, benchSpec, benchPose } = seatBench(p, skel)
  const v: Seated = { kind: 'db', feet, benchPose, turn: ARNOLD }
  const setup: Setup = {
    implements: [...handDumbbells(ARNOLD_KG), benchSpec],
    contacts: [...feetContacts(skel, feet), ...dumbbellContacts()],
    tempo,
    symmetric: true,
  }
  return { tempo, setup, v }
}

/** sitting on the floor, legs straight and a little apart, trunk upright: the butt and the heels on the floor */
function floorSit(skel: Skeleton): Float64Array {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': -2, 'thorax.flex': 2, 'neck.flex': 0, 'head.flex': 0, 'grip_*.close': 1, 'hip_*.abd': FLOOR_SIT.abd, 'knee_*.flex': 2, 'ankle_*.df': FLOOR_SIT.ankle })
  const low = (re: RegExp) => Math.min(...bodyCapsules(skel, fk(skel, q)).filter((c) => re.test(c.segment)).map((c) => Math.min(c.a[1], c.b[1]) - c.r))
  const res = (x: number[]) => {
    setDofs(skel, q, { 'hip_*.flex': 90 + FLOOR_SIT.tilt - x[1] })
    setPelvis(skel, q, [0, x[0], 0], FLOOR_SIT.tilt)
    return [(low(/^pelvis$/) + FLOOR_SIT.sink) * 100, (low(/^(tibia|talus|calcn|foot)_l/) + FLOOR_SIT.sink) * 100]
  }
  const r = dls(res, [0.12, 3], { tol: 1e-8, iters: 60 })
  res(r.x)
  return q
}

function floorDbContext(skel: Skeleton, tempo: Tempo): Ctx {
  const base = floorSit(skel)
  const gh = segPos(skel, fk(skel, base), 'humerus_l')
  const v: Seated = { kind: 'db', feet: [], base }
  const elbowAt = (off: V3, c: number) => {
    v.from = v.to = add(gh, off)
    return seatedFrame(skel, v, c).q[skel.dof['elbow_l.flex']]
  }
  const [from, to] = gripEnds(elbowAt, DB_FROM, DB_ELBOW0, DB_TO)
  v.from = add(gh, from)
  v.to = add(gh, to)
  const setup: Setup = { implements: handDumbbells(DB_KG), contacts: dumbbellContacts(), tempo, symmetric: true }
  return { tempo, setup, v }
}

/** standing kettlebell or band press at ankle dorsiflexion df; one-arm work relaxes the free arm */
function turnStandFrame(skel: Skeleton, v: Pick<StandTurn, 'stance' | 'turn' | 'work'>, c: number, df: number): Float64Array {
  const q = zeroQ(skel)
  const lean = lerp(SDB_LEAN[0], SDB_LEAN[1], c)
  setDofs(skel, q, { 'lumbar.flex': -2 + 0.35 * lean, 'thorax.flex': 0.15 * lean, 'grip_*.close': 1 })
  stand(skel, q, v.stance, { knee: KNEE, df, tilt: tiltOf(lean) })
  turnedArm(skel, q, v.turn, c)
  if (v.work) {
    const s = v.work === 'l' ? 'r' : 'l'
    for (const k of ['clavicle_*.elev', 'clavicle_*.prot', 'shoulder_*.rot', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']) q[skel.dof[k.replace('*', s)]] = 0
    relaxedArm(skel, q, s)
  }
  return q
}

/** where the band leaves each sole (left first): the midfoot, the strip across it */
function soles(skel: Skeleton, stance: StanceSetup): [ImplementPose, ImplementPose] {
  return stance.feet.map((ft) => ({ id: `sole_${ft.side}`, pos: add(add(ft.ankle, qrot(ft.rot, skel.data.sites[`midfoot_${ft.side}`].local)), [0, 0.002, 0]) as V3, rot: ft.rot })) as [ImplementPose, ImplementPose]
}

/**
 * Band handle poses, and the points where the strips pass the arm on their way down to the soles: on the straight line
 * from the handle's ring to the outer edge of the sole while that keeps clear of the arm, moving to a point in front of
 * the elbow as it nears the arm (a smooth blend on the line's clearance), then only as far forward as the arm, trunk
 * and legs need, checked every frame
 */
function bandPoses(skel: Skeleton, f: ReturnType<typeof fk>, rig: BandRig): ImplementPose[] {
  const out: ImplementPose[] = []
  const caps = bodyCapsules(skel, f)
  const fwd = qrot(f.rot[skel.seg.thorax2], [0, 0, 1])
  for (const [k, s] of (['l', 'r'] as const).entries()) {
    const h = handFrame(skel, f, s)
    const sole = add(rig.soles[k].pos, qrot(rig.soles[k].rot, [s === 'l' ? BAND_SOLE.out : -BAND_SOLE.out, 0, 0]))
    // the ring hangs below the fist on the palm side, so the straps straddle the hand
    const handle = poseHandle(rig.handles[k], 'c', h.pos, h.axis, add(h.pos, add(norm(sub(sole, h.pos)), scale(h.palm, 0.6))))
    const ring = handle.pos
    const arm = caps.filter((c) => [`upperarm_${s}`, `forearm_${s}`, `girdle_${s}`].includes(c.region))
    // the strip meets the floor beside the foot, so the foot is left out (the outer sole point clears it)
    const body = caps.filter((c) => !/^(hand|foot)/.test(c.region) && !c.region.endsWith(s === 'l' ? '_r' : '_l'))
    const elbow = segPos(skel, f, `forearm_${s}`)
    const w = smooth((BAND_FRONT.near - runClearance(arm, ring, sole)) / BAND_FRONT.near)
    const base = lerp3(closestOn(ring, sole, elbow), add(elbow, scale(fwd, BAND_FRONT.elbow)), w)
    out.push(handle, { id: `front_${s}`, pos: clearNode(body, ring, sole, base, fwd), rot: qid() })
  }
  return out
}

const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

function turnStandContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const kb = p.implement === 'kettlebell'
  const work = kb ? (p.side === 'left' ? 'l' : 'r') : null
  const v: StandTurn = { kind: 'turn', stance, df: () => 5, turn: kb ? KB_TURN : BAND_TURN, work }
  const contacts: Contact[] = [...plantedContacts(skel, stance)]
  const implements_: ImplementSpec[] = []
  let rests: Setup['rests']
  if (work) {
    v.kb = kettlebells([work])[0]
    implements_.push(v.kb)
    contacts.push(...kbContacts([work]))
    rests = kbRests([work], true)
  } else {
    const handles: [ImplementSpec, ImplementSpec] = [bandHandle({ id: 'handle_l' }), bandHandle({ id: 'handle_r' })]
    v.band = { handles, soles: soles(skel, stance) }
    const sole = (s: 'l' | 'r', x: number) => ({ implement: `sole_${s}`, at: [x, 0, 0] as V3, face: [0, -1, 0] as V3 })
    // the strip faces forward down the front of the body
    const front = (s: 'l' | 'r') => ({ implement: `front_${s}`, face: [0, 0, 1] as V3 })
    implements_.push(...handles, bandNode('sole_l'), bandNode('sole_r'), bandNode('front_l'), bandNode('front_r'))
    implements_.push(band({
      path: [{ implement: 'handle_l', site: 'ring' }, front('l'), sole('l', BAND_SOLE.out), sole('l', -BAND_SOLE.in), sole('r', BAND_SOLE.in), sole('r', -BAND_SOLE.out), front('r'), { implement: 'handle_r', site: 'ring' }],
    }))
    contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: 'handle_l', grip: 'c' } }, { site: 'grip_r', kind: 'grip', target: { implement: 'handle_r', grip: 'c' } })
  }
  // the ankles put the body and the bell's centre of mass over the midfoot
  const com = (q: Float64Array) => {
    const f = fk(skel, q)
    const loads = v.kb && work ? [{ mass: KB_KG, pos: comWorld(v.kb, kbInHand(skel, f, work, v.kb, true)) }] : []
    return centerOfMass(skel, f, loads)[2]
  }
  const cs = Array.from({ length: KNOTS }, (_, i) => i / (KNOTS - 1))
  v.df = monotoneCubic(cs, cs.map((c) => secant((df) => com(turnStandFrame(skel, v, c, df)) - stance.midfoot[2], 4, 7, 1e-6, 12)))
  const setup: Setup = {
    implements: implements_,
    contacts,
    tempo,
    symmetric: !work,
    balance: { point: 'com', over: 'midfoot', tol: 0.025 },
    ...(rests ? { rests } : {}),
  }
  return { tempo, setup, v }
}

function sampleTurnStand(u: number, skel: Skeleton, ctx: Ctx, v: StandTurn): Pose {
  const c = phaseAt(u, ctx.tempo).c
  const q = turnStandFrame(skel, v, c, v.df(c))
  const f = fk(skel, q)
  const implements_: ImplementPose[] = []
  if (v.kb && v.work) implements_.push(kbInHand(skel, f, v.work, v.kb, true))
  if (v.band) implements_.push(...bandPoses(skel, f, v.band), ...v.band.soles, bandPose())
  return { q, implements: implements_, contacts: ctx.setup.contacts }
}

const context = memo((p: P, skel: Skeleton): Ctx => {
  const why = unsupported(p)
  if (why) throw new Error(`vertical-press: variant not implemented yet (${why})`)
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.posture === 'standing' && (p.implement === 'kettlebell' || p.implement === 'band')) return turnStandContext(p, skel, tempo)
  if (p.posture === 'standing') return p.implement === 'dumbbell' ? standDbContext(skel, tempo) : standContext(p, skel, tempo)
  if (p.implement === 'barbell') return seatedBarContext(p, skel, tempo)
  return p.implement === 'dumbbell' ? dbContext(p, skel, tempo) : machineContext(p, skel, tempo)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const v = ctx.v
  if ('seatedBar' in v) return sampleSeatedBar(u, skel, ctx, v)
  if (v.kind === 'turn') return sampleTurnStand(u, skel, ctx, v)
  if (v.kind === 'sdb') return sampleStandDb(u, skel, ctx, v)
  return 'stance' in v ? sampleStand(u, skel, ctx, v) : sampleSeated(u, skel, ctx, v)
}

/** landmine press, one hand (press-landmine.ts): standing staggered or half kneeling */
const landmineCtx = memo((p: P, skel: Skeleton): LandmineCtx => {
  if (p.laterality !== 'unilateral' || (p.posture !== 'standing' && p.posture !== 'kneeling')) throw new Error(`vertical-press: variant not implemented yet (landmine ${p.posture} ${p.laterality})`)
  return landmineContext({ hands: 'one', base: p.posture === 'kneeling' ? 'half_kneel' : 'split', side: p.side }, skel, p.tempo ?? DEFAULT_TEMPO)
})

export const verticalPress: Template<P> = {
  id: 'vertical-press',
  driver: 'implement',
  params: SCHEMAS['vertical-press'],
  implemented: true,
  setup: (p, skel) => (p.implement === 'landmine' ? landmineCtx(p, skel).setup : context(p, skel).setup),
  sample: (u, p, skel) => (p.implement === 'landmine' ? sampleLandmine(u, skel, landmineCtx(p, skel)) : sample(u, p, skel)),
}

/** internals for the unit tests */
export const _verticalPress = { context, ARNOLD, KB_TURN, BAND_TURN }
