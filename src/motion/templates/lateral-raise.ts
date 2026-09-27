import { attachHand, handFrame, implementFromHand, root1d, solveLegs } from '../constraints.ts'
import { centerOfMass, fk, segPos } from '../fk.ts'
import { cableHandle, dumbbell, siteWorld, type ImplementSpec, type Part } from '../implements.ts'
import { add, cross, DEG, dist, lerp, norm, qfromBasis, qid, qrot, scale, sub, type V3 } from '../math.ts'
import { setDofs, shoulderRhythm, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { comWithDumbbells, dumbbellContacts, dumbbellPoses, handDumbbells, isWorking, sidePhase } from './arms.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { ARM_BALANCE_TOL, hipsFor, limitSway, makeStance, plantedContacts, setPelvis, stanceWidth, standBalanced, type StanceSetup, type Sway } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Lateral raise, joint space: humerothoracic elevation in a fixed plane (scapular plane by default) with a soft
// elbow, clavicle elevation/protraction from the scapulohumeral rhythm rule, slight hip hinge; the ankles balance the
// body + load COM over the midfoot. Cable: a low pulley on the far side pulls the hand across the body, so the rep
// starts with the hand in front of the hips and sweeps out to the working plane. Lean-away: the free hand holds an
// upright and the whole body tilts away from it; the dumbbell still hangs vertically at the bottom, so the arm starts
// abducted by the lean relative to the trunk.

type P = ParamsOf<'lateral-raise'>

const DB_KG = 10
const BOTTOM_ELEV = 10
/** cable start: hand pulled in front of the hips */
const CABLE_START = { plane: 95, elev: 18 }
/** share of the lean taken by the legs at the ankles and by the pelvis (a level-ish pelvis keeps both knees soft); the spine side-bends for the rest */
const LEG_LEAN = 0.6
const PELVIS_LEAN = 0.15

type Side = 'l' | 'r'

type Ctx = {
  kind: 'db' | 'cable' | 'lean'
  tempo: Tempo
  setup: Setup
  stance: StanceSetup
  work?: Side
  pulley?: V3
  handle?: ImplementSpec
  post?: { spec: ImplementSpec; site: string }
  measure: (q: Float64Array) => number
  sway?: Sway
}

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })
const other = (s: Side): Side => (s === 'l' ? 'r' : 'l')

function arm(skel: Skeleton, q: Float64Array, s: Side, c: number, p: P, from = { plane: p.plane, elev: BOTTOM_ELEV }, top = p.topElevation) {
  const elev = lerp(from.elev, top, c)
  // a start off the working plane (cable) is left early: the hand sweeps out, then rises in the plane
  const plane = lerp(from.plane, p.plane, 1 - (1 - c) ** 3)
  const g = shoulderRhythm(elev, plane)
  const d = skel.dof
  q[d[`shoulder_${s}.plane`]] = plane
  q[d[`shoulder_${s}.elev`]] = elev
  q[d[`shoulder_${s}.rot`]] = 4 * c
  q[d[`elbow_${s}.flex`]] = p.elbowAngle
  q[d[`forearm_${s}.pro`]] = p.grip === 'pronated' ? 30 : 0
  q[d[`wrist_${s}.flex`]] = 0
  q[d[`clavicle_${s}.elev`]] = g.elev
  q[d[`clavicle_${s}.prot`]] = g.prot
  q[d[`grip_${s}.close`]] = 1
}

function relaxedArm(skel: Skeleton, q: Float64Array, s: Side) {
  setDofs(skel, q, { [`shoulder_${s}.plane`]: 30, [`shoulder_${s}.elev`]: 8, [`elbow_${s}.flex`]: 12, [`grip_${s}.close`]: 0.3 })
}

// ---------- contexts ----------

function dbContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const setup: Setup = {
    implements: handDumbbells(DB_KG),
    contacts: [...plantedContacts(skel, stance), ...dumbbellContacts()],
    tempo,
    symmetric: p.laterality === 'bilateral',
    balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL },
  }
  return { kind: 'db', tempo, setup, stance, measure: comWithDumbbells(skel, DB_KG) }
}

function cableContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const work: Side = p.side === 'left' ? 'l' : 'r'
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const away = work === 'r' ? 1 : -1
  // pulley low on the far side, a little in front, so the cable crosses in front of the hips
  const pulley: V3 = [away * 0.5, p.cableHeight === 'low' ? 0.1 : p.cableHeight === 'mid' ? 1.0 : 2.0, 0.1]
  const handle = cableHandle({ id: 'handle', attachment: 'single_handle' })
  const stack: ImplementSpec = {
    id: 'stack',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [cyl([pulley[0] + away * 0.12, 0, pulley[2]], [pulley[0] + away * 0.12, 2.1, pulley[2]], 0.05), cyl(pulley, add(pulley, [away * 0.12, 0, 0]), 0.04)],
    sites: {},
  }
  const contacts: Contact[] = [...plantedContacts(skel, stance), { site: `grip_${work}`, kind: 'grip', target: { implement: 'handle', grip: 'c' } }]
  const setup: Setup = { implements: [handle, stack], contacts, tempo, symmetric: false, balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL } }
  const measure = (q: Float64Array) => {
    const f = fk(skel, q)
    return centerOfMass(skel, f, [{ mass: handle.mass, pos: handFrame(skel, f, work).pos }])[2]
  }
  return { kind: 'cable', tempo, setup, stance, work, pulley, handle, measure }
}

/**
 * Body tilted sideways by `lean` deg (+ tilts the top to the figure's right): the legs tilt at the ankles, the pelvis
 * follows part way and the spine side-bends for the rest.
 */
function leanBody(skel: Skeleton, q: Float64Array, stance: StanceSetup, lean: number, dz: number) {
  const hip = hipsFor(skel, stance, 5, 4)
  const legs = LEG_LEAN * lean
  const a = legs * DEG
  const lt = skel.segments[skel.seg.femur_l].length
  const ls = skel.segments[skel.seg.tibia_l].length
  const kneeFlex = (d: number) => 180 - Math.acos(Math.max(-1, Math.min(1, (lt * lt + ls * ls - d * d) / (2 * lt * ls)))) / DEG
  const list = PELVIS_LEAN * lean
  setDofs(skel, q, { 'lumbar.bend': -(lean - list) / 2, 'thorax.bend': -(lean - list) / 2 })
  const place = (r: number) => setPelvis(skel, q, [-Math.sin(a) * r, Math.cos(a) * r, hip[2] + dz], 5, 0, list)
  // hip height where the straighter leg keeps 5 deg of knee flexion
  const r = root1d((r) => {
    place(r)
    const f = fk(skel, q)
    return Math.min(...stance.feet.map((ft) => kneeFlex(dist(f.pos[skel.seg[`femur_${ft.side}`]], ft.ankle)))) - 5
  }, hip[1] - 0.2, hip[1] + 0.05, { tol: 1e-7 })
  place(r.x)
  solveLegs(skel, q, stance.feet)
}

function leanContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const work: Side = p.side === 'left' ? 'l' : 'r'
  const free = other(work)
  const lean = (work === 'r' ? 1 : -1) * p.leanAngle
  const stance = makeStance(skel, 0.8 * stanceWidth(skel, 'hip'), 5)
  const q = zeroQ(skel)
  leanBody(skel, q, stance, lean, 0)
  // the upright stands on the free-hand side, a little in front, where the hand holds it just below shoulder height
  // with the supporting arm nearly straight (elbow ~10-15 deg)
  const f = fk(skel, q)
  const gh = segPos(skel, f, `humerus_${free}`)
  const out: V3 = [work === 'r' ? 1 : -1, 0, 0]
  const grip = add(gh, scale(norm(add(out, [0, -0.1, 0.1])), 0.672))
  const post: ImplementSpec = {
    id: 'post',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [cyl([grip[0], 0, grip[2]], [grip[0], 2.1, grip[2]], 0.025)],
    sites: { h: { pos: grip, axis: [0, 1, 0] } },
  }
  const db = dumbbell({ id: `db_${work}`, mass: DB_KG })
  const contacts: Contact[] = [
    ...plantedContacts(skel, stance),
    { site: `grip_${work}`, kind: 'grip', target: { implement: db.id, grip: 'c' } },
    { site: `grip_${free}`, kind: 'grip', target: { implement: 'post', grip: 'h' } },
  ]
  const setup: Setup = { implements: [db, post], contacts, tempo, symmetric: false, balance: { point: 'com', over: 'midfoot', tol: 0.025 } }
  const measure = (qq: Float64Array) => {
    const ff = fk(skel, qq)
    return centerOfMass(skel, ff, [{ mass: DB_KG, pos: handFrame(skel, ff, work).pos }])[2]
  }
  return { kind: 'lean', tempo, setup, stance, work, post: { spec: post, site: 'h' }, measure }
}

