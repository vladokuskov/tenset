import { attachHand, handFrame, implementFromHand, jointByName, legKinematics, root1d, writeLeg, type FootTarget, type LegSolve } from '../constraints.ts'
import { eulerAngles, limbRotation, twoBone } from '../ik.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts, restAgainst } from '../collide.ts'
import { centerOfMass, fk, localToWorld, type FK } from '../fk.ts'
import { barbell, dumbbell, siteWorld, type ImplementSpec, type Part } from '../implements.ts'
import { CALF_SEATED, CALF_STANDING, calfStep, calfYoke, footBar, seatedLever } from '../implements/legs-hip-calf.ts'
import { flatBench, wallSection, PLYO_BOX } from '../implements/shared.ts'
import { add, cross, DEG, dot, lerp, neg, norm, qaxis, qconj, qfromBasis, qid, qmul, qrot, scale, sub, type Quat, type V3 } from '../math.ts'
import { setDofs, setScapula, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { hipMidLocal, setPelvis, stanceWidth } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Calf raise, root space: the balls of the feet stay on the support edge and the foot pitches about them, so the
// ankle travels from a stretch below the edge (dorsiflexion) to a high heel raise (plantarflexion) while the knees
// stay nearly straight (standing, leg press) or at ~90 deg under the knee pads (seated). Standing: the machine's yoke
// holds the shoulders on a vertical path; on a step the body leans until the centre of mass sits over the ball, and the
// free hand rests on a wall. The tibialis raise pivots the feet about the heels with the back against a wall.
// Ranges: ankle DF ~10-20 on a step -> PF ~30-45 (motion-authoring research, calf raise); toes stay on the support
// by extending at the ball.

type P = ParamsOf<'calf-raise'>
type Side = 'l' | 'r'

/**
 * ankle dorsiflexion at the stretch and at the top, deg. The stretch sits past the research's 10-20 at the loaded
 * straight-knee end range (~25): standing free on a step the body leans ~10 deg to keep the centre of mass over the
 * ball, which at 20 left the heel only ~3 cm below the edge (lead: full ankle range, stretch below the step)
 */
const STANDING_DF = { stretch: 25, top: -36 }
/** knee at 90: soleus-limited; the toes draped over the roller reach their flexion limit at this stretch */
const SEATED_DF = { stretch: 24, top: -34 }
/** leg press: the ball rests on the plate's bottom lip; the stretch stops before the heel side meets it */
const PRESS_DF = { stretch: 16, top: -34 }
/** knees nearly straight on standing raises and the leg press (soft lock), deg */
const STRAIGHT_KNEE = 4
/** tibialis raise: legs lean back by `lean` against the wall, the trunk by `trunk`; toes lift `lift` about the heel */
const TIB = { lean: 15, trunk: -4, lift: 30, knee: 3 }
/** the heel rolls: pivot this far behind the heel site (m), keeping the heel pad above the floor */
const TIB_PIVOT_BACK = 0.0075
/** standing machine: centre of mass behind the ball line (the yoke carries the shoulders on its guide), m */
const MACHINE_COM = -0.05
/** free single-leg raise: centre of mass between the ball and the step edge (the forefoot rests from the edge to the
 * toes), m */
const STEP_COM = -0.012
const STEP_BOX = 0.2
/** ball of the foot this far in from the step's rear edge, m */
const BALL_IN = 0.03
const WALL_Z = 0.56
/** grip site off the wall face with the fingertips on it (the fist capsule models curled fingers), m */
const WALL_STANDOFF = 0.036
const DB_KG = 16
/**
 * Penetration tolerance for a standing foot on its step or plate, mm: the forefoot capsule is rigid with the foot and
 * dips into the support by up to ~38 mm at the top, where the real toes extend flat on it (lead decision; the unit
 * test checks the toe-aware clearance instead)
 */
const FOREFOOT_REST = 42
/** shoulder pads sink this far onto the shoulders, m */
const PAD_SINK = 0.006
/**
 * The round girdle capsule stands proud of the sloping trapezius under the pads (close-up renders showed the pads
 * floating ~4 cm above the shoulders when seated on the capsule), so the pads go this much deeper into it, m
 */
const GIRDLE_PROUD = 0.042
/** girdle vs shoulder pads penetration tolerance, mm (lead decision): PAD_SINK + GIRDLE_PROUD = 48 into the capsule */
const YOKE_REST = 50
/** shoulder girdle under the yoke, deg: shoulders set down and a little forward, scapulae held */
const YOKE_GIRDLE = { elev: 2, prot: 4, uprot: 5 }
const SEAT_HIP: V3 = [0, 0.66, 0]
/** seated: knee pads rest on the thighs this far proximal of the knee joint, m */
const PAD_FROM_KNEE = 0.09
const THIGH_SINK = 0.008

type Stand = {
  /** machine: the yoke; step: free on a step (single leg, a hand on the wall); bar: a bar on the back on a step */
  kind: 'machine' | 'step' | 'bar'
  /** bar: the bar, its arm DOFs (solved once: the bar rides on the thorax), Smith rails (the hips keep a fixed z) */
  bar?: ImplementSpec
  barArms?: [number, number][]
  rail?: boolean
  feet: { side: Side; ball: V3; yaw: number }[]
  work?: Side
  /** machine: fixed hip midpoint z (the yoke rides a vertical guide) */
  hipZ?: number
  tilt: number
  df: { stretch: number; top: number }
  yokeFromHip?: V3
  wall?: { spec: ImplementSpec; pose: ImplementPose }
  box?: { spec: ImplementSpec; pose: ImplementPose }
  db?: ImplementSpec
}

type Seated = {
  kind: 'seated'
  feet: { side: Side; ball: V3; yaw: number }[]
  pivot: V3
  lever: ImplementSpec
  /** lever rotation about X at the reference (mid-rep) pose is 0 */
  tilt: number
}

type Press = {
  kind: 'press'
  d: V3
  sledRot: Quat
  feet: { side: Side; local: V3; yaw: number }[]
  shift: V3
  sled: ImplementSpec
}

type Tib = {
  kind: 'tib'
  feet: { side: Side; pivot: V3; yaw: number }[]
  hipZ: number
  wall: ImplementPose
}

type Perch = {
  kind: 'perch'
  feet: { side: Side; ball: V3; yaw: number }[]
  hip: V3
  bench: ImplementPose
  /** dumbbell poses in the femur frames (they stand on the lower thighs and ride with them) */
  dbs: { id: string; side: Side; pos: V3; rot: Quat }[]
}

type Ctx = { tempo: Tempo; setup: Setup; v: Stand | Seated | Press | Tib | Perch }

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })
const other = (s: Side): Side => (s === 'l' ? 'r' : 'l')

const ARM_DOFS = ['clavicle_*.prot', 'clavicle_*.elev', 'scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev', 'grip_*.close']

