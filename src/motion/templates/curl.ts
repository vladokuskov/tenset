import { attachHand, handFrame, plantFoot, root1d, solveLegs, type FootTarget } from '../constraints.ts'
import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts, restAgainst } from '../collide.ts'
import { centerOfMass, centerOfPressure, fk, segPos, sitePos } from '../fk.ts'
import { barbell, bench, cableForce, cableHandle, comWorld, ezBar, siteWorld, type ImplementSpec, type Part } from '../implements.ts'
import { add, clamp, cross, DEG, dot, len, lerp, norm, qaxis, qconj, qfromBasis, qfromTo, qid, qmul, qrot, RAD, scale, sub, type V3 } from '../math.ts'
import { setDofs, setScapula, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, minJerk, phaseAt, type Tempo } from '../timing.ts'
import { comWithDumbbells, dumbbellContacts, dumbbellPoses, handDumbbells, isWorking, sidePhase } from './arms.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { ARM_BALANCE_TOL, limitSway, makeStance, plantedContacts, setPelvis, stanceWidth, standBalanced, type StanceSetup, type Sway } from './standing.ts'
import { footContacts, splitStance, standSplit, type SplitStance } from './isolation.ts'
import { memo, type Setup, type Template } from './types.ts'

// Elbow flexion ~8 -> 140 deg with the upper arm quiet (a few degrees of forward drift near the top, no shoulder
// swing or shrug). Dumbbells: joint space, forearm rotation from the grip (optionally supinating from neutral early
// in the concentric). Bars, EZ bar and cable attachments: the grip centre follows the same arm path and both hands
// are solved onto the implement. Incline (seated) and spider (prone) curls keep the upper arm vertical in the world,
// which puts it behind or in front of the torso by the bench angle. Standing variants balance body + load over the
// midfoot with the ankles.

type P = ParamsOf<'curl'>

const DB_KG = 12
const ELBOW: [number, number] = [8, 140]
/** spider curl: the forearm would hit the pad beyond this */
const SPIDER_TOP = 125
/** incline curl: the dumbbells would reach the front delts beyond this */
const INCLINE_TOP = 130
/** upper-arm forward drift at the top, deg; the spider pad holds the arm still */
const DRIFT = 10
const SPIDER_DRIFT = 2
/**
 * standing dumbbells: upper arm a little out from the side, deg. The elbow carrying angle now swings the forearm and
 * dumbbell clear of the thigh; this only covers the rest of the plate radius.
 */
const DB_ABD = 4
/**
 * bars and cable attachments at the bottom: hang just in front of the thighs (capsule clearance, m). The loop keeps at
 * least THIGH_CLEAR mm (v1.1 decision); the bottom target sits higher because the sway and the final elbow angle move
 * the bar up to 7 mm closer
 */
const BAR_OFF_THIGHS = 0.018
const THIGH_CLEAR = 10
const FOREARMS_OFF_BELLY = -0.004
/** bars and cable attachments: elbows pointed out from the side, deg, so they sit beside the ribs, not on them */
const BAR_ABD = 20
/** the EZ bar's inner (semi-supinated) grips sit inside shoulder width, so the elbows need more room */
const EZ_ABD = 36
const ROPE_ABD = 30
/** cable stack load for the balance, kg */
const CABLE_KG = 15
const FOREARM: Record<P['grip'], number> = { supinated: -80, neutral: 0, pronated: 75 }
const SEAT_HIP: V3 = [0, 0.56, 0]
const SPIDER_HIP: V3 = [0, 0.9, 0]
/** spider curl chest pad length, m */
const SPIDER_PAD = 0.36
/** incline curl: upper arms a little out from the side so the dumbbells pass outside the hips, deg */
const INCLINE_ABD = 16
/** wide barbell curl: grips past this get the reference arm abducted by WIDE_ABD, deg */
const WIDE_GRIP = 1.2
const WIDE_ABD = 6

type Body = 'stand' | 'incline' | 'spider'

/** wide barbell grip: the reference arm hangs out this far, so the hands reach the bar at the bottom */
const wideBar = (p: P) => p.implement === 'barbell' && p.gripWidth > WIDE_GRIP