function makeContext(p: P, skel: Skeleton): Ctx {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.posture !== 'standing') throw new Error(`lateral-raise: variant not implemented yet (${p.posture})`)
  if (p.implement === 'cable' && p.support === 'none' && p.leanAngle === 0) return cableContext(p, skel, tempo)
  if (p.implement === 'dumbbell' && p.support === 'upright' && p.leanAngle > 0 && p.laterality === 'unilateral') return leanContext(p, skel, tempo)
  if (p.implement === 'dumbbell' && p.support === 'none' && p.leanAngle === 0) return dbContext(p, skel, tempo)
  throw new Error(`lateral-raise: variant not implemented yet (${p.implement}/${p.support}/lean ${p.leanAngle})`)
}

const context = memo((p: P, skel: Skeleton): Ctx => {
  const ctx = makeContext(p, skel)
  if (ctx.kind !== 'lean') ctx.sway = limitSway((u, sway) => standing(u, p, skel, ctx, zeroQ(skel), sway))
  return ctx
})

// ---------- sampling ----------

const cOf = (u: number, s: Side, p: P, tempo: Tempo) => (isWorking(s, p.laterality, p.side) ? phaseAt(sidePhase(u, s, p.laterality), tempo).c : 0)

function trunkPose(skel: Skeleton, q: Float64Array) {
  setDofs(skel, q, { 'lumbar.flex': 2, 'thorax.flex': 3, 'neck.flex': -6, 'head.flex': -2 })
}

/** dumbbell and cable variants: legs and arms for loop fraction u, ankles balancing the COM */
function standing(u: number, p: P, skel: Skeleton, ctx: Ctx, q: Float64Array, sway?: Sway) {
  trunkPose(skel, q)
  if (ctx.kind === 'db') {
    const upper = (qq: Float64Array) => {
      arm(skel, qq, 'l', cOf(u, 'l', p, ctx.tempo), p)
      arm(skel, qq, 'r', cOf(u, 'r', p, ctx.tempo), p)
    }
    return standBalanced(skel, q, ctx.stance, { knee: 8, tilt: 6 }, ctx.measure, upper, undefined, sway)
  }
  const work = ctx.work!
  const c = cOf(u, work, p, ctx.tempo)
  const upper = (qq: Float64Array) => {
    arm(skel, qq, work, c, p, CABLE_START)
    relaxedArm(skel, qq, other(work))
  }
  return standBalanced(skel, q, ctx.stance, { knee: 8, tilt: 5 }, ctx.measure, upper, undefined, sway)
}

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const q = zeroQ(skel)
  trunkPose(skel, q)

  if (ctx.kind === 'db') {
    standing(u, p, skel, ctx, q, ctx.sway)
    return { q, implements: dumbbellPoses(skel, q), contacts: ctx.setup.contacts }
  }

  const work = ctx.work!
  const c = cOf(u, work, p, ctx.tempo)
  if (ctx.kind === 'cable') {
    standing(u, p, skel, ctx, q, ctx.sway)
    const h = handFrame(skel, fk(skel, q), work)
    // handle across the palm, carabiner towards the pulley
    const toward = norm(sub(ctx.pulley!, h.pos))
    const rot = qfromBasis(h.axis, norm(cross(cross(h.axis, toward), h.axis)))
    const hp: ImplementPose = { id: 'handle', pos: sub(h.pos, qrot(rot, ctx.handle!.sites.c.pos)), rot }
    return { q, implements: [hp, { id: 'stack', pos: [0, 0, 0], rot: qid() }], contacts: ctx.setup.contacts }
  }

  // lean-away: arm elevation is relative to the tilted trunk, so the hanging start is abducted by the lean
  const lean = (work === 'r' ? 1 : -1) * p.leanAngle
  const postPose: ImplementPose = { id: 'post', pos: [0, 0, 0], rot: qid() }
  const free = other(work)
  const place = (qq: Float64Array, dz: number) => {
    leanBody(skel, qq, ctx.stance, lean, dz)
    arm(skel, qq, work, c, p, { plane: p.plane, elev: BOTTOM_ELEV + p.leanAngle }, p.topElevation + p.leanAngle)
    const g = siteWorld(ctx.post!.spec, postPose, 'h')
    attachHand(skel, qq, free, { pos: g.pos, axis: g.axis!, palm: [0, 0, 1] }, { pole: [0, -1, -0.3], planeHint: 40 })
  }
  const r = root1d((dz) => {
    place(q, dz)
    return ctx.measure(q) - ctx.stance.midfoot[2]
  }, -0.12, 0.15, { tol: 1e-7 })
  place(q, r.x)
  const h = handFrame(skel, fk(skel, q), work)
  return { q, implements: [{ id: `db_${work}`, pos: h.pos, rot: implementFromHand(h.axis, h.palm) }, postPose], contacts: ctx.setup.contacts }
}

export const lateralRaise: Template<P> = {
  id: 'lateral-raise',
  driver: 'joint',
  params: SCHEMAS['lateral-raise'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
