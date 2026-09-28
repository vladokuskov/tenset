import { attachHand, root1d } from '../constraints.ts'
import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts } from '../collide.ts'
import { centerOfMass, fk, segPos } from '../fk.ts'
import { barbell, type ImplementSpec } from '../implements.ts'
import { add, lerp, scale, type V3 } from '../math.ts'
import { setDofs, shoulderRhythm, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { comWithDumbbells, dumbbellContacts, dumbbellPoses, handDumbbells } from './arms.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { ARM_BALANCE_TOL, limitSway, makeStance, plantedContacts, stanceWidth, standBalanced, type StanceSetup, type Sway } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Shrug, joint space: the arms hang straight and still while the shoulder girdle lifts straight up. Clavicle
// elevation runs from a little depression under the load to ~26 deg (research: 0 -> ~25, SC joint), with a small
// scapular upward rotation and no protraction or retraction change (no rolling). The humerus keeps its angles to the
// thorax, so the load rises with the shoulders. Dumbbells hang beside the thighs (neutral grip); the bar hangs just
// in front of them (pronated). The ankles balance body + load over the midfoot.

type P = ParamsOf<'shrug'>

const DB_KG = 20
const BAR_PLATE_KG = 20
/** clavicle elevation at the bottom and the top, deg */
const ELEV: [number, number] = [-3, 26]
/** scapular upward rotation added at the top, deg (the scapula elevates with a little upward rotation) */
const UPROT_TOP = 6
/** clavicle protraction, deg: slightly set back, constant */
const PROT = -2
const ELBOW = 6
/** bar: a little more elbow bend lets the elbows point out so the upper arms clear the waist, deg */
const BAR_ELBOW = 13
/** dumbbells: clearance from the thighs (plates, hands), m */
const DB_OFF_THIGHS = 0.012
/** bar: clearance from the thighs at the bottom, m; the loop keeps at least BAR_CLEAR mm */
const BAR_OFF_THIGHS = 0.014
const BAR_CLEAR = 8

type Ctx = {
  tempo: Tempo
  setup: Setup
  stance: StanceSetup
  measure: (q: Float64Array) => number
  sway?: Sway
  /** dumbbells: arm abduction that clears the thighs, deg */
  abd?: number
  /** bar: centre relative to the shoulder midpoint (constant), and the bar spec */
  bar?: { spec: ImplementSpec; offset: V3 }
}

function girdle(skel: Skeleton, q: Float64Array, c: number) {
  const elev = lerp(ELEV[0], ELEV[1], c)
  setDofs(skel, q, { 'clavicle_*.elev': elev, 'clavicle_*.prot': PROT })
  return shoulderRhythm(0, 0).uprot + UPROT_TOP * c
}

function standingBase(skel: Skeleton) {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': -1, 'thorax.flex': 1, 'neck.flex': -3, 'head.flex': 0 })
  return q
}

// ---------- dumbbells ----------

function dbArms(skel: Skeleton, q: Float64Array, c: number, abd: number) {
  const up = girdle(skel, q, c)
  for (const s of ['l', 'r'] as const) {
    setDofs(skel, q, {
      [`shoulder_${s}.plane`]: 0,
      [`shoulder_${s}.elev`]: abd,
      [`shoulder_${s}.rot`]: 0,
      [`elbow_${s}.flex`]: ELBOW,
      [`forearm_${s}.pro`]: 0,
      [`wrist_${s}.flex`]: 0,
      [`wrist_${s}.dev`]: 0,
      [`scapula_${s}.uprot`]: up,
      [`grip_${s}.close`]: 1,
    })
  }
}

/** smallest clearance of the dumbbells and hands from the thighs over the rep, m */
function dbThighGap(skel: Skeleton, stance: StanceSetup, abd: number, dbs: ImplementSpec[]) {
  let gap = Infinity
  for (const c of [0, 0.5, 1]) {
    const q = standingBase(skel)
    standBalanced(skel, q, stance, { knee: 6, tilt: 2 }, comWithDumbbells(skel, DB_KG), (qq) => dbArms(skel, qq, c, abd))
    const caps = bodyCapsules(skel, fk(skel, q))
    const thighs = caps.filter((k) => k.region.startsWith('thigh_'))
    const hands = caps.filter((k) => k.region.startsWith('hand_'))
    const poses = dumbbellPoses(skel, q)
    const solids = dbs.flatMap((spec, i) => placeParts(spec, poses[i]))
    for (const t of thighs) {
      for (const sd of solids) gap = Math.min(gap, capsuleSolidClearance(t, sd))
      for (const h of hands) gap = Math.min(gap, capsuleClearance(h, t))
    }
  }
  return gap
}

// ---------- bar ----------

function shoulderMid(skel: Skeleton, q: Float64Array): V3 {
  const f = fk(skel, q)
  return scale(add(segPos(skel, f, 'humerus_l'), segPos(skel, f, 'humerus_r')), 0.5)
}

function barPose(skel: Skeleton, q: Float64Array, spec: ImplementSpec, offset: V3): ImplementPose {
  const m = shoulderMid(skel, q)
  return { id: spec.id, pos: [0, m[1] + offset[1], m[2] + offset[2]], rot: [0, 0, 0, 1] }
}

/** both hands onto the bar, pronated; the left arm is solved and mirrored */
function barArms(skel: Skeleton, q: Float64Array, c: number, spec: ImplementSpec, offset: V3) {
  const up = girdle(skel, q, c)
  setDofs(skel, q, { 'grip_*.close': 1 })
  const pose = barPose(skel, q, spec, offset)
  const g = add(pose.pos, spec.sites.l.pos)
  attachHand(skel, q, 'l', { pos: g, axis: [1, 0, 0], palm: [0, 0, -1] }, { pole: [0.8, 0, -1], planeHint: 60, uprot: up })
  for (const k of ['scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']) {
    q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
  }
  return pose
}

function barMeasure(skel: Skeleton, spec: ImplementSpec, offset: V3) {
  return (q: Float64Array) => centerOfMass(skel, fk(skel, q), [{ mass: spec.mass, pos: barPose(skel, q, spec, offset).pos }])[2]
}

/** bar and hands vs thighs at the bottom, m */
function barThighGap(skel: Skeleton, stance: StanceSetup, spec: ImplementSpec, offset: V3) {
  const q = standingBase(skel)
  let pose!: ImplementPose
  standBalanced(skel, q, stance, { knee: 6, tilt: 2 }, barMeasure(skel, spec, offset), (qq) => (pose = barArms(skel, qq, 0, spec, offset)))
  const caps = bodyCapsules(skel, fk(skel, q))
  const thighs = caps.filter((k) => k.region.startsWith('thigh_'))
  const hands = caps.filter((k) => k.region.startsWith('hand_'))
  const solids = placeParts(spec, pose)
  let gap = Infinity
  for (const t of thighs) {
    for (const sd of solids) gap = Math.min(gap, capsuleSolidClearance(t, sd))
    for (const h of hands) gap = Math.min(gap, capsuleClearance(h, t))
  }
  return { gap, elbow: q[skel.dof['elbow_l.flex']] }
}

// ---------- context ----------

const context = memo((p: P, skel: Skeleton): Ctx => {
  if (p.posture !== 'standing' || (p.implement !== 'dumbbell' && p.implement !== 'barbell')) {
    throw new Error(`shrug: variant not implemented yet (${p.implement}/${p.posture})`)
  }
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const contacts: Contact[] = plantedContacts(skel, stance)
  const balance = { point: 'com' as const, over: 'midfoot' as const, tol: ARM_BALANCE_TOL }
  if (p.implement === 'dumbbell') {
    const dbs = handDumbbells(DB_KG)
    const setup: Setup = { implements: dbs, contacts: [...contacts, ...dumbbellContacts()], tempo, symmetric: p.laterality === 'bilateral', balance }
    const abd = root1d((a) => dbThighGap(skel, stance, a, dbs) - DB_OFF_THIGHS, 0, 25, { tol: 1e-4 }).x
    const ctx: Ctx = { tempo, setup, stance, measure: comWithDumbbells(skel, DB_KG), abd }
    ctx.sway = limitSway((u, sway) => standDb(skel, standingBase(skel), u, ctx, sway))
    return ctx
  }
  const spec = barbell({ gripWidth: p.gripWidth * skel.data.shoulderWidth, plateKg: BAR_PLATE_KG })
  contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: spec.id, grip: 'l' } }, { site: 'grip_r', kind: 'grip', target: { implement: spec.id, grip: 'r' } })
  const setup: Setup = {
    implements: [spec],
    contacts,
    tempo,
    symmetric: true,
    balance,
    rests: [{ implement: spec.id, regions: ['thigh_l', 'thigh_r'], tol: -BAR_CLEAR }],
  }
  // the bar hangs from nearly straight arms (elbow ~ELBOW) just in front of the thighs
  let offset: V3 = [0, -0.62, 0.05]
  for (let pass = 0; pass < 3; pass++) {
    const dz = root1d((z) => barThighGap(skel, stance, spec, [0, offset[1], z]).gap - BAR_OFF_THIGHS, -0.05, 0.25, { tol: 1e-5 }).x
    offset = [0, offset[1], dz]
    const dy = root1d((y) => barThighGap(skel, stance, spec, [0, y, offset[2]]).elbow - BAR_ELBOW, -0.75, -0.5, { tol: 1e-5 }).x
    offset = [0, dy, offset[2]]
  }
  const ctx: Ctx = { tempo, setup, stance, measure: barMeasure(skel, spec, offset), bar: { spec, offset } }
  ctx.sway = limitSway((u, sway) => standBar(skel, standingBase(skel), u, ctx, sway).bal)
  return ctx
})