function mirrorArm(skel: Skeleton, q: Float64Array) {
  for (const k of ARM_DOFS) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

/** foot with its ball site on `ball`, turned out `yaw` deg and pitched heel-up `pitch` deg about the ball, in `base` */
function footOnBall(skel: Skeleton, side: Side, ball: V3, pitch: number, yaw = 0, base: Quat = qid()): FootTarget {
  const rot = qmul(base, qmul(qaxis([0, 1, 0], (side === 'l' ? yaw : -yaw) * DEG), qaxis([1, 0, 0], pitch * DEG)))
  return { side, rot, ankle: sub(ball, qrot(rot, skel.data.sites[`ball_${side}`].local)) }
}

/** legs to the feet; knees bend towards the toes, or towards `pole` (seated: with the heels up the toes point along
 * the shin and stop defining a bend plane) */
function legsTo(skel: Skeleton, q: Float64Array, feet: FootTarget[], pole?: V3) {
  const f = fk(skel, q)
  const pr = f.rot[skel.seg.pelvis]
  return feet.map((foot) => {
    const hip = f.pos[skel.seg[`femur_${foot.side}`]]
    const leg = pole ? legToward(skel, foot, hip, pr, pole) : legKinematics(skel, foot.side, hip, pr, foot)
    writeLeg(skel, q, foot.side, leg)
    return leg
  })
}

const KNEE_AXIS: V3 = [1, 0, 0]

function legToward(skel: Skeleton, foot: FootTarget, hip: V3, pelvisRot: Quat, pole: V3): LegSolve {
  const lt = skel.segments[skel.seg[`femur_${foot.side}`]].length
  const ls = skel.segments[skel.seg[`tibia_${foot.side}`]].length
  const ik = twoBone(hip, foot.ankle, lt, ls, pole, { minFlex: 0.5, soft: 2 })
  const femur = limbRotation(hip, ik.mid, ik.hinge, KNEE_AXIS)
  const tibia = qmul(femur, qaxis(KNEE_AXIS, ik.flex * DEG))
  const h = eulerAngles(skel, jointByName(skel, `hip_${foot.side}`), qmul(qconj(pelvisRot), femur))
  const a = eulerAngles(skel, jointByName(skel, `ankle_${foot.side}`), qmul(qconj(tibia), foot.rot))
  return { hip: h.values, knee: ik.flex, ankle: a.values, residual: a.residual, shortfall: ik.shortfall, femur, tibia, kneePos: ik.mid }
}

/** toes flat on the support (extending at the ball), plus `curl` deg (draped over a bar) */
function toes(skel: Skeleton, q: Float64Array, side: Side, pitch: number, curl = 0) {
  q[skel.dof[`toe_${side}.flex`]] = Math.max(-55, Math.min(38, -pitch + curl))
}

function gaze(skel: Skeleton, q: Float64Array, down = 0) {
  const d = skel.dof
  const pitch = q[d['pelvis.tilt']] + q[d['lumbar.flex']] + q[d['thorax.flex']]
  setDofs(skel, q, { 'neck.flex': -0.5 * pitch + down, 'head.flex': -0.2 * pitch + down * 0.4 })
}

const dfAt = (c: number, df: { stretch: number; top: number }) => lerp(df.stretch, df.top, c)

function unsupported(p: P): string | null {
  if (p.direction === 'dorsiflexion') return p.support === 'wall' && p.platform === 'floor' && p.implement === 'bodyweight' ? null : `dorsiflexion ${p.support}/${p.platform}`
  if (p.implement === 'machine') {
    if (p.machine === 'calf_machine' && p.posture === 'standing' && p.stance === 'hip') return null
    if (p.machine === 'seated_calf' && p.posture === 'seated') return null
    if (p.machine === 'leg_press') return null
    return `machine ${p.machine}/${p.posture}`
  }
  if ((p.implement === 'bodyweight' || p.implement === 'dumbbell') && p.stance === 'single_leg' && p.support === 'wall' && p.platform === 'step') return null
  if (p.implement === 'dumbbell' && p.posture === 'seated' && p.stance === 'hip' && p.platform === 'floor') return null
  if ((p.implement === 'barbell' || p.implement === 'smith') && p.posture === 'standing' && p.stance === 'hip' && p.support === 'none' && p.platform === 'step') return null
  return `${p.implement}/${p.stance}/${p.support}/${p.platform}`
}

// ---------- standing: machine and step ----------

/** pelvis at `hip` (tilt fixed), planted legs to the balls pitched `pitch` */
function standOnBalls(skel: Skeleton, q: Float64Array, v: Stand, pitch: number, hip: V3) {
  setPelvis(skel, q, hip, v.tilt)
  return legsTo(skel, q, v.feet.map((f) => footOnBall(skel, f.side, f.ball, pitch, f.yaw)))
}

function comOf(skel: Skeleton, q: Float64Array, v: Stand) {
  const f = fk(skel, q)
  const loads = v.db ? [{ mass: v.db.mass, pos: handFrame(skel, f, v.work!).pos }] : v.bar && !v.rail ? [{ mass: v.bar.mass, pos: barAt(skel, f) }] : []
  return centerOfMass(skel, f, loads)
}

/** bar centre on the upper back (the high-bar site in the thorax frame) */
const barAt = (skel: Skeleton, f: FK): V3 => localToWorld(skel, f, 'thorax2', skel.data.sites.back_high.local)

/** hip height at which the planted knee sits at STRAIGHT_KNEE (the knee straightens as the hips rise) */
function hipHeight(skel: Skeleton, q: Float64Array, v: Stand, pitch: number, x: number, z: number) {
  const b = v.feet[0].ball[1]
  const r = root1d((y) => standOnBalls(skel, q, v, pitch, [x, y, z])[0].knee - STRAIGHT_KNEE, b + 0.5, b + 1.2, { tol: 1e-9 })
  standOnBalls(skel, q, v, pitch, [x, r.x, z])
  return r.x
}

/**
 * Lower body for keyed ankle dorsiflexion: foot pitch and hip height so the planted knee sits at STRAIGHT_KNEE, the
 * hips at the machine's fixed z or (step) over the ball with the centre of mass. Nested 1-D root finds, so the result
 * depends only on the inputs. Returns the foot pitch.
 */
function solveStand(skel: Skeleton, q: Float64Array, v: Stand, df: number): number {
  // the balls' midpoint (one foot: its ball)
  const ball = scale(v.feet.reduce((a, f) => add(a, f.ball), [0, 0, 0] as V3), 1 / v.feet.length)
  const fixed = v.kind === 'machine' || !!v.rail
  let x = fixed ? 0 : ball[0] * 1.8
  let z = fixed ? v.hipZ! : ball[2] - 0.1
  const pitchFor = () => root1d((pitch) => {
    hipHeight(skel, q, v, pitch, x, z)
    return legsDf(skel, q, v) - df
  }, -45, 70, { tol: 1e-9 }).x
  let pitch = pitchFor()
  if (!fixed) {
    // the centre of mass moves almost one to one with the hips
    for (let k = 0; k < 6; k++) {
      const com = comOf(skel, q, v)
      const ex = ball[0] - com[0], ez = ball[2] + STEP_COM - com[2]
      if (Math.hypot(ex, ez) < 2e-5) break
      x += ex
      z += ez
      pitch = pitchFor()
    }
  }
  hipHeight(skel, q, v, pitch, x, z)
  return pitch
}

function legsDf(skel: Skeleton, q: Float64Array, v: Stand) {
  return q[skel.dof[`ankle_${v.feet[0].side}.df`]]
}

function standTrunk(skel: Skeleton, q: Float64Array) {
  setDofs(skel, q, { 'lumbar.flex': 0, 'thorax.flex': 2 })
}

/** machine: trunk, shoulder girdle fixed (the pads sit on it) and the arms at a nominal pose until solved */
function machineUpper(skel: Skeleton, q: Float64Array) {
  standTrunk(skel, q)
  setDofs(skel, q, {
    'clavicle_*.elev': YOKE_GIRDLE.elev, 'clavicle_*.prot': YOKE_GIRDLE.prot, 'scapula_*.uprot': YOKE_GIRDLE.uprot,
    'shoulder_*.plane': 70, 'shoulder_*.elev': 30, 'elbow_*.flex': 100, 'grip_*.close': 1,
  })
}

function standContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const machine = p.implement === 'machine'
  if (machine) {
    const half = stanceWidth(skel, 'hip') / 2
    const top = CALF_STANDING.barTop
    const feet = (['l', 'r'] as const).map((side) => ({ side, ball: [side === 'l' ? half : -half, top, 0] as V3, yaw: 4 }))
    const bar = footBar({ id: 'calf', kind: 'calf_machine', top: [0, top, 0], balls: { ball_l: feet[0].ball, ball_r: feet[1].ball } })
    const v: Stand = { kind: 'machine', feet, tilt: 2, df: STANDING_DF, hipZ: -0.05 }
    // hips placed so the centre of mass sits MACHINE_COM behind the balls at mid-rep (it barely moves in z)
    const q = zeroQ(skel)
    machineUpper(skel, q)
    for (let k = 0; k < 3; k++) {
      solveStand(skel, q, v, dfAt(0.5, v.df))
      v.hipZ! += MACHINE_COM - comOf(skel, q, v)[2]
    }
    solveStand(skel, q, v, dfAt(0.5, v.df))
    // yoke: pads rest on the shoulders, the upper body only translates with the hips over the rep
    const f = fk(skel, q)
    const girdle = bodyCapsules(skel, f).filter((c) => c.region.startsWith('girdle_'))
    const mid = scale(add(girdle[0].a, girdle[1].a), 0.5)
    const yoke = calfYoke()
    const probe = { ...yoke, parts: yoke.parts.filter((x) => x.shape === 'box') }
    const lift = (y: number) => {
      const solids = placeParts(probe, { id: 'yoke', pos: [0, y, mid[2]], rot: qid() })
      return Math.min(...girdle.flatMap((c) => solids.map((s) => capsuleSolidClearance(c, s)))) + PAD_SINK + GIRDLE_PROUD
    }
    const y = root1d(lift, mid[1], mid[1] + 0.2, { tol: 1e-7 }).x
    const hip = add(localToWorld(skel, f, 'pelvis', hipMidLocal(skel)), [0, 0, 0])
    v.yokeFromHip = sub([0, y, mid[2]], hip)
    const contacts: Contact[] = [
      ...feet.map((ft): Contact => ({ site: `ball_${ft.side}`, kind: 'planted', target: { world: ft.ball } })),
      { site: 'grip_l', kind: 'grip', target: { implement: 'yoke', grip: 'l' } },
      { site: 'grip_r', kind: 'grip', target: { implement: 'yoke', grip: 'r' } },
    ]
    const rests = [{ implement: 'yoke', regions: ['girdle_l', 'girdle_r'], tol: YOKE_REST }]
    return { tempo, v, setup: { implements: [bar, yoke], contacts, tempo, symmetric: true, rests } }
  }
  if (p.implement === 'barbell' || p.implement === 'smith') return barContext(p, skel, tempo)
  const work: Side = p.side === 'left' ? 'l' : 'r'
  const sgn = work === 'r' ? -1 : 1
  const ball: V3 = [sgn * 0.075, STEP_BOX, 0]
  const box = calfStep({ id: 'box', height: STEP_BOX })
  const boxPose: ImplementPose = { id: 'box', pos: [ball[0], 0, ball[2] - BALL_IN + PLYO_BOX.depth / 2], rot: qid() }
  box.sites.ball = { pos: sub(ball, boxPose.pos), normal: [0, 1, 0] }
  const wall = wallSection({ id: 'wall' })
  const wallPose: ImplementPose = { id: 'wall', pos: [-sgn * 0.12, 0, WALL_Z], rot: qaxis([0, 1, 0], Math.PI) }
  const v: Stand = {
    kind: 'step',
    feet: [{ side: work, ball, yaw: 5 }],
    work,
    tilt: 3,
    df: STANDING_DF,
    box: { spec: box, pose: boxPose },
    wall: { spec: wall, pose: wallPose },
  }
  const implements_: ImplementSpec[] = [box, wall]
  const contacts: Contact[] = [{ site: `ball_${work}`, kind: 'planted', target: { world: ball } }]
  if (p.implement === 'dumbbell') {
    v.db = dumbbell({ id: 'db', mass: DB_KG })
    implements_.push(v.db)
    contacts.push({ site: `grip_${work}`, kind: 'grip', target: { implement: 'db', grip: 'c' } })
  }
  // the free hand rests on the wall at shoulder height, beside the shoulder
  const q = zeroQ(skel)
  stepUpper(skel, q, v)
  solveStand(skel, q, v, dfAt(0.5, v.df))
  const sh = fk(skel, q).pos[skel.seg[`humerus_${other(work)}`]]
  const hand: V3 = [sh[0] - sgn * 0.1, sh[1] + 0.02, WALL_Z - WALL_STANDOFF]
  wall.sites.hand = { pos: qrot(qconj(wallPose.rot), sub(hand, wallPose.pos)), axis: [1, 0, 0], normal: [0, 0, 1] }
  contacts.push({ site: `grip_${other(work)}`, kind: 'grip', target: { implement: 'wall', grip: 'hand' } })
  const setup: Setup = {
    implements: implements_,
    contacts,
    tempo,
    symmetric: false,
    balance: { point: 'com', over: { implement: 'box', sites: ['ball'] }, tol: 0.025, target: STEP_COM },
    // the forefoot capsule is rigid with the foot but covers the toes, which extend flat on the step at the top
    rests: [{ implement: 'box', regions: [`foot_${work}`], tol: FOREFOOT_REST }],
  }
  return { tempo, v, setup }
}