/** close EZ curl grip: below this gripWidth the upper arms sit CLOSE_FLEX further forward at the bottom, deg */
const CLOSE_EZ = 0.9
const CLOSE_FLEX = 12
/** share of CLOSE_FLEX gone by the top (the drift near the top brings the elbows forward anyway) */
const CLOSE_FADE = 0.3
/** close EZ curl: the real elbows stop this bent at the bottom, so they stay beside the ribs while the forearms angle in, deg */
const CLOSE_BOTTOM = 19
/** close EZ curl: the elbows sit a little in front of the trunk, so the forearms converge on the bar without the upper arms pressing into the ribs */
const closeEz = (p: P) => p.implement === 'ez_bar' && p.grip !== 'pronated' && p.gripWidth < CLOSE_EZ

type Ctx = {
  tempo: Tempo
  setup: Setup
  body: Body
  stance?: StanceSetup
  feet?: FootTarget[]
  /** rope: the strands bend at the fist, so the hands keep the reference orientation instead of lining up with them */
  bar?: { spec: ImplementSpec; sites: [string, string]; pulley?: V3; cable: boolean; grip: P['grip']; rope?: boolean }
  benchPose?: ImplementPose
  barBottom?: number
  /** bars: upper-arm lean at the bottom so the bar rests on the thighs, deg (fades out by the top) */
  barLean?: number
  measure?: (q: Float64Array) => number
  sway?: Sway
  /** Bayesian curl: one hand on a single handle, the low pulley behind the lifter */
  behind?: { work: 'l' | 'r'; pulley: V3; handle: ImplementSpec; split: SplitStance }
}

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })

function bodyOf(p: P): Body {
  if (p.posture === 'seated') return 'incline'
  if (p.posture === 'lying_prone') return 'spider'
  return 'stand'
}

/** Bayesian curl: facing away from a low pulley, one arm drawn behind the body by the cable */
const isBehind = (p: P) => p.implement === 'cable' && p.attachment === 'single_handle' && p.laterality === 'unilateral' && (p.shoulderFlexion ?? 0) < 0

function unsupported(p: P) {
  if (p.implement !== 'dumbbell' && p.posture !== 'standing') return `${p.implement}/${p.posture}`
  if (p.implement === 'cable' && p.attachment !== 'straight_bar' && p.attachment !== 'rope' && !isBehind(p)) return `cable ${p.attachment ?? 'no attachment'}`
  return null
}

/** reclined back (incline) or chest on the pad (spider): trunk angle from vertical, deg (+ forward) */
function trunkAngle(p: P, body: Body) {
  const a = p.benchAngle ?? 45
  return body === 'incline' ? -(90 - a) : body === 'spider' ? 90 - a : 0
}

// ---------- bodies ----------

function supportedBody(skel: Skeleton, q: Float64Array, p: P, ctx: Pick<Ctx, 'body' | 'feet'>) {
  const t = trunkAngle(p, ctx.body)
  setDofs(skel, q, { 'lumbar.flex': 2, 'thorax.flex': 4, 'neck.flex': ctx.body === 'spider' ? -25 : 10, 'head.flex': ctx.body === 'spider' ? -10 : 0 })
  setPelvis(skel, q, ctx.body === 'spider' ? SPIDER_HIP : SEAT_HIP, t - 6)
  solveLegs(skel, q, ctx.feet!)
}

