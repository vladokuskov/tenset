import { attachHand, root1d } from '../constraints.ts'
import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts } from '../collide.ts'
import { centerOfMass, fk, segPos } from '../fk.ts'
import { barbell, cableHandle, type Cable, type ImplementSpec, type Part } from '../implements.ts'
import { smithRails } from '../implements/back.ts'
import { add, lerp, norm, qfromBasis, qrot, scale, sub, type V3 } from '../math.ts'
import { setDofs, shoulderRhythm, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { comWithDumbbells, dumbbellContacts, dumbbellPoses, handDumbbells } from './arms.ts'
import { pressureZ } from './isolation.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { ARM_BALANCE_TOL, limitSway, makeStance, plantedContacts, stanceWidth, standBalanced, type StanceSetup, type Sway } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Shrug, joint space: the arms hang straight and still while the shoulder girdle lifts straight up. Clavicle
// elevation runs from a little depression under the load to ~26 deg (research: 0 -> ~25, SC joint), with a small
// scapular upward rotation and no protraction or retraction change (no rolling). The humerus keeps its angles to the
// thorax, so the load rises with the shoulders. Dumbbells hang beside the thighs (neutral grip); the bar hangs just
// in front of them (pronated). The ankles balance body + load over the midfoot. Smith: the bar hangs as the free bar
// does, but on the rails' vertical line (its z fixed where it hangs at the bottom of the rep). Cable: a straight bar
// on a low pulley just in front of the feet hangs as the free bar does; it turns towards the pulley, and its pull
// joins the balance.

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
/** cable: low pulley height and how far ahead of the midfoot (m), stack load (kg); the grips sit this far below the
 * carabiner on the bar (m) */
const CABLE = { pulleyY: 0.08, ahead: 0.5, kg: 20 }
const CABLE_BAR_Y = -0.05

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })

/** straight cable bar wide enough for the grip, sites on the grips (curl.ts builds its cable bar the same way) */
function cableBar(gripWidth: number): ImplementSpec {
  const base = cableHandle({ id: 'handle', attachment: 'straight_bar' })
  const g = gripWidth / 2
  const w = Math.max(0.25, g + 0.07)
  return { ...base, parts: [cyl([0, 0, 0], [0, CABLE_BAR_Y, 0], 0.01), cyl([-w, CABLE_BAR_Y, 0], [w, CABLE_BAR_Y, 0], 0.014)], sites: { l: { pos: [g, CABLE_BAR_Y, 0], axis: [1, 0, 0] }, r: { pos: [-g, CABLE_BAR_Y, 0], axis: [1, 0, 0] } } }
}

/** the low pulley's column, drawn as a cable stack with a straight bar (props/families/back/bar-stack-layout.ts) */
function barStack(pulley: V3): ImplementSpec {
  return {
    id: 'bar_stack',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [cyl([0, 0, pulley[2] + 0.12], [0, 2.1, pulley[2] + 0.12], 0.05), cyl(pulley, [pulley[0], pulley[1], pulley[2] + 0.12], 0.04)],
    sites: {},
  }
}

/** a loop fraction in the bottom pause of the default tempo */
const BOTTOM_U = 0.635