// ---------- bar on the back, on a step ----------

/** bar: 60 kg, grip as the back squat's (multiple of shoulder width); the bar may sink this far into the upper back, mm */
const BAR = { plateKg: 20, grip: 2.1, rest: 20 }
const BAR_REST = ['trunk', 'girdle_l', 'girdle_r', 'neck', 'upperarm_l', 'upperarm_r']

/** trunk, shoulder girdle and the arms on the bar (solved once, constant) */
function barUpper(skel: Skeleton, q: Float64Array, v: Stand) {
  standTrunk(skel, q)
  setDofs(skel, q, { 'clavicle_*.prot': -12, 'clavicle_*.elev': 4, 'grip_*.close': 1 })
  if (v.barArms) for (const [i, x] of v.barArms) q[i] = x
}

/**
 * Both forefeet on the step edge, the bar on the upper back. Free bar: the body leans until the centre of mass with
 * the bar sits over the balls. Smith: the rails carry the bar on a fixed line, so the hips keep the z where that
 * balance falls at mid-rep and only rise and sink.
 */
function barContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const half = stanceWidth(skel, 'hip') / 2
  const feet = (['l', 'r'] as const).map((side) => ({ side, ball: [side === 'l' ? half : -half, STEP_BOX, 0] as V3, yaw: 4 }))
  const box = calfStep({ id: 'box', height: STEP_BOX })
  const boxPose: ImplementPose = { id: 'box', pos: [0, 0, -BALL_IN + PLYO_BOX.depth / 2], rot: qid() }
  box.sites.ball = { pos: sub([0, STEP_BOX, 0], boxPose.pos), normal: [0, 1, 0] }
  const bar = barbell({ gripWidth: BAR.grip * skel.data.shoulderWidth, plateKg: BAR.plateKg })
  const rail = p.implement === 'smith'
  const v: Stand = { kind: 'bar', feet, tilt: 3, df: STANDING_DF, box: { spec: box, pose: boxPose }, bar, rail, hipZ: -0.1 }
  // arms on the bar in a mid-rep pose, left solved and mirrored (as the back squat's high bar)
  const q = zeroQ(skel)
  barUpper(skel, q, v)
  v.hipZ = undefined
  v.rail = false
  solveStand(skel, q, v, dfAt(0.5, v.df))
  const f = fk(skel, q)
  const T = (x: number, y: number, z: number) => qrot(f.rot[skel.seg.thorax2], [x, y, z])
  const g = siteWorld(bar, { id: bar.id, pos: barAt(skel, f), rot: qid() }, 'l')
  attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm: T(0, 0.3, 1) }, { pole: T(0.4, -0.7, -0.6), wristBias: 10, planeHint: -90 })
  v.barArms = ARM_DOFS.flatMap((k) => {
    const x = q[skel.dof[k.replace('*', 'l')]]
    return [[skel.dof[k.replace('*', 'l')], x], [skel.dof[k.replace('*', 'r')], x]] as [number, number][]
  })
  const implements_: ImplementSpec[] = [box, bar]
  if (rail) {
    // the balanced mid-rep hips set the rail line
    barUpper(skel, q, v)
    solveStand(skel, q, v, dfAt(0.5, v.df))
    v.hipZ = localToWorld(skel, fk(skel, q), 'pelvis', hipMidLocal(skel))[2]
    v.rail = true
    solveStand(skel, q, v, dfAt(0.5, v.df))
    const z = barAt(skel, fk(skel, q))[2]
    implements_.push({ id: 'smith', kind: 'bench', mass: 0, com: [0, 0, 0], parts: [cyl([0.6, 0, z], [0.6, 2.25, z], 0.025), cyl([-0.6, 0, z], [-0.6, 2.25, z], 0.025), cyl([-0.6, 2.25, z], [0.6, 2.25, z], 0.03)], sites: {} })
  }
  const contacts: Contact[] = [
    ...feet.map((ft): Contact => ({ site: `ball_${ft.side}`, kind: 'planted', target: { world: ft.ball } })),
    { site: 'grip_l', kind: 'grip', target: { implement: bar.id, grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: bar.id, grip: 'r' } },
  ]
  const setup: Setup = {
    implements: implements_,
    contacts,
    tempo,
    symmetric: true,
    // free bar: centre of mass with the bar over the balls; on the Smith rails the bar's line holds the body
    balance: rail ? undefined : { point: 'com', over: { implement: 'box', sites: ['ball'] }, tol: 0.025, target: STEP_COM },
    rests: [{ implement: 'box', regions: ['foot_l', 'foot_r'], tol: FOREFOOT_REST }, { implement: bar.id, regions: BAR_REST, tol: BAR.rest }],
  }
  return { tempo, v, setup }
}