function supportedContext(p: P, skel: Skeleton, body: Body) {
  const hip = body === 'spider' ? SPIDER_HIP : SEAT_HIP
  const half = skel.segments[skel.seg.femur_l].offset[0] + (body === 'spider' ? 0.08 : 0.06)
  const z = body === 'spider' ? hip[2] - 0.12 : hip[2] + skel.segments[skel.seg.femur_l].length + 0.1
  const feet = [plantFoot(skel, 'l', [half, 0, z], 12), plantFoot(skel, 'r', [-half, 0, z], 12)]
  const q = zeroQ(skel)
  supportedBody(skel, q, p, { body, feet })
  const f = fk(skel, q)
  // pad along the trunk: behind the back (incline) or under the chest with its top edge at the armpits (spider)
  const pelvis = segPos(skel, f, 'pelvis')
  const neck = segPos(skel, f, 'neck1')
  const up = norm(sub(neck, pelvis))
  const out = norm(qrot(f.rot[skel.seg.thorax2], [0, 0, body === 'spider' ? 1 : -1]))
  const a = p.benchAngle ?? 45
  let spec: ImplementSpec
  let pose: ImplementPose
  if (body === 'incline') {
    const hinge = add(add(pelvis, scale(out, 0.15)), scale(up, -0.08))
    spec = bench({ backAngle: a, seatHeight: hinge[1] })
    pose = { id: spec.id, pos: hinge, rot: qid() }
  } else {
    // chest pad from the armpits down to the waist, so the thighs pass under its lower end
    const gh = scale(add(segPos(skel, f, 'humerus_l'), segPos(skel, f, 'humerus_r')), 0.5)
    const top = add(add(gh, scale(out, 0.14)), scale(up, -0.06))
    const hinge = sub(top, scale(up, SPIDER_PAD))
    spec = bench({ backAngle: a, seatHeight: hinge[1], backLength: SPIDER_PAD, seat: false })
    // the pad rises towards +Z, so the lifter faces it from the seat end; it rests against the measured chest
    const rot = qaxis([0, 1, 0], Math.PI)
    const trunkCaps = bodyCapsules(skel, f).filter((c) => c.region === 'trunk')
    const padPart = spec.parts[0] as Part & { shape: 'box' }
    const world: Part & { shape: 'box' } = { ...padPart, center: add(hinge, qrot(rot, padPart.center)), rot: qmul(rot, padPart.rot!) }
    const placed = restAgainst(trunkCaps, world, scale(out, 1))
    pose = { id: spec.id, pos: add(hinge, sub(placed.center, world.center)), rot }
  }
  const contacts: Contact[] = []
  for (const ft of feet) for (const site of ['heel', 'ball']) {
    const name = `${site}_${ft.side}`
    contacts.push({ site: name, kind: 'planted', target: { world: add(ft.ankle, qrot(ft.rot, skel.data.sites[name].local)) } })
  }
  return { feet, bench: spec, benchPose: pose, contacts }
}

// ---------- arms ----------

/**
 * Humerus direction for elbow phase c: vertical in the world (drifting forward near the top) or, with
 * shoulderFlexion, fixed relative to the torso. Returns plane/elev relative to the thorax.
 */
function upperArm(skel: Skeleton, q: Float64Array, p: P, side: 'l' | 'r', cl: number, abd = 0, lean = 0) {
  const drift = (p.posture === 'lying_prone' ? SPIDER_DRIFT : DRIFT) * cl * cl
  const thorax = fk(skel, q).rot[skel.seg.thorax2]
  const sa = Math.sin(abd * DEG) * (side === 'l' ? 1 : -1)
  const ca = Math.cos(abd * DEG)
  let d: V3
  if (p.shoulderFlexion !== undefined) {
    const a = (p.shoulderFlexion + drift) * DEG
    d = [sa, -Math.cos(a) * ca, Math.sin(a) * ca]
  } else {
    const a = (drift + lean) * DEG
    d = qrot(qconj(thorax), [sa, -Math.cos(a) * ca, Math.sin(a) * ca])
  }
  const m = side === 'l' ? d : ([-d[0], d[1], d[2]] as V3)
  const elev = Math.acos(clamp(-m[1], -1, 1)) * RAD
  // sagittal humerus: plane is +90 (in front of the torso) or -90 (behind); near vertical keep a forward plane
  const plane = elev < 2 ? 90 : Math.atan2(m[2], Math.max(0, m[0])) * RAD
  return { plane, elev }
}

function forearm(p: P, cl: number) {
  if (p.supinate && p.implement === 'dumbbell') return lerp(0, FOREARM.supinated, minJerk(cl / 0.8))
  return FOREARM[p.grip]
}