type Ctx = {
  tempo: Tempo
  setup: Setup
  stance: StanceSetup
  measure: (q: Float64Array) => number
  sway?: Sway
  /** dumbbells: arm abduction that clears the thighs, deg */
  abd?: number
  /** bar: centre relative to the shoulder midpoint (constant), and the bar spec; Smith: the rails' z; cable: its cable */
  bar?: { spec: ImplementSpec; offset: V3; railZ?: number; cable?: Cable }
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

function barPose(skel: Skeleton, q: Float64Array, spec: ImplementSpec, offset: V3, railZ?: number, cable?: Cable): ImplementPose {
  const m = shoulderMid(skel, q)
  const center: V3 = [0, m[1] + offset[1], railZ ?? m[2] + offset[2]]
  if (!cable) return { id: spec.id, pos: center, rot: [0, 0, 0, 1] }
  // a cable bar hangs from its carabiner towards the pulley, the grips (local y CABLE_BAR_Y) on `center`
  const rot = qfromBasis([1, 0, 0], norm(sub(cable.pulley, center)))
  return { id: spec.id, pos: sub(center, qrot(rot, [0, CABLE_BAR_Y, 0])), rot }
}

/** both hands onto the bar, pronated; the left arm is solved and mirrored */
function barArms(skel: Skeleton, q: Float64Array, c: number, spec: ImplementSpec, offset: V3, railZ?: number, cable?: Cable) {
  const up = girdle(skel, q, c)
  setDofs(skel, q, { 'grip_*.close': 1 })
  const pose = barPose(skel, q, spec, offset, railZ, cable)
  const g = add(pose.pos, qrot(pose.rot, spec.sites.l.pos))
  attachHand(skel, q, 'l', { pos: g, axis: [1, 0, 0], palm: [0, 0, -1] }, { pole: [0.8, 0, -1], planeHint: 60, uprot: up })
  for (const k of ['scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']) {
    q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
  }
  return pose
}

function barMeasure(skel: Skeleton, spec: ImplementSpec, offset: V3, railZ?: number, cable?: Cable) {
  if (cable) {
    return (q: Float64Array) => {
      const pose = barPose(skel, q, spec, offset, railZ, cable)
      return pressureZ(skel, q, [{ mass: spec.mass, pos: add(pose.pos, qrot(pose.rot, spec.com)) }], [{ cable, pose }])
    }
  }
  return (q: Float64Array) => centerOfMass(skel, fk(skel, q), [{ mass: spec.mass, pos: barPose(skel, q, spec, offset, railZ).pos }])[2]
}

/** bar and hands vs thighs at the bottom, m */
function barThighGap(skel: Skeleton, stance: StanceSetup, spec: ImplementSpec, offset: V3, cable?: Cable) {
  const q = standingBase(skel)
  let pose!: ImplementPose
  standBalanced(skel, q, stance, { knee: 6, tilt: 2 }, barMeasure(skel, spec, offset, undefined, cable), (qq) => (pose = barArms(skel, qq, 0, spec, offset, undefined, cable)))
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
  if (p.posture !== 'standing' || p.implement === 'machine') {
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
  const cable = p.implement === 'cable' ? { pulley: [0, CABLE.pulleyY, stance.midfoot[2] + CABLE.ahead] as V3, implement: 'handle', point: [0, 0, 0] as V3, kg: CABLE.kg } : undefined
  const spec = cable ? cableBar(p.gripWidth * skel.data.shoulderWidth) : barbell({ gripWidth: p.gripWidth * skel.data.shoulderWidth, plateKg: BAR_PLATE_KG })
  contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: spec.id, grip: 'l' } }, { site: 'grip_r', kind: 'grip', target: { implement: spec.id, grip: 'r' } })
  const setup: Setup = {
    implements: [spec],
    contacts,
    tempo,
    symmetric: true,
    balance,
    rests: [{ implement: spec.id, regions: ['thigh_l', 'thigh_r'], tol: -BAR_CLEAR }],
  }
  if (cable) {
    setup.cables = [cable]
    setup.implements.push(barStack(cable.pulley))
  }
  // the bar hangs from nearly straight arms (elbow ~ELBOW) just in front of the thighs
  let offset: V3 = [0, -0.62, 0.05]
  for (let pass = 0; pass < 3; pass++) {
    const dz = root1d((z) => barThighGap(skel, stance, spec, [0, offset[1], z], cable).gap - BAR_OFF_THIGHS, -0.05, 0.25, { tol: 1e-5 }).x
    offset = [0, offset[1], dz]
    const dy = root1d((y) => barThighGap(skel, stance, spec, [0, y, offset[2]], cable).elbow - BAR_ELBOW, -0.75, -0.5, { tol: 1e-5 }).x
    offset = [0, dy, offset[2]]
  }
  const ctx: Ctx = { tempo, setup, stance, measure: barMeasure(skel, spec, offset, undefined, cable), bar: { spec, offset, cable } }
  if (p.implement === 'smith') {
    // the rails' line: where the free bar hangs at the bottom of the rep, held there for the whole rep
    const q = standingBase(skel)
    const railZ = standBar(skel, q, BOTTOM_U, ctx).pose.pos[2]
    ctx.bar = { spec, offset, railZ }
    ctx.measure = barMeasure(skel, spec, offset, railZ)
    setup.implements.push(smithRails({ z: railZ }))
  }
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
  const { spec, offset, railZ, cable } = ctx.bar!
  let pose!: ImplementPose
  const bal = standBalanced(skel, q, ctx.stance, { knee: 6, tilt: 2 }, ctx.measure, (qq) => (pose = barArms(skel, qq, c, spec, offset, railZ, cable)), undefined, sway)
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
  const fixed: ImplementPose[] = ctx.bar.railZ !== undefined ? [{ id: 'smith', pos: [0, 0, 0], rot: [0, 0, 0, 1] }] : ctx.bar.cable ? [{ id: 'bar_stack', pos: [0, 0, 0], rot: [0, 0, 0, 1] }] : []
  return { q, implements: [pose, ...fixed], contacts: ctx.setup.contacts }
}

export const shrug: Template<P> = {
  id: 'shrug',
  driver: 'joint',
  params: SCHEMAS.shrug,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
