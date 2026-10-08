import type { FootTarget } from '../constraints.ts'
import { lerp, norm, sub, type V3 } from '../math.ts'
import { setDofs, zeroQ, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { comWithDumbbells, dumbbellContacts, dumbbellPoses, handDumbbells } from './arms.ts'
import { crossoverBody, crossoverContext, crossoverSway, handlePoses, type CrossoverCtx } from './crossover.ts'
import { inclineProne, proneBody } from './front-raise.ts'
import { armDir, footContacts, mirrorArm, planeElevOf, poseArm, thoraxFrame } from './isolation.ts'
import { pecDeckContext, samplePecDeck, type PecDeckCtx } from './pec-deck.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { ARM_BALANCE_TOL, limitSway, makeStance, plantedContacts, stanceWidth, standBalanced, type StanceSetup, type Sway } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Rear delt raise (reverse fly): horizontal abduction from the arms in front of the chest (bent over: hanging under
// the shoulders) to in line with the shoulders, elbows soft and fixed (research "rear delt/reverse fly: torso hinge
// ~70-90 or prone; horizontal abduction ~-90 -> 0"), the backs of the hands leading. Bent-over dumbbells: flat back
// hinged to torsoAngle, knees soft, ankles balancing body + load over the midfoot. Cable: standing between the
// crossover towers, each hand on the opposite tower's cable at shoulder height. Reverse pec deck: seated, chest on
// the pad, handles on arcs round the shoulders. Prone: chest down on an incline bench (the prone Y-raise's setup), the
// same arc from the hang; neutral grip there is the T-raise, thumbs turning up as the arms rise (external rotation).

type P = ParamsOf<'rear-raise'>

const DB_KG = 6
/** prone: lighter dumbbells, as the prone Y-raise */
const PRONE_KG = 3
/**
 * prone hands, deg (hang -> top): pronated hangs palms towards the feet, thumbs in, and ends palms down, thumbs
 * towards the head; neutral (T-raise) hangs palms in and ends thumbs up, palms towards the head (external rotation)
 */
const PRONE_ROT: Record<P['grip'], { rot: [number, number]; pro: [number, number] }> = {
  pronated: { rot: [0, -60], pro: [85, 0] },
  neutral: { rot: [0, 75], pro: [0, 80] },
}
const CABLE_KG = 5
/** top of the dumbbell rep: arm plane and elevation relative to the trunk (arms level with the shoulders) */
const DB_TOP = { plane: 2, elev: 86 }
/** cable rep: arms crossed a little in front of the chest -> in line with the shoulders */
const CABLE_START = { plane: 88, elev: 86 }
const CABLE_END = { plane: -2, elev: 88 }
/** crossover towers ahead of the lifter (m) and the pulley height offset between them (m) */
const TOWER_Z = 0.95
const TOWER_X = 1.1
const CROSS_DY = 0.03
/** bent-over knee flexion, deg */
const HINGE_KNEE = 22

type Ctx =
  | { kind: 'db'; tempo: Tempo; setup: Setup; stance: StanceSetup; sway?: Sway; measure: (q: Float64Array) => number }
  | { kind: 'prone'; tempo: Tempo; setup: Setup; hip: V3; feet: FootTarget[]; benchPose: ImplementPose }
  | { kind: 'cable'; tempo: Tempo; setup: Setup; x: CrossoverCtx }
  | { kind: 'machine'; tempo: Tempo; setup: Setup; x: PecDeckCtx }

/** the direction back along the arm path (towards the start of the concentric) at c */
function backwards(plane: (c: number) => number, elev: (c: number) => number, c: number, fr: ReturnType<typeof thoraxFrame>): V3 {
  const a = Math.max(0, c - 0.02), b = Math.min(1, c + 0.02)
  return norm(sub(armDir(plane(a), elev(a), fr), armDir(plane(b), elev(b), fr)))
}

// ---------- bent-over dumbbells ----------

function hingeTrunk(skel: Skeleton, q: Float64Array) {
  setDofs(skel, q, { 'lumbar.flex': 3, 'thorax.flex': 5, 'neck.flex': -14, 'head.flex': -6 })
}

function dbArm(skel: Skeleton, q: Float64Array, c: number, p: P) {
  const fr = thoraxFrame(skel, q)
  // start: arms hanging straight down under the shoulders, whatever the hinge
  const hang = planeElevOf([0, -1, 0], fr)
  const plane = (x: number) => lerp(hang.plane, DB_TOP.plane, x)
  const elev = (x: number) => lerp(hang.elev, DB_TOP.elev, x)
  const back = backwards(plane, elev, c, fr)
  poseArm(skel, q, 'l', { plane: plane(c), elev: elev(c), elbow: p.elbowAngle, bend: back, palm: back, girdle: { prot: lerp(2, -12, c) }, shrug: 0.5 })
  if (p.posture === 'lying_prone') {
    // prone: humeral and forearm rotation run straight from the hang to the top (no stops reached on the way)
    const r = PRONE_ROT[p.grip]
    q[skel.dof['shoulder_l.rot']] = lerp(r.rot[0], r.rot[1], c)
    q[skel.dof['forearm_l.pro']] = lerp(r.pro[0], r.pro[1], c)
  }
  mirrorArm(skel, q)
}

function dbStand(u: number, p: P, skel: Skeleton, ctx: Extract<Ctx, { kind: 'db' }>, q: Float64Array, sway?: Sway) {
  hingeTrunk(skel, q)
  const tilt = p.torsoAngle - 8
  const c = phaseAt(u, ctx.tempo).c
  return standBalanced(skel, q, ctx.stance, { knee: HINGE_KNEE, tilt }, ctx.measure, (qq) => dbArm(skel, qq, c, p), [-20, 25], sway)
}

function dbContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const setup: Setup = {
    implements: handDumbbells(DB_KG),
    contacts: [...plantedContacts(skel, stance), ...dumbbellContacts()],
    tempo,
    symmetric: true,
    balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL },
  }
  const ctx: Extract<Ctx, { kind: 'db' }> = { kind: 'db', tempo, setup, stance, measure: comWithDumbbells(skel, DB_KG) }
  ctx.sway = limitSway((u, sway) => dbStand(u, p, skel, ctx, zeroQ(skel), sway))
  return ctx
}