function topElbow(body: Body) {
  return body === 'spider' ? SPIDER_TOP : body === 'incline' ? INCLINE_TOP : ELBOW[1]
}

/** c drives the elbow; cl (slightly lagged) the upper-arm drift and forearm rotation */
function dbArm(skel: Skeleton, q: Float64Array, side: 'l' | 'r', c: number, cl: number, p: P, body: Body, bottom = ELBOW[0], lean = 0) {
  const d = skel.dof
  const abd = body === 'incline' ? INCLINE_ABD : body === 'stand' && p.implement === 'dumbbell' ? DB_ABD : wideBar(p) ? WIDE_ABD : 0
  const ua = upperArm(skel, q, p, side, cl, abd, lean * (1 - c) + (body === 'stand' && closeEz(p) ? CLOSE_FLEX * (1 - CLOSE_FADE * c) : 0))
  q[d[`shoulder_${side}.plane`]] = ua.plane
  q[d[`shoulder_${side}.elev`]] = ua.elev
  q[d[`shoulder_${side}.rot`]] = 0
  q[d[`elbow_${side}.flex`]] = lerp(bottom, isBehind(p) ? BEHIND_TOP : topElbow(body), c)
  q[d[`forearm_${side}.pro`]] = forearm(p, cl)
  q[d[`wrist_${side}.flex`]] = 6 * c
  q[d[`clavicle_${side}.prot`]] = -3
  q[d[`clavicle_${side}.elev`]] = 0
  q[d[`grip_${side}.close`]] = 1
  setScapula(skel, q, side)
}

// ---------- bars and cable attachments ----------

function ropeSpec(): ImplementSpec {
  const base = cableHandle({ id: 'handle', attachment: 'rope' })
  // the lifter pulls the rope ends apart: hands a little narrower than the shoulders
  const x = 0.28, y = 0.3
  return {
    ...base,
    parts: [cyl([0, 0, 0], [x, -y, 0], 0.012), cyl([0, 0, 0], [-x, -y, 0], 0.012)],
    sites: { l: { pos: [x * 0.87, -y * 0.87, 0], axis: norm([x, -y, 0]) }, r: { pos: [-x * 0.87, -y * 0.87, 0], axis: norm([-x, -y, 0]) } },
  }
}

function barSetup(p: P, skel: Skeleton): NonNullable<Ctx['bar']> {
  const g = (p.gripWidth * skel.data.shoulderWidth) / 2
  if (p.implement === 'barbell') return { spec: barbell({ gripWidth: 2 * g, plateKg: 5 }), sites: ['l', 'r'], cable: false, grip: p.grip }
  if (p.implement === 'ez_bar') {
    // curl grip: the inner bends set at the grip width
    if (p.grip !== 'pronated') return { spec: ezBar({ plateKg: 5, inner: g }), sites: ['l_in', 'r_in'], cable: false, grip: p.grip }
    const base = ezBar({ plateKg: 5 })
    // reverse grip: hands on the inner end of the outer bends, which angle the palms for pronation
    const x = 0.265
    const z = 0.03 * (1 - (x - 0.25) / 0.1)
    const spec: ImplementSpec = { ...base, sites: { ...base.sites, lp: { pos: [x, 0, z], axis: base.sites.l.axis }, rp: { pos: [-x, 0, z], axis: base.sites.r.axis } } }
    return { spec, sites: ['lp', 'rp'], cable: false, grip: p.grip }
  }
  if (p.attachment === 'rope') return { spec: ropeSpec(), sites: ['l', 'r'], cable: true, grip: p.grip, rope: true }
  const base = cableHandle({ id: 'handle', attachment: 'straight_bar' })
  const w = Math.max(0.25, g + 0.07)
  return {
    spec: { ...base, parts: [cyl([0, 0, 0], [0, -0.05, 0], 0.01), cyl([-w, -0.05, 0], [w, -0.05, 0], 0.014)], sites: { l: { pos: [g, -0.05, 0], axis: [1, 0, 0] }, r: { pos: [-g, -0.05, 0], axis: [1, 0, 0] } } },
    sites: ['l', 'r'],
    cable: true,
    grip: p.grip,
  }
}

