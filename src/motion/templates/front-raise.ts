import { plantFoot, solveLegs, type FootTarget } from '../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../collide.ts'
import { fk, segPos } from '../fk.ts'
import { bench } from '../implements.ts'
import { add, dot, lerp, norm, qid, scale, sub, type V3 } from '../math.ts'
import { setDofs, zeroQ, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
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
  kind: 'stand' | 'prone'
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
function proneBody(skel: Skeleton, q: Float64Array, p: P, hip: V3, feet?: FootTarget[]) {
  const trunk = 90 - p.benchAngle
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

function proneContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const a = (p.benchAngle * Math.PI) / 180
  // lifter faces -Z: the pad rises towards -Z, its surface normal points up and back
  const along: V3 = [0, Math.sin(a), -Math.cos(a)]
  const normal: V3 = [0, Math.cos(a), Math.sin(a)]
  const ctx0: Ctx = { kind: 'prone', tempo, setup: null as never, bottom: p.benchAngle > 0 ? 90 - p.benchAngle : 0 }
  // trunk resting on the pad plane: the pad top edge just below the shoulders, the hinge at seat height
  let hip: V3 = [0, 0.8, 0]
  let benchPos: V3 = [0, SEAT_H, 0]
  for (let pass = 0; pass < 4; pass++) {
    const q = zeroQ(skel)
    proneBody(skel, q, p, hip)
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
  const feet = proneFeet(skel, hip)
  const spec = bench({ backAngle: p.benchAngle, seatHeight: SEAT_H })
  const setup: Setup = {
    implements: [...handDumbbells(Y_KG), spec],
    contacts: [...footContacts(skel, feet), ...dumbbellContacts()],
    tempo,
    symmetric: false,
  }
  return { ...ctx0, setup, hip, feet, benchPose: { id: spec.id, pos: benchPos, rot: qid() } }
}

// ---------- template ----------

const context = memo((p: P, skel: Skeleton): Ctx => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.implement !== 'dumbbell') throw new Error(`front-raise: variant not implemented yet (${p.implement})`)
  if (p.posture === 'standing') return standContext(p, skel, tempo)
  if (p.posture === 'lying_prone') return proneContext(p, skel, tempo)
  throw new Error(`front-raise: variant not implemented yet (${p.posture})`)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const q = zeroQ(skel)
  if (ctx.kind === 'stand') {
    standing(u, p, skel, ctx, q, ctx.sway)
    return { q, implements: dumbbellPoses(skel, q), contacts: ctx.setup.contacts }
  }
  proneBody(skel, q, p, ctx.hip!, ctx.feet)
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
