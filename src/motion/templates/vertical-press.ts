import { attachHand, plantFoot, root1d, solveLegs, type FootTarget } from '../constraints.ts'
import { bodyCapsules, restAgainst } from '../collide.ts'
import { centerOfMass, fk, segPos, sitePos } from '../fk.ts'
import { barbell, bench, siteWorld, type ImplementSpec, type Part } from '../implements.ts'
import { pressHandles, PRESS_MACHINE, pressMachineFrame, type PressGeometry } from '../implements/press-vertical-bodyweight.ts'
import { add, lerp, norm, qid, qrot, scale, sub, type V3 } from '../math.ts'
import { setDofs, shoulderRhythm, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, minJerk, phaseAt, type Tempo } from '../timing.ts'
import { dumbbellContacts, dumbbellPoses, handDumbbells } from './arms.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { monotoneCubic, secant } from './solve.ts'
import { makeStance, plantedContacts, setPelvis, stand, stanceWidth, type StanceSetup } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Vertical press, implement driver: the bar (or handle) path is keyed and the arms are solved onto it.
// Standing barbell: the bar rises straight up in front of the face, then drifts back over the midfoot once past the
// forehead, while the whole body balances over the feet (ankle lean keeps the system COM over the midfoot). The
// lifter starts leaning back a little with the bar just below the chin, keeps the head back while the bar passes the
// face, then brings the chest and head through under the bar at lockout. Smith: one vertical line on the rails, the
// body balancing alone. Seated dumbbells: from ear level to overhead, the hands closing in slightly. Machine: the
// handles swing up on an arc about a pivot behind the seat. Endpoints: humeral elevation ~40-60 deg at the bottom to
// ~165-175 at lockout, elbow flexion bottom ~95-140 to ~0-10 (motion-authoring research: Evangelista 2025 two-link
// OHP model; author judgment for the rest).

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

type Seated = {
  kind: 'db' | 'machine'
  feet: FootTarget[]
  benchPose?: ImplementPose
  /** dumbbells: grip paths per side (left), world */
  from?: V3
  to?: V3
  press?: PressGeometry
}

type Ctx = { tempo: Tempo; setup: Setup; v: Stand | Seated }

const ramp = (c: number, a: number, b: number) => minJerk((c - a) / (b - a))

const ARM = ['scapula_*.uprot', 'clavicle_*.elev', 'clavicle_*.prot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev', 'grip_*.close']

function mirrorArm(skel: Skeleton, q: Float64Array) {
  for (const k of ARM) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

function unsupported(p: P) {
  if (p.laterality !== 'bilateral') return `laterality ${p.laterality}`
  if (p.implement === 'barbell' && p.posture === 'standing') return null
  if (p.implement === 'smith' && p.posture === 'standing') return null
  if (p.implement === 'dumbbell' && p.posture === 'seated') return null
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
function barPose(v: Stand, c: number): ImplementPose {
  return { id: v.bar.id, pos: [0, lerp(v.y0, v.y1, c), lerp(v.z0, v.z1, ramp(c, BAR_BACK[0], BAR_BACK[1]))], rot: qid() }
}

/** hands onto the bar: elbows down and a little out in front at the bottom, out to the sides at lockout (the pole
 * stays well off the shoulder-wrist line, so the elbow's swivel is well conditioned) */
function barArms(skel: Skeleton, q: Float64Array, v: Stand, c: number) {
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
  const q = zeroQ(skel)
  seatedBody(skel, q, v.feet)
  if (v.kind === 'db') {
    dbArm(skel, q, add(scale(v.from!, 1 - c), scale(v.to!, c)), c)
    return { q, implements: [...dumbbellPoses(skel, q), v.benchPose!] }
  }
  const g = v.press!
  const hp = pressHandles.pose(g, lerp(g.angle0, g.angle1, c))
  const s = siteWorld(pressHandles.spec(g), hp, 'l')
  const thorax = fk(skel, q).rot[skel.seg.thorax2]
  const o = { pole: qrot(thorax, norm([1, lerp(-0.55, -0.2, c), lerp(0.3, 0, c)])), wristBias: lerp(20, 8, c), planeHint: 40 }
  pressArm(skel, q, { pos: s.pos, axis: s.axis!, palm: qrot(thorax, [0, 0.4, 1]) }, o, [lerp(70, 150, c), 40], 2 * c * c)
  return { q, implements: [hp, { id: 'shoulder-press', pos: [0, 0, 0], rot: qid() }] }
}

function dbContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
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

const context = memo((p: P, skel: Skeleton): Ctx => {
  const why = unsupported(p)
  if (why) throw new Error(`vertical-press: variant not implemented yet (${why})`)
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.posture === 'standing') return standContext(p, skel, tempo)
  return p.implement === 'dumbbell' ? dbContext(p, skel, tempo) : machineContext(p, skel, tempo)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const v = ctx.v
  return 'stance' in v ? sampleStand(u, skel, ctx, v) : sampleSeated(u, skel, ctx, v)
}

export const verticalPress: Template<P> = {
  id: 'vertical-press',
  driver: 'implement',
  params: SCHEMAS['vertical-press'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