/** implement pose that puts the grip midpoint on `center`: bars turn with the forearms, cable attachments hang towards the pulley */
function barPose(bar: NonNullable<Ctx['bar']>, center: V3, pitch: number): ImplementPose {
  const rot = bar.cable ? qfromBasis([1, 0, 0], norm(sub(bar.pulley!, center))) : qaxis([1, 0, 0], -pitch * DEG)
  const mid = scale(add(bar.spec.sites[bar.sites[0]].pos, bar.spec.sites[bar.sites[1]].pos), 0.5)
  return { id: bar.spec.id, pos: sub(center, qrot(rot, mid)), rot }
}

/**
 * Hands onto the bar, following the reference arm: the same bend plane and the reference hand turned the least that
 * lines its knuckles up with the handle (no free roll search, so frames stay continuous). The left arm is solved and
 * mirrored: bar holds are exactly symmetric.
 */
function barArms(skel: Skeleton, q: Float64Array, bar: NonNullable<Ctx['bar']>, pose: ImplementPose, ref: Float64Array) {
  const f = fk(skel, ref)
  const g = siteWorld(bar.spec, pose, bar.sites[0])
  // the reference arm hangs straight; the real elbows point a little out so they sit beside the ribs, not on them
  const out = (bar.rope ? ROPE_ABD : bar.spec.kind === 'ez_bar' && bar.grip !== 'pronated' ? EZ_ABD : BAR_ABD) * DEG
  const hum = sub(segPos(skel, f, 'forearm_l'), segPos(skel, f, 'humerus_l'))
  const elbowDir = add(hum, qrot(f.rot[skel.seg.thorax2], [Math.sin(out) * len(hum), 0, 0]))
  const h = handFrame(skel, f, 'l')
  const across = dot(h.axis, g.axis!) < 0 ? scale(g.axis!, -1) : g.axis!
  const hand = bar.rope ? h.rot : qmul(qfromTo(h.axis, norm(across)), h.rot)
  // (the deviation band in attachHand then lets the handle cross the palm obliquely where the wrist would pin)
  attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm: h.palm, hand }, { pole: add(elbowDir, [0, 0, -0.1]), planeHint: 90 })
  for (const k of ['scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']) {
    q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
  }
}

/**
 * Bars: a symmetric reference arm sets the grip path and the balance; the hands are then solved onto the bar.
 * The reference stops at `bottom` elbow flexion (calibrated so the real, wider-set arms end near ELBOW[0]).
 */
function barFrame(skel: Skeleton, q: Float64Array, p: P, ctx: Ctx, c: number, cl: number, bottom = ctx.barBottom!, sway = ctx.sway, lean = ctx.barLean ?? 0) {
  const bar = ctx.bar!
  const ref = (qq: Float64Array) => {
    dbArm(skel, qq, 'l', c, cl, p, 'stand', bottom, lean)
    dbArm(skel, qq, 'r', c, cl, p, 'stand', bottom, lean)
  }
  const center = (qq: Float64Array): V3 => {
    const g = sitePos(skel, fk(skel, qq), 'grip_l')
    return [0, g[1], g[2]]
  }
  // centre of pressure of body + bar, with the cable pulling the handle towards the low pulley (the lifter leans back)
  const measure = (qq: Float64Array) => {
    const f = fk(skel, qq)
    const at = center(qq)
    if (!bar.cable) return centerOfMass(skel, f, [{ mass: bar.spec.mass, pos: at }])[2]
    const { force } = cableForce({ pulley: bar.pulley!, implement: bar.spec.id, point: [0, 0, 0], kg: CABLE_KG }, { id: bar.spec.id, pos: at, rot: [0, 0, 0, 1] })
    return centerOfPressure(skel, f, [{ mass: bar.spec.mass, pos: at }], [{ at, force }])[1]
  }
  const bal = standBalanced(skel, q, ctx.stance!, { knee: 6, tilt: 2 }, measure, ref, undefined, sway)
  const refQ = Float64Array.from(q)
  const d = skel.dof
  const pitch = q[d['shoulder_l.elev']] * (q[d['shoulder_l.plane']] >= 0 ? 1 : -1) + q[d['elbow_l.flex']]
  const pose = barPose(bar, center(q), pitch)
  barArms(skel, q, bar, pose, refQ)
  return { pose, bal }
}