// ---------- sampling ----------

function standDb(skel: Skeleton, q: Float64Array, u: number, ctx: Ctx, sway?: Sway) {
  const c = phaseAt(u, ctx.tempo).c
  return standBalanced(skel, q, ctx.stance, { knee: 6, tilt: 2 }, ctx.measure, (qq) => dbArms(skel, qq, c, ctx.abd!), undefined, sway)
}

function standBar(skel: Skeleton, q: Float64Array, u: number, ctx: Ctx, sway?: Sway) {
  const c = phaseAt(u, ctx.tempo).c
  const { spec, offset } = ctx.bar!
  let pose!: ImplementPose
  const bal = standBalanced(skel, q, ctx.stance, { knee: 6, tilt: 2 }, ctx.measure, (qq) => (pose = barArms(skel, qq, c, spec, offset)), undefined, sway)
  return { bal, pose }
}

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const q = standingBase(skel)
  if (!ctx.bar) {
    standDb(skel, q, u, ctx, ctx.sway)
    return { q, implements: dumbbellPoses(skel, q), contacts: ctx.setup.contacts }
  }
  const { pose } = standBar(skel, q, u, ctx, ctx.sway)
  return { q, implements: [pose], contacts: ctx.setup.contacts }
}

export const shrug: Template<P> = {
  id: 'shrug',
  driver: 'joint',
  params: SCHEMAS.shrug,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
