import { attachHand, plantFoot, root1d, solveLegs, type FootTarget } from '../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../collide.ts'
import { centerOfMass, fk, segPos } from '../fk.ts'
import { bench, type ImplementSpec } from '../implements.ts'
import { weightPlate } from '../implements/index.ts'
import { add, DEG, dot, lerp, norm, qaxis, qid, qrot, scale, sub, type V3 } from '../math.ts'
import { setDofs, shoulderRhythm, zeroQ, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { monotoneCubic } from './row/common.ts'
import { comWithDumbbells, dumbbellContacts, dumbbellPoses, handDumbbells, isWorking, sidePhase } from './arms.ts'
import { armDir, footContacts, forSide, mirrorArm, poseArm, SIDES, thoraxFrame, type Side } from './isolation.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { ARM_BALANCE_TOL, limitSway, makeStance, plantedContacts, setPelvis, stanceWidth, standBalanced, type StanceSetup, type Sway } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Front raise, joint space: humerothoracic elevation in a fixed plane (90 = straight forward, 0 -> ~90 deg; research
// "front raise: plane ~90, elevation 0 -> 85") with a soft fixed elbow and the scapulohumeral rhythm, trunk still.
// Standing dumbbells start in front of the thighs (the lowest elevation that keeps the heads 12 mm off them) and the
// ankles balance body + load over the midfoot. Prone Y-raise: chest down on a 45 deg incline bench, legs straddling
// it, feet on the floor; the arms hang straight down and rise in the Y plane (45) to 160 deg, thumbs up, with less
// clavicle elevation and some retraction (shoulder blades down and back).
// Plate (234): one plate held by its sides (rims at 3 and 9 o'clock, thumbs up), raised on an arc round the shoulders
// from in front of the thighs to eye level with nearly straight arms (elbow ~10, solved by IK to the rims). The plate
// turns with the forearms: vertical at the top, its top edge tipped forward at the bottom (wrists in radial deviation
// take part of the turn), so it clears the thighs.

type P = ParamsOf<'front-raise'>

const DB_KG = 5
const Y_KG = 3
/** dumbbell heads stay this far off the thighs at the bottom, m */
const THIGH_CLEAR = 0.012
/** incline bench: seat top height and how far below the shoulder joints the pad's top edge sits (along the trunk), m */
const SEAT_H = 0.42
const PAD_BELOW_SHOULDERS = 0.0
/** prone: chest sinks this far into the pad, m */
const SINK = 0.01
/** Y-raise girdle: share of the rhythm's clavicle elevation kept, retraction at the top (deg) */
const Y_SHRUG = 0.4
const Y_RETRACT = -12
/** prone: feet either side of the bench (x) and behind the hips (z), m */
const PRONE_FEET = [0.44, 0.42]
const PRONE_TOE = 0

type Ctx = {
  kind: 'stand' | 'prone' | 'plate'
  tempo: Tempo
  setup: Setup
  stance?: StanceSetup
  bottom: number
  sway?: Sway
  /** prone: pelvis placement and the bench */
  hip?: V3
  feet?: FootTarget[]
  benchPose?: ImplementPose
  measure?: (q: Float64Array) => number
  /** plate: distance from the shoulder midpoint to the plate centre by elevation (m) */
  plate?: { spec: ImplementSpec; r: (elev: number) => number }
}

const PLATE_KG = 20
/** plate arc: share of the forearms' turn the plate keeps and an offset (deg), clearance from the thighs (m) */
const PLATE_ARC = { share: 0.45, radial: 12, thighClear: 0.004, fingers: 22 }
/** plate: the wrists' comfortable deviation, deg */
const PLATE_DEV: [number, number] = [-22, 18]
/**
 * plate: the rim crosses the palm obliquely as the arms come down (index end towards the wrist), eased in from
 * PLATE_OBL.from to PLATE_OBL.to deg of elevation, so the wrists never pin against their band (a jerk)
 */
const PLATE_OBL = { max: 40, from: 100, to: 15 }

function plateOblique(elev: number) {
  const t = Math.min(1, Math.max(0, (PLATE_OBL.from - elev) / (PLATE_OBL.from - PLATE_OBL.to)))
  return PLATE_OBL.max * t * t * (3 - 2 * t)
}

/** a loop fraction in the bottom pause of the default tempo */
const BOTTOM_U = 0.635

const cOf = (u: number, s: Side, p: P, tempo: Tempo) => (isWorking(s, p.laterality, p.side) ? phaseAt(sidePhase(u, s, p.laterality), tempo).c : 0)

// ---------- arms ----------

/** arm at contraction c: elevation from `bottom` to the top in the raise plane; bottomPlane lets the prone start hang vertically */
function arm(skel: Skeleton, q: Float64Array, s: Side, c: number, p: P, ctx: Ctx) {
  const fr = thoraxFrame(skel, q)
  const prone = ctx.kind === 'prone'
  const plane = prone ? lerp(90, p.plane, c) : p.plane
  const elev = lerp(ctx.bottom, p.topElevation, c)
  const dir = armDir(plane, elev, fr)
  const ahead = norm(sub(armDir(plane, elev + 2, fr), armDir(plane, elev - 2, fr)))
  const medial = scale(fr.right, 1)
  let bend: V3, palm: V3
  if (p.grip === 'pronated') {
    // palms face the thighs, then the floor; elbows a little out so the forearm needs less pronation
    bend = add(ahead, scale(medial, 0.6))
    palm = scale(ahead, -1)
  } else if (!prone) {
    // standing thumbs up (scaption): the elbow bends along the path; the palm turns from the thigh (palms in) to
    // the raise plane's inner side at the top
    const pr = (plane * Math.PI) / 180
    const inner = add(scale(fr.right, Math.sin(pr)), scale(fr.fwd, Math.cos(pr)))
    const want = add(scale(medial, 1 - c), scale(inner, c))
    bend = ahead
    palm = norm(sub(want, scale(dir, dot(want, dir))))
  } else {
    // thumbs lead: towards the head at the bottom, up (away from the pad) at the top
    bend = norm(add(scale(fr.up, 1 - c), scale(fr.fwd, -c)))
    palm = sub(medial, scale(dir, dot(medial, dir)))
  }
  poseArm(skel, q, s, {
    plane,
    elev,
    elbow: p.elbowAngle,
    bend: forSide(bend, s),
    palm: forSide(palm, s),
    shrug: prone ? Y_SHRUG : 1,
    girdle: prone ? { prot: Y_RETRACT * c } : undefined,
  })
}

function arms(skel: Skeleton, q: Float64Array, u: number, p: P, ctx: Ctx) {
  if (p.laterality === 'bilateral') {
    arm(skel, q, 'l', cOf(u, 'l', p, ctx.tempo), p, ctx)
    mirrorArm(skel, q)
    return
  }
  for (const s of SIDES) arm(skel, q, s, cOf(u, s, p, ctx.tempo), p, ctx)
}

// ---------- standing ----------

function trunkPose(skel: Skeleton, q: Float64Array) {
  setDofs(skel, q, { 'lumbar.flex': 2, 'thorax.flex': 3, 'neck.flex': -6, 'head.flex': -2 })
}

function standing(u: number, p: P, skel: Skeleton, ctx: Ctx, q: Float64Array, sway?: Sway) {
  trunkPose(skel, q)
  return standBalanced(skel, q, ctx.stance!, { knee: 8, tilt: 6 }, ctx.measure!, (qq) => arms(skel, qq, u, p, ctx), undefined, sway)
}

/** dumbbell to thigh clearance with the arms at elevation `bottom` */
function thighGap(skel: Skeleton, p: P, ctx: Ctx, bottom: number) {
  const q = zeroQ(skel)
  standing(BOTTOM_U, p, skel, { ...ctx, bottom }, q)
  const caps = bodyCapsules(skel, fk(skel, q)).filter((c) => c.region.startsWith('thigh_'))
  const poses = dumbbellPoses(skel, q)
  let gap = Infinity
  for (const spec of ctx.setup.implements) {
    const pose = poses.find((x) => x.id === spec.id)!
    for (const sd of placeParts(spec, pose)) for (const c of caps) gap = Math.min(gap, capsuleSolidClearance(c, sd))
  }
  return gap
}

function standContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const setup: Setup = {
    implements: handDumbbells(DB_KG),
    contacts: [...plantedContacts(skel, stance), ...dumbbellContacts()],
    tempo,
    symmetric: p.laterality === 'bilateral',
    balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL },
  }
  const ctx: Ctx = { kind: 'stand', tempo, setup, stance, bottom: 0, measure: comWithDumbbells(skel, DB_KG) }
  // lowest start that keeps the heads off the thighs (the cue: dumbbells resting against the thighs)
  let lo = 4, hi = 40
  for (let k = 0; k < 30; k++) {
    const m = (lo + hi) / 2
    if (thighGap(skel, p, ctx, m) < THIGH_CLEAR) lo = m
    else hi = m
  }
  ctx.bottom = hi
  ctx.sway = limitSway((uu, sway) => standing(uu, p, skel, ctx, zeroQ(skel), sway))
  return ctx
}