// ---------- prone on an incline bench ----------

function proneContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const { hip, feet, bench, benchPose } = inclineProne(skel, p.benchAngle ?? 90 - p.torsoAngle)
  const setup: Setup = {
    implements: [...handDumbbells(PRONE_KG), bench],
    contacts: [...footContacts(skel, feet), ...dumbbellContacts()],
    tempo,
    symmetric: false,
  }
  return { kind: 'prone', tempo, setup, hip, feet, benchPose }
}

// ---------- cable crossover ----------

function cableArms(skel: Skeleton, c: number, p: P) {
  return (q: Float64Array) => {
    const fr = thoraxFrame(skel, q)
    const plane = (x: number) => lerp(CABLE_START.plane, CABLE_END.plane, x)
    const elev = (x: number) => lerp(CABLE_START.elev, CABLE_END.elev, x)
    const back = backwards(plane, elev, c, fr)
    poseArm(skel, q, 'l', { plane: plane(c), elev: elev(c), elbow: p.elbowAngle, bend: back, palm: back, girdle: { prot: lerp(3, -12, c) }, shrug: 0.5 })
    mirrorArm(skel, q)
  }
}

function cableContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  // towers in front of the lifter at shoulder height, far enough forward that each crossed cable passes in front
  // of the other hand; the pulleys differ by a few cm so the crossed cables clear each other
  const y = p.cableHeight === 'mid' ? 1.44 : p.cableHeight === 'high' ? 2.0 : 0.1
  const x = crossoverContext(skel, {
    tempo,
    pulleys: { l: [TOWER_X, y + CROSS_DY, TOWER_Z], r: [-TOWER_X, y - CROSS_DY, TOWER_Z] },
    crossed: p.crossed,
    kg: CABLE_KG,
    stance: { kind: 'hip', knee: 8, tilt: 4 },
    trunk: { 'lumbar.flex': 0, 'thorax.flex': 0, 'neck.flex': -4, 'head.flex': -2 },
    facing: [0, 0, -1],
  })
  x.sway = crossoverSway(skel, x, () => zeroQ(skel), (u) => cableArms(skel, phaseAt(u, tempo).c, p))
  return { kind: 'cable', tempo, setup: x.setup, x }
}

// ---------- template ----------

const context = memo((p: P, skel: Skeleton): Ctx => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.laterality !== 'bilateral') throw new Error(`rear-raise: variant not implemented yet (${p.laterality})`)
  if (p.implement === 'dumbbell' && p.posture === 'standing') return dbContext(p, skel, tempo)
  if (p.implement === 'dumbbell' && p.posture === 'lying_prone') return proneContext(p, skel, tempo)
  if (p.implement === 'cable' && p.posture === 'standing' && p.torsoAngle === 0) return cableContext(p, skel, tempo)
  if (p.implement === 'machine' && p.posture === 'seated') {
    const x = pecDeckContext(skel, 'rear', { elbow: p.elbowAngle, tempo, symmetric: true })
    return { kind: 'machine', tempo, setup: x.setup, x }
  }
  throw new Error(`rear-raise: variant not implemented yet (${p.implement}/${p.posture})`)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  if (ctx.kind === 'machine') {
    const r = samplePecDeck(skel, ctx.x, c)
    return { q: r.q, implements: r.implements, contacts: ctx.setup.contacts }
  }
  const q = zeroQ(skel)
  if (ctx.kind === 'db') {
    dbStand(u, p, skel, ctx, q, ctx.sway)
    return { q, implements: dumbbellPoses(skel, q), contacts: ctx.setup.contacts }
  }
  if (ctx.kind === 'prone') {
    proneBody(skel, q, p.benchAngle ?? 90 - p.torsoAngle, ctx.hip, ctx.feet)
    dbArm(skel, q, c, p)
    return { q, implements: [...dumbbellPoses(skel, q), ctx.benchPose], contacts: ctx.setup.contacts }
  }
  crossoverBody(skel, ctx.x, q, cableArms(skel, c, p), ctx.x.sway)
  return { q, implements: [...handlePoses(skel, ctx.x, q), { id: ctx.x.crossover.id, pos: [0, 0, 0], rot: [0, 0, 0, 1] }], contacts: ctx.setup.contacts }
}


export const rearRaise: Template<P> = {
  id: 'rear-raise',
  driver: 'joint',
  params: SCHEMAS['rear-raise'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