function sampleBar(c: number, skel: Skeleton, ctx: Ctx, v: Stand): Pose {
  const q = zeroQ(skel)
  barUpper(skel, q, v)
  const pitch = solveStand(skel, q, v, dfAt(c, v.df))
  for (const f of v.feet) toes(skel, q, f.side, pitch)
  gaze(skel, q)
  const implements_: ImplementPose[] = [v.box!.pose, { id: v.bar!.id, pos: barAt(skel, fk(skel, q)), rot: qid() }]
  if (v.rail) implements_.push({ id: 'smith', pos: [0, 0, 0], rot: qid() })
  return { q, implements: implements_, contacts: ctx.setup.contacts }
}

/** free leg tucked back, working arm with the dumbbell or relaxed, the wall arm at a nominal pose */
function stepUpper(skel: Skeleton, q: Float64Array, v: Stand) {
  const w = v.work!, fr = other(w)
  standTrunk(skel, q)
  setDofs(skel, q, { [`hip_${fr}.flex`]: 20, [`hip_${fr}.abd`]: 4, [`knee_${fr}.flex`]: 80, [`ankle_${fr}.df`]: -22 })
  if (v.db) setDofs(skel, q, { [`shoulder_${w}.plane`]: 0, [`shoulder_${w}.elev`]: 17, [`shoulder_${w}.rot`]: 0, [`elbow_${w}.flex`]: 6, [`forearm_${w}.pro`]: 0, [`grip_${w}.close`]: 1 })
  else setDofs(skel, q, { [`shoulder_${w}.plane`]: 30, [`shoulder_${w}.elev`]: 9, [`elbow_${w}.flex`]: 14, [`forearm_${w}.pro`]: 10, [`grip_${w}.close`]: 0.3 })
  setScapula(skel, q, w)
  setDofs(skel, q, { [`shoulder_${fr}.plane`]: 75, [`shoulder_${fr}.elev`]: 70, [`elbow_${fr}.flex`]: 50, [`grip_${fr}.close`]: 0.4 })
  setScapula(skel, q, fr)
}

/** palm on the wall (facing +Z), fingers up and turned a little out */
function wallHand(side: Side): Quat {
  const s = side === 'l' ? 1 : -1
  const fingers = norm([s * 0.25, 1, 0])
  return qfromBasis([0, 0, -s], neg(fingers))
}