function standingBase(skel: Skeleton) {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': -1, 'thorax.flex': 1, 'neck.flex': -3 })
  return q
}

// ---------- Bayesian curl ----------

/** pulley behind the lifter, roughly in line with the arm at the bottom, so the cable draws the arm back (m) */
const BEHIND_PULLEY = { y: 0.1, z: -0.75 }
/** Bayesian curl top: the cable along the forearm stops the curl here, deg */
const BEHIND_TOP = 126
/** Bayesian curl: staggered stance, working-side foot back, so the base (not an ankle lean) holds the cable; step (m), front knee and pelvis tilt (deg) */
const BEHIND_SPLIT = { step: 0.4, frontKnee: 42, tilt: 3 }
/** one-arm stack load for the balance, kg: half the two-hand cable curl's */
const BEHIND_KG = 8

function relaxedArm(skel: Skeleton, q: Float64Array, s: 'l' | 'r') {
  setDofs(skel, q, { [`shoulder_${s}.plane`]: 30, [`shoulder_${s}.elev`]: 8, [`elbow_${s}.flex`]: 12, [`grip_${s}.close`]: 0.3 })
  setScapula(skel, q, s)
}

/** single handle in the hand: across the palm, carabiner towards the pulley */
function behindHandle(skel: Skeleton, q: Float64Array, b: NonNullable<Ctx['behind']>): ImplementPose {
  const h = handFrame(skel, fk(skel, q), b.work)
  const toward = norm(sub(b.pulley, h.pos))
  const rot = qfromBasis(h.axis, norm(cross(cross(h.axis, toward), h.axis)))
  return { id: b.handle.id, pos: sub(h.pos, qrot(rot, b.handle.sites.c.pos)), rot }
}

function behindContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const work = p.side === 'left' ? 'l' : 'r'
  const stance = splitStance(skel, work === 'l' ? 'r' : 'l', BEHIND_SPLIT.step)
  const contacts = footContacts(skel, stance.feet)
  const x = (work === 'l' ? 1 : -1) * skel.data.shoulderWidth / 2
  const pulley: V3 = [x, BEHIND_PULLEY.y, stance.midfoot[2] + BEHIND_PULLEY.z]
  const handle = cableHandle({ id: 'handle', attachment: 'single_handle' })
  const stack: ImplementSpec = {
    id: 'stack',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [cyl([x, 0, pulley[2] - 0.12], [x, 2.1, pulley[2] - 0.12], 0.05), cyl(pulley, add(pulley, [0, 0, -0.12]), 0.04)],
    sites: {},
  }
  const cable = { pulley, implement: handle.id, point: [0, 0, 0] as V3, kg: BEHIND_KG }
  const setup: Setup = {
    implements: [handle, stack],
    contacts: [...contacts, { site: `grip_${work}`, kind: 'grip', target: { implement: handle.id, grip: 'c' } }],
    tempo,
    symmetric: false,
    balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL },
    cables: [cable],
  }
  const behind = { work, pulley, handle, split: stance } as const
  // centre of pressure: the cable pulls the hand back and down towards the pulley, so the lifter leans forward
  const measure = (q: Float64Array) => {
    const hp = behindHandle(skel, q, behind)
    const { at, force } = cableForce(cable, hp)
    return centerOfPressure(skel, fk(skel, q), [{ mass: handle.mass, pos: comWorld(handle, hp) }], [{ at, force }])[1]
  }
  const ctx: Ctx = { tempo, setup, body: 'stand', stance, measure, behind }
  ctx.sway = limitSway((u, sway) => standBehind(skel, standingBase(skel), u, p, ctx, sway))
  return ctx
}