// ---------- prone on an incline bench ----------

/** trunk angle from vertical on a bench this steep, and the lying body (facing -Z, head up the pad) */
export function proneBody(skel: Skeleton, q: Float64Array, benchAngle: number, hip: V3, feet?: FootTarget[]) {
  const trunk = 90 - benchAngle
  setDofs(skel, q, { 'lumbar.flex': 2, 'thorax.flex': 3, 'neck.flex': -4, 'head.flex': -4 })
  setPelvis(skel, q, hip, trunk - 5, 180)
  if (feet) solveLegs(skel, q, feet)
}

/** feet on the floor either side of the bench, behind the hips (the lifter faces -Z, so its left is -X) */
function proneFeet(skel: Skeleton, hip: V3): FootTarget[] {
  const x = PRONE_FEET[0]
  const z = hip[2] + PRONE_FEET[1]
  return [plantFoot(skel, 'l', [-x, 0, z], 180 + PRONE_TOE), plantFoot(skel, 'r', [x, 0, z], PRONE_TOE - 180)]
}

/**
 * Chest down on an incline bench (lifter facing -Z): the trunk rests on the pad plane with the pad's top edge just
 * below the shoulders and the hinge at seat height, feet on the floor either side of the bench
 */
export function inclineProne(skel: Skeleton, benchAngle: number) {
  const a = (benchAngle * Math.PI) / 180
  // lifter faces -Z: the pad rises towards -Z, its surface normal points up and back
  const along: V3 = [0, Math.sin(a), -Math.cos(a)]
  const normal: V3 = [0, Math.cos(a), Math.sin(a)]
  let hip: V3 = [0, 0.8, 0]
  let benchPos: V3 = [0, SEAT_H, 0]
  for (let pass = 0; pass < 4; pass++) {
    const q = zeroQ(skel)
    proneBody(skel, q, benchAngle, hip)
    const f = fk(skel, q)
    const trunk = bodyCapsules(skel, f).filter((c) => c.region === 'trunk')
    const plane = Math.min(...trunk.map((c) => Math.min(dot(normal, c.a), dot(normal, c.b)) - c.r)) + SINK
    const z = (plane - normal[1] * SEAT_H) / normal[2]
    benchPos = [0, SEAT_H, z]
    const padTop = add(benchPos, scale(along, 0.84))
    const gh = scale(add(segPos(skel, f, 'humerus_l'), segPos(skel, f, 'humerus_r')), 0.5)
    const s = dot(along, sub(padTop, gh)) + PAD_BELOW_SHOULDERS
    hip = add(hip, scale(along, s))
  }
  const spec = bench({ backAngle: benchAngle, seatHeight: SEAT_H })
  return { hip, feet: proneFeet(skel, hip), bench: spec, benchPose: { id: spec.id, pos: benchPos, rot: qid() } as ImplementPose }
}

function proneContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const ctx0: Ctx = { kind: 'prone', tempo, setup: null as never, bottom: p.benchAngle > 0 ? 90 - p.benchAngle : 0 }
  const { hip, feet, bench: spec, benchPose } = inclineProne(skel, p.benchAngle)
  const setup: Setup = {
    implements: [...handDumbbells(Y_KG), spec],
    contacts: [...footContacts(skel, feet), ...dumbbellContacts()],
    tempo,
    symmetric: false,
  }
  return { ...ctx0, setup, hip, feet, benchPose }
}

// ---------- plate ----------

/**
 * plate tipped forward (top edge away), deg: a share of the forearms' turn, eased into 0 (no jerk); the wrists and the
 * rim crossing the palm obliquely take the rest, so the plate hangs nearly upright in front of the thighs
 */
function plateTilt(elev: number) {
  const x = PLATE_ARC.share * (90 - elev) - PLATE_ARC.radial, w = 12
  return x > w ? x : x < -w ? 0 : ((x + w) * (x + w)) / (4 * w)
}

function platePose(skel: Skeleton, q: Float64Array, ctx: Ctx, elev: number): ImplementPose {
  const f = fk(skel, q)
  const sm = scale(add(segPos(skel, f, 'humerus_l'), segPos(skel, f, 'humerus_r')), 0.5)
  const e = elev * DEG
  const r = ctx.plate!.r(elev)
  return { id: ctx.plate!.spec.id, pos: add(sm, [0, -r * Math.cos(e), r * Math.sin(e)]), rot: qaxis([1, 0, 0], plateTilt(elev) * DEG) }
}

function plateArms(skel: Skeleton, q: Float64Array, ctx: Ctx, elev: number) {
  const g = shoulderRhythm(elev, 90)
  setDofs(skel, q, { 'clavicle_*.elev': g.elev, 'clavicle_*.prot': g.prot, 'grip_*.close': 1 })
  const pose = platePose(skel, q, ctx, elev)
  const site = ctx.plate!.spec.sites.rim_l
  attachHand(skel, q, 'l', { pos: add(pose.pos, qrot(pose.rot, site.pos)), axis: qrot(pose.rot, site.axis!), palm: [-1, 0, 0], oblique: plateOblique(elev) }, { pole: [1, -0.5, -0.2], planeHint: 80, uprot: g.uprot, devBand: PLATE_DEV })
  mirrorArm(skel, q)
  return pose
}