function sampleStand(c: number, skel: Skeleton, ctx: Ctx, v: Stand): Pose {
  const q = zeroQ(skel)
  const df = dfAt(c, v.df)
  if (v.kind === 'machine') {
    machineUpper(skel, q)
    const pitch = solveStand(skel, q, v, df)
    for (const f of v.feet) toes(skel, q, f.side, pitch, 18)
    const hip = localToWorld(skel, fk(skel, q), 'pelvis', hipMidLocal(skel))
    const yoke: ImplementPose = { id: 'yoke', pos: add(hip, v.yokeFromHip!), rot: qid() }
    const g = siteWorld(ctx.setup.implements[1], yoke, 'l')
    attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm: [-1, 0, 0.2] }, { pole: [0.4, -1, -0.4], planeHint: 60, uprot: YOKE_GIRDLE.uprot })
    mirrorArm(skel, q)
    gaze(skel, q)
    return { q, implements: [{ id: 'calf', pos: [0, 0, 0], rot: qid() }, yoke], contacts: ctx.setup.contacts }
  }
  stepUpper(skel, q, v)
  const pitch = solveStand(skel, q, v, df)
  toes(skel, q, v.work!, pitch)
  const fr = other(v.work!)
  const g = siteWorld(v.wall!.spec, v.wall!.pose, 'hand')
  attachHand(skel, q, fr, { pos: g.pos, axis: [1, 0, 0], palm: [0, 0, 1], hand: wallHand(fr) }, { pole: [fr === 'l' ? 0.3 : -0.3, -1, -0.2], planeHint: 75 })
  gaze(skel, q, 6)
  const implements_: ImplementPose[] = [v.box!.pose, v.wall!.pose]
  if (v.db) {
    const h = handFrame(skel, fk(skel, q), v.work!)
    implements_.push({ id: 'db', pos: h.pos, rot: implementFromHand(h.axis, h.palm) })
  }
  return { q, implements: implements_, contacts: ctx.setup.contacts }
}

// ---------- tibialis raise ----------

function tibFoot(skel: Skeleton, side: Side, pivotWorld: V3, yaw: number, lift: number): FootTarget {
  const rot = qmul(qaxis([0, 1, 0], (side === 'l' ? yaw : -yaw) * DEG), qaxis([1, 0, 0], -lift * DEG))
  const local = add(skel.data.sites[`heel_${side}`].local, [0, 0, -TIB_PIVOT_BACK])
  return { side, rot, ankle: sub(pivotWorld, qrot(rot, local)) }
}

function tibUpper(skel: Skeleton, q: Float64Array) {
  setDofs(skel, q, {
    'lumbar.flex': 2, 'thorax.flex': -2, 'shoulder_*.plane': 35, 'shoulder_*.elev': 11, 'shoulder_*.rot': 10, 'elbow_*.flex': 14,
    'forearm_*.pro': 20, 'grip_*.close': 0.3,
  })
  setScapula(skel, q, 'l')
  setScapula(skel, q, 'r')
}

function placeTib(skel: Skeleton, q: Float64Array, v: Tib, lift: number) {
  const feet = v.feet.map((f) => tibFoot(skel, f.side, f.pivot, f.yaw, lift))
  const r = root1d((y) => {
    setPelvis(skel, q, [0, y, v.hipZ], TIB.trunk)
    return legsTo(skel, q, feet)[0].knee - TIB.knee
  }, 0.7, 1.1, { tol: 1e-8 })
  setPelvis(skel, q, [0, r.x, v.hipZ], TIB.trunk)
  legsTo(skel, q, feet)
}

function tibContext(skel: Skeleton, tempo: Tempo): Ctx {
  const half = stanceWidth(skel, 'hip') / 2
  const feet = (['l', 'r'] as const).map((side) => ({ side, pivot: [side === 'l' ? half : -half, 0, 0] as V3, yaw: 5 }))
  // hips back from the heels by the lean
  const lt = skel.segments[skel.seg.femur_l].length, ls = skel.segments[skel.seg.tibia_l].length
  const reach = Math.sqrt(lt * lt + ls * ls + 2 * lt * ls * Math.cos(TIB.knee * DEG))
  const ankle0 = tibFoot(skel, 'l', feet[0].pivot, 5, 0).ankle
  const v: Tib = { kind: 'tib', feet, hipZ: ankle0[2] - reach * Math.sin(TIB.lean * DEG), wall: { id: 'wall', pos: [0, 0, 0], rot: qid() } }
  const q = zeroQ(skel)
  tibUpper(skel, q)
  placeTib(skel, q, v, 0)
  // wall face just behind the back (glutes and upper back); the trunk only slides vertically over the rep
  const caps = bodyCapsules(skel, fk(skel, q)).filter((c) => c.region === 'trunk')
  v.wall.pos = [0, 0, Math.min(...caps.flatMap((c) => [c.a[2] - c.r, c.b[2] - c.r])) + 0.0015]
  const contacts: Contact[] = feet.map((f) => {
    const flat = tibFoot(skel, f.side, f.pivot, f.yaw, 0)
    return { site: `heel_${f.side}`, kind: 'planted', target: { world: add(flat.ankle, qrot(flat.rot, skel.data.sites[`heel_${f.side}`].local)) } }
  })
  const setup: Setup = { implements: [wallSection({ id: 'wall' })], contacts, tempo, symmetric: true }
  return { tempo, v, setup }
}

function sampleTib(c: number, skel: Skeleton, ctx: Ctx, v: Tib): Pose {
  const q = zeroQ(skel)
  tibUpper(skel, q)
  const lift = TIB.lift * c
  placeTib(skel, q, v, lift)
  for (const f of v.feet) q[skel.dof[`toe_${f.side}.flex`]] = -8 * c
  gaze(skel, q, 14)
  return { q, implements: [v.wall], contacts: ctx.setup.contacts }
}

// ---------- seated calf machine ----------

function seatedUpper(skel: Skeleton, q: Float64Array) {
  setDofs(skel, q, { 'lumbar.flex': 4, 'thorax.flex': 4, 'grip_*.close': 1, 'clavicle_*.prot': 6 })
}

const SEATED_POLE: V3 = [0, 1, 0.6]

function seatedLegs(skel: Skeleton, q: Float64Array, feet: Seated['feet'], pitch: number) {
  setPelvis(skel, q, SEAT_HIP, 4)
  return legsTo(skel, q, feet.map((f) => footOnBall(skel, f.side, f.ball, pitch, f.yaw)), SEATED_POLE)
}

function seatedPitch(skel: Skeleton, q: Float64Array, feet: Seated['feet'], df: number) {
  return root1d((pitch) => seatedLegs(skel, q, feet, pitch)[0].ankle[0] - df, -45, 60, { tol: 1e-8 }).x
}

/** the pads' lever angle (deg about X at the pivot) at which the pad rests on the thighs */
function leverAngle(skel: Skeleton, f: FK, v: Pick<Seated, 'pivot' | 'lever'>) {
  const thighs = bodyCapsules(skel, f).filter((c) => c.region.startsWith('thigh_'))
  const pad = { ...v.lever, parts: v.lever.parts.slice(0, 1) }
  const gap = (a: number) => {
    const [s] = placeParts(pad, { id: 'lever', pos: v.pivot, rot: qaxis([1, 0, 0], a * DEG) })
    return Math.min(...thighs.map((c) => capsuleSolidClearance(c, s))) + THIGH_SINK
  }
  return root1d(gap, -25, 25, { tol: 1e-7 }).x
}

function seatedContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const half = stanceWidth(skel, 'hip') / 2
  const top = 0.15
  const at = (z: number) => (['l', 'r'] as const).map((side) => ({ side, ball: [side === 'l' ? half : -half, top, z] as V3, yaw: 0 }))
  const q = zeroQ(skel)
  seatedUpper(skel, q)
  const mid = dfAt(0.5, SEATED_DF)
  // foot bar placed so the knees sit at kneeAngle at mid-rep
  const z = root1d((zb) => {
    const feet = at(zb)
    seatedPitch(skel, q, feet, mid)
    return seatedLegs(skel, q, feet, seatedPitch(skel, q, feet, mid))[0].knee - p.kneeAngle
  }, 0.35, 0.8, { tol: 1e-7 }).x
  const feet = at(z)
  seatedLegs(skel, q, feet, seatedPitch(skel, q, feet, mid))
  const f = fk(skel, q)
  // pad across both thighs just above the knees, its underside along the thighs; pivot ahead of the knees and lower
  const knee = scale(add(f.pos[skel.seg.tibia_l], f.pos[skel.seg.tibia_r]), 0.5)
  const hip = scale(add(f.pos[skel.seg.femur_l], f.pos[skel.seg.femur_r]), 0.5)
  const along = norm(sub(knee, hip))
  const up = norm(cross(along, [1, 0, 0]))
  const padC = add(add(knee, scale(along, -PAD_FROM_KNEE)), scale(up, 0.09 + CALF_SEATED.pad.size[1] / 2))
  const pivot = add(knee, [0, -0.2, 0.36])
  const padRot = qfromBasis([1, 0, 0], up)
  const v: Seated = { kind: 'seated', feet, pivot, lever: seatedLever({ padAt: sub(padC, pivot), padRot, up }), tilt: 0 }
  // settle the pad onto the thighs at the reference pose: that lever angle becomes zero
  const r0 = qaxis([1, 0, 0], leverAngle(skel, f, v) * DEG)
  const lever = seatedLever({ padAt: qrot(r0, sub(padC, pivot)), padRot: qmul(r0, padRot), up: qrot(r0, up) })
  v.lever = lever
  const seatBox = restAgainst(bodyCapsules(skel, f).filter((c) => c.region === 'trunk' || c.region.startsWith('thigh_')), { shape: 'box', center: [0, SEAT_HIP[1] - 0.12, 0.02], size: CALF_SEATED.seat.size, pad: true }, [0, -1, 0])
  const bar = footBar({ id: 'calf_bar', kind: 'seated_calf', top: [0, top, z], balls: { ball_l: feet[0].ball, ball_r: feet[1].ball } })
  const seat: ImplementSpec = { id: 'calf_seat', kind: 'seated_calf', mass: 0, com: [0, 0, 0], parts: [seatBox], sites: {} }
  const contacts: Contact[] = [
    ...feet.map((ft): Contact => ({ site: `ball_${ft.side}`, kind: 'planted', target: { world: ft.ball } })),
    { site: 'grip_l', kind: 'grip', target: { implement: 'lever', grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: 'lever', grip: 'r' } },
  ]
  return { tempo, v, setup: { implements: [seat, bar, lever], contacts, tempo, symmetric: true } }
}

function sampleSeated(c: number, skel: Skeleton, ctx: Ctx, v: Seated): Pose {
  const q = zeroQ(skel)
  seatedUpper(skel, q)
  const pitch = seatedPitch(skel, q, v.feet, dfAt(c, SEATED_DF))
  for (const f of v.feet) toes(skel, q, f.side, pitch, 18)
  const a = leverAngle(skel, fk(skel, q), v)
  const lever: ImplementPose = { id: 'lever', pos: v.pivot, rot: qaxis([1, 0, 0], a * DEG) }
  const g = siteWorld(v.lever, lever, 'l')
  attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm: [-1, 0, -0.2] }, { pole: [0.5, -1, -0.4], planeHint: 60 })
  mirrorArm(skel, q)
  gaze(skel, q, 8)
  return { q, implements: [{ id: 'calf_seat', pos: [0, 0, 0], rot: qid() }, { id: 'calf_bar', pos: [0, 0, 0], rot: qid() }, lever], contacts: ctx.setup.contacts }
}

// ---------- seated on a bench end, dumbbells on the thighs ----------

/** perched on the bench end: heels from flat on the floor to a high raise (deg); toes stay on the floor */
const PERCH_DF_TOP = -34
const PERCH_DB_KG = 16
/** dumbbells stand on the thighs this far back from the knee joint, m; the lower head sinks this far into the thigh */
const PERCH_DB = { back: 0.1, sink: 0.004 }
const PERCH_POLE: V3 = [0, 1, 0.6]

function perchLegs(skel: Skeleton, q: Float64Array, v: Pick<Perch, 'feet' | 'hip'>, pitch: number) {
  setPelvis(skel, q, v.hip, 4)
  return legsTo(skel, q, v.feet.map((f) => footOnBall(skel, f.side, f.ball, pitch, f.yaw)), PERCH_POLE)
}

function perchPitch(skel: Skeleton, q: Float64Array, v: Pick<Perch, 'feet' | 'hip'>, df: number) {
  return root1d((pitch) => perchLegs(skel, q, v, pitch)[0].ankle[0] - df, -10, 60, { tol: 1e-8 }).x
}

/**
 * Perched on the end of a flat bench, shins upright and the feet flat at the bottom of the rep; the heels rise about
 * the balls on the floor. The bench height follows from the legs (thighs level with the knees at kneeAngle), and a
 * dumbbell stands on each lower thigh, held upright by its handle.
 */
function perchContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const half = stanceWidth(skel, 'hip') / 2
  const feet = (['l', 'r'] as const).map((side) => ({ side, ball: [side === 'l' ? half : -half, 0, 0] as V3, yaw: 0 }))
  const q = zeroQ(skel)
  seatedUpper(skel, q)
  // hips level with the knees, the feet flat: the knee angle sets how far behind the balls the hips sit
  const v: Perch = { kind: 'perch', feet, hip: [0, 0.5, -0.3], bench: { id: 'bench', pos: [0, 0, 0], rot: qid() }, dbs: [] }
  const level = () => {
    const f = fk(skel, q)
    return f.pos[skel.seg.tibia_l][1] - f.pos[skel.seg.femur_l][1]
  }
  for (let k = 0; k < 6; k++) {
    v.hip[1] = root1d((y) => {
      v.hip[1] = y
      perchLegs(skel, q, v, 0)
      return level()
    }, 0.3, 0.8, { tol: 1e-8 }).x
    v.hip[2] = root1d((z) => {
      v.hip[2] = z
      return perchLegs(skel, q, v, 0)[0].knee - p.kneeAngle
    }, -0.7, -0.05, { tol: 1e-8 }).x
  }
  perchLegs(skel, q, v, 0)
  const f = fk(skel, q)
  const caps = bodyCapsules(skel, f)
  // bench: seat end under the buttocks and thighs (the seat pad runs z 0..0.44 from the bench origin)
  const under = caps.filter((c) => c.region === 'trunk' || c.region.startsWith('thigh_'))
  const seatTop = Math.min(...under.filter((c) => c.region === 'trunk').map((c) => Math.min(c.a[1], c.b[1]) - c.r)) + 0.006
  v.bench = { id: 'bench', pos: [0, seatTop, v.hip[2] - 0.3], rot: qid() }
  const bench = flatBench({ seatHeight: seatTop })
  // dumbbells upright on the lower thighs, the lower head's face on the thigh
  const specs = (['l', 'r'] as const).map((side) => dumbbell({ id: `db_${side}`, mass: PERCH_DB_KG }))
  const upright = qaxis([0, 0, 1], Math.PI / 2)
  for (const [k, spec] of specs.entries()) {
    const side: Side = k === 0 ? 'l' : 'r'
    const knee = f.pos[skel.seg[`tibia_${side}`]]
    const thigh = caps.filter((c) => c.region === `thigh_${side}`)
    const at = (y: number): ImplementPose => ({ id: spec.id, pos: [knee[0], y, knee[2] - PERCH_DB.back], rot: upright })
    const gap = (y: number) => Math.min(...placeParts(spec, at(y)).flatMap((sd) => thigh.map((c) => capsuleSolidClearance(c, sd)))) + PERCH_DB.sink
    const pose = at(root1d(gap, knee[1], knee[1] + 0.5, { tol: 1e-7 }).x)
    const fr = f.rot[skel.seg[`femur_${side}`]], fp = f.pos[skel.seg[`femur_${side}`]]
    v.dbs.push({ id: spec.id, side, pos: qrot(qconj(fr), sub(pose.pos, fp)), rot: qmul(qconj(fr), pose.rot) })
  }
  const contacts: Contact[] = [
    ...feet.map((ft): Contact => ({ site: `ball_${ft.side}`, kind: 'planted', target: { world: ft.ball } })),
    { site: 'grip_l', kind: 'grip', target: { implement: 'db_l', grip: 'c' } },
    { site: 'grip_r', kind: 'grip', target: { implement: 'db_r', grip: 'c' } },
  ]
  const setup: Setup = {
    implements: [bench, ...specs],
    contacts,
    tempo,
    symmetric: true,
    rests: [{ implement: 'db_l', regions: ['thigh_l'], tol: 8 }, { implement: 'db_r', regions: ['thigh_r'], tol: 8 }],
    // the forefoot capsule is rigid with the foot and dips into the floor as the heel rises, where the real toes
    // extend flat on it (as on the standing step, lead decision)
    tolerances: { floor: FOREFOOT_REST },
  }
  return { tempo, setup, v }
}

function samplePerch(c: number, skel: Skeleton, ctx: Ctx, v: Perch): Pose {
  const q = zeroQ(skel)
  seatedUpper(skel, q)
  perchLegs(skel, q, v, 0)
  const flat = q[skel.dof['ankle_l.df']]
  const pitch = perchPitch(skel, q, v, lerp(flat, PERCH_DF_TOP, c))
  for (const f of v.feet) toes(skel, q, f.side, pitch)
  const f = fk(skel, q)
  const dbs: ImplementPose[] = v.dbs.map((d) => {
    const fr = f.rot[skel.seg[`femur_${d.side}`]], fp = f.pos[skel.seg[`femur_${d.side}`]]
    return { id: d.id, pos: add(fp, qrot(fr, d.pos)), rot: qmul(fr, d.rot) }
  })
  const spec = ctx.setup.implements.find((s) => s.id === 'db_l')!
  const g = siteWorld(spec, dbs[0], 'c')
  attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm: [-1, 0, 0] }, { pole: [0.6, -0.3, -1], planeHint: 40 })
  mirrorArm(skel, q)
  gaze(skel, q, 10)
  return { q, implements: [v.bench, ...dbs], contacts: ctx.setup.contacts }
}

// ---------- leg press ----------
// The lifter sits as in the leg press squat (squat.ts), so the drawn machine's seat, back pad and handles fit.

const PRESS_HIP: V3 = [0, 0.62, 0]
const PRESS_RECLINE = 53
const PRESS_SEAT = { along: 0.114, drop: 0.0545, tilt: 25 }
const SEAT_ROT = qmul(qaxis([1, 0, 0], -PRESS_SEAT.tilt * DEG), qfromBasis([1, 0, 0], [0, 1, 0]))
const SEAT_PAD = 0.06
/** the drawn plate (props/legpress.ts): surface at the sled origin, bottom lip `lip` along the plate, `lipH` proud */
const PLATE = { lip: -0.285, lipW: 0.02, lipH: 0.024, faceLow: -0.28, faceHigh: 0.38 }
/** ball on the lip, this far below its upper edge */
const BALL_ON_LIP = 0.005

function pressPelvis(skel: Skeleton, q: Float64Array, shift: V3) {
  setDofs(skel, q, {
    'lumbar.flex': 4, 'thorax.flex': 6, 'neck.flex': 22, 'head.flex': 10, 'clavicle_*.prot': -5, 'grip_*.close': 1,
    'shoulder_*.plane': 35, 'shoulder_*.elev': 22, 'elbow_*.flex': 55, 'forearm_*.pro': 10,
  })
  setPelvis(skel, q, add(PRESS_HIP, shift), -(PRESS_RECLINE + 10))
}

function pressSeat(skel: Skeleton, f: FK) {
  const guess = add(localToWorld(skel, f, 'pelvis', [0, -0.12, 0.12]), [0, -0.03, 0])
  const trunk = bodyCapsules(skel, f).filter((c) => c.region === 'trunk')
  return restAgainst(trunk, { shape: 'box', center: guess, size: [0.42, SEAT_PAD, 0.42], rot: SEAT_ROT, pad: true }, neg(qrot(SEAT_ROT, [0, 1, 0])))
}

function pressShift(skel: Skeleton): V3 {
  const q = zeroQ(skel)
  pressPelvis(skel, q, [0, 0, 0])
  const seat = pressSeat(skel, fk(skel, q))
  const n = qrot(SEAT_ROT, [0, 1, 0])
  const t = PRESS_SEAT.tilt * DEG
  const drawn = add(PRESS_HIP, add(scale([0, Math.sin(t), Math.cos(t)], PRESS_SEAT.along), scale(n, -PRESS_SEAT.drop)))
  return scale(n, dot(sub(drawn, add(seat.center, scale(n, SEAT_PAD / 2))), n))
}

function pressFeet(skel: Skeleton, v: Pick<Press, 'd' | 'sledRot' | 'feet'>, s: number, pitch: number): FootTarget[] {
  const origin = add(PRESS_HIP, scale(v.d, s))
  return v.feet.map((f) => footOnBall(skel, f.side, add(origin, qrot(v.sledRot, f.local)), pitch, f.yaw, v.sledRot))
}