function standBehind(skel: Skeleton, q: Float64Array, u: number, p: P, ctx: Ctx, sway?: Sway) {
  const { work, split } = ctx.behind!
  const upper = (qq: Float64Array) => {
    const { c, cl } = phases(u, p, ctx.tempo, work)
    dbArm(skel, qq, work, c, cl, p, 'stand')
    relaxedArm(skel, qq, work === 'l' ? 'r' : 'l')
  }
  return standSplit(skel, q, split, { frontKnee: BEHIND_SPLIT.frontKnee, tilt: BEHIND_SPLIT.tilt }, upper, ctx.measure!, sway)
}

// ---------- context ----------

const context = memo((p: P, skel: Skeleton): Ctx => {
  const why = unsupported(p)
  if (why) throw new Error(`curl: variant not implemented yet (${why})`)
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const body = bodyOf(p)
  const symmetric = p.laterality === 'bilateral'
  if (body !== 'stand') {
    const s = supportedContext(p, skel, body)
    const setup: Setup = {
      implements: [...handDumbbells(DB_KG), s.bench],
      contacts: [...s.contacts, ...dumbbellContacts()],
      tempo,
      symmetric,
    }
    return { tempo, setup, body, feet: s.feet, benchPose: s.benchPose }
  }
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const contacts = plantedContacts(skel, stance)
  if (isBehind(p)) return behindContext(p, skel, tempo)
  if (p.implement === 'dumbbell') {
    const setup: Setup = {
      implements: handDumbbells(DB_KG),
      contacts: [...contacts, ...dumbbellContacts()],
      tempo,
      symmetric,
      balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL },
    }
    const ctx: Ctx = { tempo, setup, body, stance, measure: comWithDumbbells(skel, DB_KG) }
    ctx.sway = limitSway((u, sway) => standDumbbells(skel, standingBase(skel), u, p, ctx, sway))
    return ctx
  }
  const bar = barSetup(p, skel)
  const implements_: ImplementSpec[] = [bar.spec]
  if (bar.cable) {
    // low pulley on the floor in front of the feet, drawn as a short column
    bar.pulley = [0, 0.08, stance.midfoot[2] + 0.5]
    implements_.push({
      id: 'stack',
      kind: 'bench',
      mass: 0,
      com: [0, 0, 0],
      parts: [cyl([0, 0, bar.pulley[2] + 0.12], [0, 2.1, bar.pulley[2] + 0.12], 0.05), cyl([0, bar.pulley[1], bar.pulley[2]], [0, bar.pulley[1], bar.pulley[2] + 0.12], 0.04)],
      sites: {},
    })
  }
  contacts.push(
    { site: 'grip_l', kind: 'grip', target: { implement: bar.spec.id, grip: bar.sites[0] } },
    { site: 'grip_r', kind: 'grip', target: { implement: bar.spec.id, grip: bar.sites[1] } },
  )
  const setup: Setup = { implements: implements_, contacts, tempo, symmetric: true, balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL } }
  if (bar.cable) setup.cables = [{ pulley: bar.pulley!, implement: bar.spec.id, point: [0, 0, 0], kg: CABLE_KG }]
  // the bar stays clear of the front of the thighs (a negative rest tolerance is a clearance floor)
  setup.rests = [{ implement: bar.spec.id, regions: ['thigh_l', 'thigh_r'], tol: -THIGH_CLEAR }]
  const ctx: Ctx = { tempo, setup, body, stance, bar }
  const elbowAt = (bottom: number) => {
    const q = standingBase(skel)
    barFrame(skel, q, p, ctx, 0, 0, bottom)
    return q[skel.dof['elbow_l.flex']]
  }
  // lean the upper arms forward just enough that the bar and the hands clear the thighs at the bottom and the
  // forearms (angled in by a narrow grip) clear the belly
  const onThighs = (lean: number) => {
    const q = standingBase(skel)
    const { pose } = barFrame(skel, q, p, ctx, 0, 0, ctx.barBottom ?? 20, undefined, lean)
    const caps = bodyCapsules(skel, fk(skel, q))
    const thighs = caps.filter((k) => k.region.startsWith('thigh_'))
    const hands = caps.filter((k) => k.region.startsWith('hand_'))
    const forearms = caps.filter((k) => k.region.startsWith('forearm_'))
    const trunkCaps = caps.filter((k) => k.region === 'trunk')
    const solids = placeParts(bar.spec, pose)
    const thighGap = Math.min(...thighs.flatMap((t) => [...solids.map((sd) => capsuleSolidClearance(t, sd)), ...hands.map((h) => capsuleClearance(h, t))]))
    const bellyGap = Math.min(...forearms.flatMap((fa) => trunkCaps.map((t) => capsuleClearance(fa, t))))
    return Math.min(thighGap - BAR_OFF_THIGHS, bellyGap - FOREARMS_OFF_BELLY)
  }
  const bottomElbow = closeEz(p) ? CLOSE_BOTTOM : ELBOW[0]
  ctx.barBottom = root1d((b) => elbowAt(b) - bottomElbow, 0, 45, { tol: 1e-4 }).x
  for (let pass = 0; pass < 3; pass++) {
    // a cable also pulls the hands forward towards the low pulley, so those may hang further forward
    ctx.barLean = onThighs(0) >= 0 ? 0 : root1d(onThighs, 0, bar.cable ? 40 : 25, { tol: 1e-4 }).x
    ctx.barBottom = root1d((b) => elbowAt(b) - bottomElbow, -20, 45, { tol: 1e-4 }).x
  }
  // cable loads are the handle only, so the body barely needs to sway anyway
  ctx.sway = limitSway((u, sway) => {
    const { c, cl } = phases(u, p, tempo, 'l')
    return barFrame(skel, standingBase(skel), p, ctx, c, cl, ctx.barBottom, sway).bal
  }, ARM_BALANCE_TOL - 0.01)
  return ctx
})