function plateStand(u: number, p: P, skel: Skeleton, ctx: Ctx, q: Float64Array, sway?: Sway) {
  trunkPose(skel, q)
  const elev = lerp(ctx.bottom, p.topElevation, phaseAt(u, ctx.tempo).c)
  let pose!: ImplementPose
  const measure = (qq: Float64Array) => centerOfMass(skel, fk(skel, qq), [{ mass: PLATE_KG, pos: platePose(skel, qq, ctx, elev).pos }])[2]
  const bal = standBalanced(skel, q, ctx.stance!, { knee: 8, tilt: 6 }, measure, (qq) => (pose = plateArms(skel, qq, ctx, elev)), undefined, sway)
  return { bal, pose }
}

function plateContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const spec = weightPlate({ kg: PLATE_KG })
  const setup: Setup = {
    implements: [spec],
    contacts: [...plantedContacts(skel, stance), { site: 'grip_l', kind: 'grip', target: { implement: spec.id, grip: 'rim_l' } }, { site: 'grip_r', kind: 'grip', target: { implement: spec.id, grip: 'rim_r' } }],
    tempo,
    symmetric: p.laterality === 'bilateral',
    balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL },
    // the fingers wrap the rim over the plate's faces, where the gates' core disc meets the rim ring
    rests: [{ implement: spec.id, regions: ['hand_l', 'hand_r'], tol: PLATE_ARC.fingers }],
  }
  const ctx: Ctx = { kind: 'plate', tempo, setup, stance, bottom: 20, plate: { spec, r: () => 0.6 } }
  const at = (elev: number) => {
    const q = zeroQ(skel)
    trunkPose(skel, q)
    const pose = plateArms(skel, q, ctx, elev)
    return { q, pose }
  }
  // the plate's distance that keeps the elbows at elbowAngle, solved at a few elevations
  const es = Array.from({ length: 9 }, (_, k) => lerp(0, p.topElevation + 5, k / 8))
  const rs = es.map((e) => root1d((r) => {
    ctx.plate!.r = () => r
    return at(e).q[skel.dof['elbow_l.flex']] - p.elbowAngle
  }, 0.3, 0.9, { tol: 1e-6 }).x)
  ctx.plate!.r = monotoneCubic(es, rs)
  // start: the lowest elevation that keeps the plate off the thighs
  const gap = (elev: number) => {
    const { q, pose } = at(elev)
    const thighs = bodyCapsules(skel, fk(skel, q)).filter((c) => c.region.startsWith('thigh_'))
    let g = Infinity
    for (const sd of placeParts(spec, pose)) for (const c of thighs) g = Math.min(g, capsuleSolidClearance(c, sd))
    return g - PLATE_ARC.thighClear
  }
  ctx.bottom = root1d(gap, 0, 60, { tol: 1e-4 }).x
  ctx.sway = limitSway((uu, sway) => plateStand(uu, p, skel, ctx, zeroQ(skel), sway).bal)
  return ctx
}

// ---------- template ----------

const context = memo((p: P, skel: Skeleton): Ctx => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.implement === 'plate' && p.posture === 'standing' && p.laterality === 'bilateral') return plateContext(p, skel, tempo)
  if (p.implement !== 'dumbbell') throw new Error(`front-raise: variant not implemented yet (${p.implement})`)
  if (p.posture === 'standing') return standContext(p, skel, tempo)
  if (p.posture === 'lying_prone') return proneContext(p, skel, tempo)
  throw new Error(`front-raise: variant not implemented yet (${p.posture})`)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const q = zeroQ(skel)
  if (ctx.kind === 'plate') {
    const { pose } = plateStand(u, p, skel, ctx, q, ctx.sway)
    return { q, implements: [pose], contacts: ctx.setup.contacts }
  }
  if (ctx.kind === 'stand') {
    standing(u, p, skel, ctx, q, ctx.sway)
    return { q, implements: dumbbellPoses(skel, q), contacts: ctx.setup.contacts }
  }
  proneBody(skel, q, p.benchAngle, ctx.hip!, ctx.feet)
  arms(skel, q, u, p, ctx)
  return { q, implements: [...dumbbellPoses(skel, q), ctx.benchPose!], contacts: ctx.setup.contacts }
}

export const frontRaise: Template<P> = {
  id: 'front-raise',
  driver: 'joint',
  params: SCHEMAS['front-raise'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