/** sled travel and foot pitch for keyed dorsiflexion with the knees at STRAIGHT_KNEE (nested 1-D root finds) */
function pressSolve(skel: Skeleton, q: Float64Array, v: Press, df: number): [number, number] {
  const sledFor = (pitch: number) => root1d((s) => legsTo(skel, q, pressFeet(skel, v, s, pitch))[0].knee - STRAIGHT_KNEE, 1.3, 0.6, { tol: 1e-9 }).x
  const pitch = root1d((pitch) => {
    legsTo(skel, q, pressFeet(skel, v, sledFor(pitch), pitch))
    return q[skel.dof['ankle_l.df']] - df
  }, -45, 70, { tol: 1e-9 }).x
  const s = sledFor(pitch)
  legsTo(skel, q, pressFeet(skel, v, s, pitch))
  return [s, pitch]
}

function pressContext(skel: Skeleton, tempo: Tempo): Ctx {
  const a = 45 * DEG
  const d: V3 = [0, Math.sin(a), Math.cos(a)]
  const up: V3 = [0, Math.cos(a), -Math.sin(a)]
  const sledRot = qfromBasis([1, 0, 0], neg(d))
  const half = stanceWidth(skel, 'hip') / 2
  const shift = pressShift(skel)
  const q = zeroQ(skel)
  pressPelvis(skel, q, shift)
  const e = PLATE.lip + PLATE.lipW / 2 - BALL_ON_LIP
  const feet = (['l', 'r'] as const).map((side) => ({ side, local: [side === 'l' ? half : -half, PLATE.lipH, e] as V3, yaw: 3 }))
  const sledSites: Record<string, { pos: V3; normal?: V3 }> = {}
  for (const ft of feet) sledSites[`ball_${ft.side}`] = { pos: ft.local, normal: [0, 1, 0] }
  const w = 0.36
  const sled: ImplementSpec = {
    id: 'sled',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [
      // not marked padded, so the feet's rest tolerance applies (the drawn plate is collided as this part)
      { shape: 'box', center: [0, -0.019, (PLATE.faceLow + PLATE.faceHigh) / 2], size: [2 * w, 0.038, PLATE.faceHigh - PLATE.faceLow] },
      { shape: 'box', center: [0, PLATE.lipH / 2, PLATE.lip], size: [2 * w, PLATE.lipH, PLATE.lipW] },
    ],
    sites: sledSites,
  }
  const v: Press = { kind: 'press', d, sledRot, feet, shift, sled }
  const f0 = fk(skel, q)
  const hand = (side: Side) => handFrame(skel, f0, side)
  const handle = (side: Side) => {
    const h = hand(side)
    return cyl(add(h.pos, scale(h.axis, -0.1)), add(h.pos, scale(h.axis, 0.1)), 0.016)
  }
  const handles: ImplementSpec = {
    id: 'handles',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [handle('l'), handle('r')],
    sites: { l: { pos: hand('l').pos, axis: hand('l').axis }, r: { pos: hand('r').pos, axis: hand('r').axis } },
  }
  const back = norm(sub(f0.pos[skel.seg.neck1], f0.pos[skel.seg.pelvis]))
  const behind = norm(cross(back, [1, 0, 0]))
  const padRot = qfromBasis([1, 0, 0], neg(behind))
  const padGuess = add(scale(add(f0.pos[skel.seg.pelvis], f0.pos[skel.seg.neck1]), 0.5), scale(behind, 0.14))
  const trunk = bodyCapsules(skel, f0).filter((c) => c.region === 'trunk')
  const padBox = restAgainst(trunk, { shape: 'box', center: padGuess, size: [0.4, 0.06, 0.75], rot: padRot, pad: true }, behind)
  const seatBox = pressSeat(skel, f0)
  const s0 = pressSolve(skel, q, v, PRESS_DF.stretch)[0], s1 = pressSolve(skel, q, v, PRESS_DF.top)[0]
  const railFrom = add(PRESS_HIP, add(scale(d, Math.min(s0, s1) + 0.05), scale(up, -0.3)))
  const railTo = add(PRESS_HIP, add(scale(d, Math.max(s0, s1) + 0.6), scale(up, -0.3)))
  const frame: ImplementSpec = {
    id: 'press_frame',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [
      padBox,
      seatBox,
      cyl(add(railFrom, [0.3, 0, 0]), add(railTo, [0.3, 0, 0]), 0.03),
      cyl(add(railFrom, [-0.3, 0, 0]), add(railTo, [-0.3, 0, 0]), 0.03),
      cyl(add(seatBox.center, [0, -0.05, 0]), [0, 0, seatBox.center[2]], 0.04),
    ],
    sites: {},
  }
  const contacts: Contact[] = [
    ...feet.map((ft): Contact => ({ site: `ball_${ft.side}`, kind: 'grip', target: { implement: 'sled', grip: `ball_${ft.side}` } })),
    { site: 'grip_l', kind: 'grip', target: { implement: 'handles', grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: 'handles', grip: 'r' } },
  ]
  const setup: Setup = {
    implements: [sled, frame, handles],
    contacts,
    tempo,
    symmetric: true,
    rests: [{ implement: 'sled', regions: ['foot_l', 'foot_r'], tol: FOREFOOT_REST }],
  }
  return { tempo, v, setup }
}

function samplePress(c: number, skel: Skeleton, ctx: Ctx, v: Press): Pose {
  const q = zeroQ(skel)
  pressPelvis(skel, q, v.shift)
  const [s, pitch] = pressSolve(skel, q, v, dfAt(c, PRESS_DF))
  for (const f of v.feet) toes(skel, q, f.side, pitch)
  return {
    q,
    implements: [{ id: 'sled', pos: add(PRESS_HIP, scale(v.d, s)), rot: v.sledRot }, { id: 'press_frame', pos: [0, 0, 0], rot: qid() }, { id: 'handles', pos: [0, 0, 0], rot: qid() }],
    contacts: ctx.setup.contacts,
  }
}

// ---------- template ----------

const context = memo((p: P, skel: Skeleton): Ctx => {
  const why = unsupported(p)
  if (why) throw new Error(`calf-raise: variant not implemented yet (${why})`)
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.direction === 'dorsiflexion') return tibContext(skel, tempo)
  if (p.machine === 'seated_calf') return seatedContext(p, skel, tempo)
  if (p.machine === 'leg_press') return pressContext(skel, tempo)
  if (p.implement === 'dumbbell' && p.posture === 'seated') return perchContext(p, skel, tempo)
  return standContext(p, skel, tempo)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  const v = ctx.v
  if (v.kind === 'tib') return sampleTib(c, skel, ctx, v)
  if (v.kind === 'seated') return sampleSeated(c, skel, ctx, v)
  if (v.kind === 'press') return samplePress(c, skel, ctx, v)
  if (v.kind === 'bar') return sampleBar(c, skel, ctx, v)
  if (v.kind === 'perch') return samplePerch(c, skel, ctx, v)
  return sampleStand(c, skel, ctx, v)
}

export const calfRaise: Template<P> = {
  id: 'calf-raise',
  driver: 'root',
  params: SCHEMAS['calf-raise'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}