// ---------- sampling ----------

function phases(u: number, p: P, tempo: Tempo, side: 'l' | 'r') {
  const us = sidePhase(u, side, p.laterality)
  const on = isWorking(side, p.laterality, p.side)
  return { c: on ? phaseAt(us, tempo).c : 0, cl: on ? phaseAt(us, tempo, 0.015).c : 0 }
}

function standDumbbells(skel: Skeleton, q: Float64Array, u: number, p: P, ctx: Ctx, sway?: Sway) {
  const upper = (qq: Float64Array) => {
    for (const s of ['l', 'r'] as const) {
      const { c, cl } = phases(u, p, ctx.tempo, s)
      dbArm(skel, qq, s, c, cl, p, 'stand')
    }
  }
  return standBalanced(skel, q, ctx.stance!, { knee: 6, tilt: 2 }, ctx.measure!, upper, undefined, sway)
}

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const q = zeroQ(skel)
  if (ctx.body !== 'stand') {
    supportedBody(skel, q, p, ctx)
    for (const s of ['l', 'r'] as const) {
      const { c, cl } = phases(u, p, ctx.tempo, s)
      dbArm(skel, q, s, c, cl, p, ctx.body)
    }
    return { q, implements: [...dumbbellPoses(skel, q), ctx.benchPose!], contacts: ctx.setup.contacts }
  }
  q.set(standingBase(skel))
  if (ctx.behind) {
    standBehind(skel, q, u, p, ctx, ctx.sway)
    return { q, implements: [behindHandle(skel, q, ctx.behind), { id: 'stack', pos: [0, 0, 0], rot: qid() }], contacts: ctx.setup.contacts }
  }
  if (!ctx.bar) {
    standDumbbells(skel, q, u, p, ctx, ctx.sway)
    return { q, implements: dumbbellPoses(skel, q), contacts: ctx.setup.contacts }
  }
  const bar = ctx.bar
  const { c, cl } = phases(u, p, ctx.tempo, 'l')
  const { pose } = barFrame(skel, q, p, ctx, c, cl)
  const implements_: ImplementPose[] = [pose]
  if (bar.cable) implements_.push({ id: 'stack', pos: [0, 0, 0], rot: qid() })
  return { q, implements: implements_, contacts: ctx.setup.contacts }
}

export const curl: Template<P> = {
  id: 'curl',
  driver: 'joint',
  params: SCHEMAS.curl,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}

