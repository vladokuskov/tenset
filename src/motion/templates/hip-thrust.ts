import { attachHand, plantFoot, root1d, solveLegs, type FootTarget } from '../constraints.ts'
import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts, type Capsule, type Solid } from '../collide.ts'
import { fk, type FK } from '../fk.ts'
import { barbell, dumbbell, type ImplementSpec } from '../implements.ts'
import { smithRails } from '../implements/back.ts'
import { barPad, BAR_PAD, palmRests, thrustBench } from '../implements/hinge.ts'
import { floorMat, FLOOR_MAT } from '../implements/shared.ts'
import { add, DEG, dist, lerp, neg, norm, qconj, qfromBasis, qid, qmul, qrot, sub, type V3 } from '../math.ts'
import { setDofs, zeroQ, type ImplementPose, type Pose, type Side, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { monotoneCubic } from './solve.ts'
import { plantedContacts, setPelvis, stanceWidth, type StanceName } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Hip thrust and glute bridge: root driver. Feet planted, the upper back rests on the bench edge (thrust) or the mat
// (bridge) and the rigid torso pivots there; pelvis tilt is keyed from lockout to the bottom, the legs follow by IK.
// Lockout: shins at the kneeAngle param (90 = vertical, on the bench or the mat), hips just past neutral with the
// ribs down (a touch of lumbar flexion, no lumbar extension), chin tucked. Bench bottom at ~75 deg hip flexion; the
// bridge lowers until the butt is just off the mat.
// Research (motion-authoring, Brazil 2021): hip ROM 75 +/- 19 deg (~80 -> 0), knee ROM 21 +/- 7 around 90-110,
// pelvis-trunk ROM small (12 +/- 21), a fixed foot contact and a shoulder pivot on the bench.

type P = ParamsOf<'hip-thrust'>
type Support = 'bench' | 'floor'

/** hip flexion at lockout (a little extension: posterior tilt, ribs down) and at the bottom of a bench rep, deg */
export const HIP_TOP = -4
export const HIP_BOTTOM = 75
/** lumbar and thoracic flexion held through the rep: ribs down, no lumbar extension; the bench rounds the upper back
 * over its edge, the mat lets it lie flat */
export const SPINE: Record<Support, { lumbar: number; thorax: number }> = { bench: { lumbar: 4, thorax: 6 }, floor: { lumbar: 4, thorax: 0 } }
/** chin tucked, eyes forward over the knees: the neck flexes further as the trunk levels out at lockout */
const NECK = { bottom: { neck: 22, head: 8 }, top: { neck: 34, head: 12 } }
/** upper back sinks this far into the pad or mat, m */
const SINK = 0.008
/** bar pad sinks this far into the hips, m */
const PAD_SINK = 0.012
/** bridge bottom: butt this far off the mat, m */
export const FLOOR_GAP = 0.02
/** hands on the bar just outside the hips, m from the midline */
const GRIP_HALF = 0.32
const BAR_PLATES = 20
/** bridge: arms lie on the mat nearly straight, a little out from the sides (deg), palms down */
const PALM = { abd: 14, reach: 0.703 }
const ANKLE_Y = 0.07492
const NECK_SAMPLES = 9
/** dumbbell thrust: one heavy dumbbell across the hip crease, sunk this far into the hips (no pad), m; the palms hold
 * its ends */
const DB_KG = 24
const DB_SINK = 0.006
/** left palm on the end face (facing -X), fingers forward along the forearm and a little up over the rim */
const DB_HAND = qfromBasis([1, 0, 0], neg(norm([0, 0.3, 1])))
/**
 * Single leg: the free leg held off the floor. On the bench the knee is lifted and bent (hip and knee flexion, deg,
 * held relative to the pelvis); on the mat the leg is straight and in line with the working thigh
 */
const FREE_BENCH = { hip: 95, knee: 90, df: 0 }
const FREE_FLOOR = { knee: 2, df: -15 }
/**
 * bodyweight on the bench: arms crossed on the chest (as the back extension), thorax2 frame (X left, Y up the spine,
 * Z forward): palm centres on the opposite shoulders, the right forearm over the left
 */
const CROSSED: Record<Side, V3> = { l: [-0.13, 0.1, 0.23], r: [0.13, 0.065, 0.28] }

type Ctx = {
  support: Support
  tempo: Tempo
  setup: Setup
  feet: FootTarget[]
  /** pelvis tilt at lockout and at the bottom, deg */
  top: number
  bottom: number
  /** back point (thorax2 frame) held over the support's contact line (z = 0) */
  pivot: V3
  bench?: ImplementSpec
  benchSolid?: Solid
  bar?: ImplementSpec
  /** dumbbell thrust: the dumbbell in place of the bar and its pad, the palms on its end faces */
  db?: ImplementSpec
  pad?: ImplementSpec
  palms?: ImplementSpec
  mat?: ImplementPose
  /** bridge: neck flexion that rests the head on the mat, by eccentric progress (smoothed) */
  neckAt?: (s: number) => number
  /** single leg: the working (planted) and the free side */
  work?: Side
  free?: Side
  /** bodyweight on the bench: arms crossed on the chest */
  crossed?: boolean
  /** Smith: the bar's rail line (z) */
  railZ?: number
}

/** the Smith frame's implement id here: a frame turned round, not the composer's 'smith' (drawn behind the bar) */
export const SMITH_REVERSED = 'smith_reversed'

const UPPER_BACK = (c: Capsule) => c.segment === 'thorax1' || c.segment === 'thorax2'
const LOW_TRUNK = (c: Capsule) => c.region === 'trunk' && !UPPER_BACK(c)
const MAT_TOP = FLOOR_MAT.thick

function variant(p: P): Support | string {
  if (p.stance === 'single_leg' && p.implement !== 'bodyweight') return `single-leg ${p.implement}`
  if ((p.implement === 'barbell' || p.implement === 'dumbbell' || p.implement === 'smith') && p.support === 'bench') return 'bench'
  if (p.implement === 'bodyweight' && p.support === 'bench' && p.stance === 'single_leg') return 'bench'
  if (p.implement === 'bodyweight' && p.support === 'floor') return 'floor'
  return `${p.implement} on the ${p.support}`
}

const pos = (skel: Skeleton, f: FK, seg: string) => f.pos[skel.seg[seg]]
const toWorld = (skel: Skeleton, f: FK, seg: string, local: V3): V3 => add(f.pos[skel.seg[seg]], qrot(f.rot[skel.seg[seg]], local))
const toLocal = (skel: Skeleton, f: FK, seg: string, world: V3): V3 => qrot(qconj(f.rot[skel.seg[seg]]), sub(world, f.pos[skel.seg[seg]]))

/** how far the resting capsules are off the support (negative = sunk in), m */
function supportClearance(ctx: Ctx, caps: Capsule[]): number {
  if (ctx.support === 'bench') return Math.min(...caps.filter((c) => c.region === 'trunk').map((c) => capsuleSolidClearance(c, ctx.benchSolid!)))
  return Math.min(...caps.filter(UPPER_BACK).map((c) => Math.min(c.a[1], c.b[1]) - c.r - MAT_TOP))
}

/** torso at pelvis tilt `tilt`: spine and neck set, `zRef` (a back point) over z = 0, resting on the support */
function torso(skel: Skeleton, q: Float64Array, ctx: Ctx, tilt: number, zRef: (f: FK) => number) {
  setDofs(skel, q, { 'lumbar.flex': SPINE[ctx.support].lumbar, 'thorax.flex': SPINE[ctx.support].thorax, 'neck.flex': NECK.bottom.neck, 'head.flex': NECK.bottom.head })
  setPelvis(skel, q, [0, 0.5, 0], tilt)
  const ty = skel.dof['pelvis.ty'], tz = skel.dof['pelvis.tz']
  q[tz] -= zRef(fk(skel, q))
  for (let k = 0; k < 4; k++) {
    const e = supportClearance(ctx, bodyCapsules(skel, fk(skel, q))) + SINK
    q[ty] -= e
    if (Math.abs(e) < 1e-6) break
  }
  if (ctx.support === 'floor') restHead(skel, q)
}

/** bridge: the head lies on the mat (neck flexion follows the torso) */
const HEAD_SHARE = 0.3

function restHead(skel: Skeleton, q: Float64Array) {
  const clear = (flex: number) => {
    setDofs(skel, q, { 'neck.flex': flex, 'head.flex': flex * HEAD_SHARE })
    return Math.min(...bodyCapsules(skel, fk(skel, q)).filter((c) => c.region === 'head').map((c) => Math.min(c.a[1], c.b[1]) - c.r - MAT_TOP)) + 0.004
  }
  const r = root1d(clear, -20, 50, { tol: 1e-6 })
  clear(r.x)
}

/**
 * lockout legs for the top solve: hips at HIP_TOP, knees bent so the shins sit `kneeAngle - 90` deg past vertical
 * towards the hips (90 = vertical shins, whatever the thighs' slope: level on the bench, rising to the knees on the mat)
 */
function topLegs(skel: Skeleton, q: Float64Array, kneeAngle: number) {
  setDofs(skel, q, { 'hip_*.flex': HIP_TOP, 'hip_*.abd': 0, 'hip_*.rot': 0, 'knee_*.flex': 0, 'ankle_*.df': 0 })
  const f = fk(skel, q)
  const hip = pos(skel, f, 'femur_l'), knee = pos(skel, f, 'tibia_l')
  const rise = Math.atan2(knee[1] - hip[1], knee[2] - hip[2]) / DEG
  setDofs(skel, q, { 'knee_*.flex': kneeAngle + rise })
}

// ---------- hands and bar ----------

/** bar centre resting (through the pad) on the hips, level with the hip crease; the dumbbell rests on its heads */
function barPose(skel: Skeleton, q: Float64Array, ctx: Ctx): ImplementPose {
  const f = fk(skel, q)
  const z = ctx.railZ ?? toWorld(skel, f, 'pelvis', skel.data.sites.hip_crease.local)[2]
  const hips = bodyCapsules(skel, f).filter((c) => c.segment === 'pelvis' || c.segment.startsWith('lumbar') || c.region.startsWith('thigh_'))
  const y0 = pos(skel, f, 'pelvis')[1]
  if (ctx.db) {
    const solids = (y: number) => placeParts(ctx.db!, { id: ctx.db!.id, pos: [0, y, z], rot: qid() })
    const gap = (y: number) => Math.min(...hips.flatMap((c) => solids(y).map((sd) => capsuleSolidClearance(c, sd)))) + DB_SINK
    return { id: ctx.db.id, pos: [0, root1d(gap, y0, y0 + 0.5, { tol: 1e-7 }).x, z], rot: qid() }
  }
  const clear = (y: number) => Math.min(...hips.map((c) => capsuleClearance(c, { a: [-BAR_PAD.half, y, z], b: [BAR_PAD.half, y, z], r: BAR_PAD.r }))) + PAD_SINK
  const y = root1d(clear, y0, y0 + 0.5, { tol: 1e-7 }).x
  return { id: ctx.bar!.id, pos: [0, y, z], rot: qid() }
}

const ARM_DOFS = ['scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']

function mirrorArm(skel: Skeleton, q: Float64Array) {
  for (const k of ARM_DOFS) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

function arms(skel: Skeleton, q: Float64Array, ctx: Ctx, bar?: ImplementPose) {
  setDofs(skel, q, { 'clavicle_*.prot': 4, 'clavicle_*.elev': 0 })
  if (ctx.crossed) {
    // palms towards the body, fingers towards the opposite shoulder
    const f = fk(skel, q)
    const t = f.rot[skel.seg.thorax2], o = f.pos[skel.seg.thorax2]
    setDofs(skel, q, { 'clavicle_*.prot': 8, 'grip_*.close': 0 })
    for (const side of ['l', 'r'] as Side[]) {
      const sx = side === 'l' ? 1 : -1
      const hand = qmul(t, qfromBasis([0, 0, sx], norm([sx, -0.35, 0])))
      attachHand(skel, q, side, { pos: add(o, qrot(t, CROSSED[side])), axis: qrot(t, [-sx, 0, 0]), palm: qrot(t, [0, 0, -1]), hand }, { pole: qrot(t, [sx * 0.6, -1, 0.3]), wristBias: 0, planeHint: 90 })
    }
    return
  }
  if (ctx.db) {
    // palms on the dumbbell's end faces, fingers over the rims
    const g = add(bar!.pos, ctx.db.sites.l.pos)
    setDofs(skel, q, { 'grip_*.close': 0.4 })
    attachHand(skel, q, 'l', { pos: g, axis: [0, 0, 1], palm: [-1, 0, 0], hand: DB_HAND }, { pole: [0.8, -0.6, 0], wristBias: 0, planeHint: 0 })
  } else if (ctx.support === 'bench') {
    const g = add(bar!.pos, ctx.bar!.sites.l.pos)
    setDofs(skel, q, { 'grip_*.close': 1 })
    attachHand(skel, q, 'l', { pos: g, axis: [1, 0, 0], palm: [0, -1, 0.3] }, { pole: [0.8, -0.6, 0], wristBias: 0, planeHint: 0 })
  } else {
    // the trunk rolls on the upper back, which carries the shoulders a few cm: the shoulder girdle slides along the
    // ribs (depressed at lockout, raised at the bottom) so the arms stay long on the mat
    const palm = ctx.palms!.sites.l.pos
    const reach = (elev: number) => {
      setDofs(skel, q, { 'clavicle_*.elev': elev })
      return dist(pos(skel, fk(skel, q), 'humerus_l'), palm) - PALM.reach
    }
    reach(root1d(reach, -10, 30, { tol: 1e-6 }).x)
    setDofs(skel, q, { 'grip_*.close': 0 })
    const sa = Math.sin(PALM.abd * DEG), ca = Math.cos(PALM.abd * DEG)
    // palm down, back of the hand up, fingers along the forearm
    attachHand(skel, q, 'l', { pos: palm, axis: [-ca, 0, sa], palm: [0, -1, 0], hand: qfromBasis([0, 1, 0], [-sa, 0, -ca]) }, { pole: [1, -0.3, 0], wristBias: 0, planeHint: 0 })
  }
  mirrorArm(skel, q)
}

/** single leg: the free leg off the floor */
function freeLeg(skel: Skeleton, q: Float64Array, ctx: Ctx) {
  const w = ctx.work!, fr = ctx.free!
  if (ctx.support === 'bench') {
    setDofs(skel, q, { [`hip_${fr}.flex`]: FREE_BENCH.hip, [`hip_${fr}.abd`]: 0, [`hip_${fr}.rot`]: 0, [`knee_${fr}.flex`]: FREE_BENCH.knee, [`ankle_${fr}.df`]: FREE_BENCH.df, [`ankle_${fr}.inv`]: 0 })
    return
  }
  // in line with the working thigh
  setDofs(skel, q, {
    [`hip_${fr}.flex`]: q[skel.dof[`hip_${w}.flex`]], [`hip_${fr}.abd`]: 0, [`hip_${fr}.rot`]: 0,
    [`knee_${fr}.flex`]: FREE_FLOOR.knee, [`ankle_${fr}.df`]: FREE_FLOOR.df, [`ankle_${fr}.inv`]: 0,
  })
}

// ---------- frame ----------

function solveFrame(skel: Skeleton, ctx: Ctx, s: number): { q: Float64Array; bar?: ImplementPose } {
  const q = zeroQ(skel)
  torso(skel, q, ctx, lerp(ctx.top, ctx.bottom, s), (f) => toWorld(skel, f, 'thorax2', ctx.pivot)[2])
  if (ctx.support === 'bench') setDofs(skel, q, { 'neck.flex': lerp(NECK.top.neck, NECK.bottom.neck, s), 'head.flex': lerp(NECK.top.head, NECK.bottom.head, s) })
  else setDofs(skel, q, { 'neck.flex': ctx.neckAt!(s), 'head.flex': ctx.neckAt!(s) * HEAD_SHARE })
  solveLegs(skel, q, ctx.feet)
  if (ctx.free) freeLeg(skel, q, ctx)
  const bar = ctx.bar || ctx.db ? barPose(skel, q, ctx) : undefined
  arms(skel, q, ctx, bar)
  return { q, bar }
}

function poses(ctx: Ctx, bar?: ImplementPose): ImplementPose[] {
  if (ctx.crossed) return [{ id: ctx.bench!.id, pos: [0, 0, 0], rot: qid() }]
  if (ctx.railZ !== undefined) return [{ id: ctx.bench!.id, pos: [0, 0, 0], rot: qid() }, bar!, { ...bar!, id: ctx.pad!.id }, { id: SMITH_REVERSED, pos: [0, 0, 0], rot: qid() }]
  if (ctx.db) return [{ id: ctx.bench!.id, pos: [0, 0, 0], rot: qid() }, bar!]
  if (ctx.support === 'bench') return [{ id: ctx.bench!.id, pos: [0, 0, 0], rot: qid() }, bar!, { ...bar!, id: ctx.pad!.id }]
  return [ctx.mat!, { id: ctx.palms!.id, pos: [0, 0, 0], rot: qid() }]
}

// ---------- setup ----------

const context = memo((p: P, skel: Skeleton): Ctx => {
  const support = variant(p)
  if (support !== 'bench' && support !== 'floor') throw new Error(`hip-thrust: variant not implemented yet (${support})`)
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const implements_: ImplementSpec[] = []
  const ctx: Ctx = { support, tempo, setup: { implements: implements_, contacts: [], tempo, symmetric: true }, feet: [], top: 0, bottom: 0, pivot: [0, 0, 0] }
  if (support === 'bench') {
    ctx.bench = thrustBench()
    ctx.benchSolid = placeParts(ctx.bench, { id: ctx.bench.id, pos: [0, 0, 0], rot: qid() })[0]
  }

  // lockout: pelvis tilt that puts the ankles on the floor with the hips at HIP_TOP and the knees at the param; the
  // bench edge sits under the thorax2 origin (lower scapulae), the bridge rests on its upper back
  const q = zeroQ(skel)
  const originZ = (f: FK) => pos(skel, f, 'thorax2')[2]
  const ankleAt = (tilt: number) => {
    torso(skel, q, ctx, tilt, originZ)
    topLegs(skel, q, p.kneeAngle)
    return pos(skel, fk(skel, q), 'foot_l')[1] - ANKLE_Y
  }
  ctx.top = root1d(ankleAt, -150, -40, { tol: 1e-7, scan: 12 }).x
  ankleAt(ctx.top)
  const f = fk(skel, q)
  if (support === 'bench') ctx.pivot = toLocal(skel, f, 'thorax2', [0, ctx.bench!.sites.edge.pos[1], 0])
  else {
    const low = bodyCapsules(skel, f).filter(UPPER_BACK).reduce((a, c) => (Math.min(c.a[1], c.b[1]) - c.r < Math.min(a.a[1], a.b[1]) - a.r ? c : a))
    const end = low.a[1] < low.b[1] ? low.a : low.b
    ctx.pivot = toLocal(skel, f, 'thorax2', [end[0], end[1] - low.r, end[2]])
  }

  // feet planted where the lockout put them at the stance width, pointing along the line from under the hips, so the
  // knees stay over the feet as the hips sink level with them (knee over the toes degenerates there)
  const half = stanceWidth(skel, (p.stance === 'single_leg' ? 'hip' : p.stance) as StanceName) / 2
  torso(skel, q, ctx, ctx.top, (g) => toWorld(skel, g, 'thorax2', ctx.pivot)[2])
  topLegs(skel, q, p.kneeAngle)
  const ft = fk(skel, q)
  const ankleZ = pos(skel, ft, 'foot_l')[2]
  const hipL = pos(skel, ft, 'femur_l')
  const toeOut = Math.atan2(half - hipL[0], ankleZ - hipL[2]) / DEG
  ctx.feet = (['l', 'r'] as Side[]).map((side) => {
    const x = side === 'l' ? half : -half
    const at = plantFoot(skel, side, [x, 0, 0], toeOut)
    return plantFoot(skel, side, [x, 0, ankleZ - at.ankle[2]], toeOut)
  })
  if (p.stance === 'single_leg') {
    // one foot planted where the hip-width stance puts it, the other leg held off the floor
    ctx.work = p.side === 'left' ? 'l' : 'r'
    ctx.free = ctx.work === 'l' ? 'r' : 'l'
    ctx.feet = ctx.feet.filter((x) => x.side === ctx.work)
    ctx.setup.symmetric = false
  }
  ctx.setup.contacts = plantedContacts(skel, { feet: ctx.feet, midfoot: [0, 0, ankleZ] })

  if (support === 'bench') {
    // bottom: hips flexed to HIP_BOTTOM with the feet planted
    const hipAt = (tilt: number) => {
      const g = zeroQ(skel)
      torso(skel, g, ctx, tilt, (h) => toWorld(skel, h, 'thorax2', ctx.pivot)[2])
      solveLegs(skel, g, ctx.feet)
      return g[skel.dof[`hip_${ctx.work ?? 'l'}.flex`]] - HIP_BOTTOM
    }
    ctx.bottom = root1d(hipAt, ctx.top, ctx.top + 80, { tol: 1e-7, scan: 16 }).x
    if (p.implement === 'dumbbell') {
      const db = dumbbell({ id: 'db', mass: DB_KG })
      // grip sites off the end faces by the palm's thickness, so the palms lie on them
      const end = Math.max(...db.parts.map((x) => (x.shape === 'cylinder' ? Math.max(x.a[0], x.b[0]) : 0))) + palmHeight(skel)
      db.sites.l = { pos: [end, 0, 0], axis: [0, 0, 1] }
      db.sites.r = { pos: [-end, 0, 0], axis: [0, 0, 1] }
      ctx.db = db
      implements_.push(ctx.bench!, db)
      // no pad: the heads sink a little into the hips and the front of the thighs
      ctx.setup.rests = [{ implement: db.id, regions: ['trunk', 'thigh_l', 'thigh_r'], tol: 8 }]
      ctx.setup.contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: db.id, grip: 'l' } }, { site: 'grip_r', kind: 'grip', target: { implement: db.id, grip: 'r' } })
      return ctx
    }
    if (p.implement === 'bodyweight') {
      ctx.crossed = true
      implements_.push(ctx.bench!)
      return ctx
    }
    ctx.bar = barbell({ gripWidth: 2 * GRIP_HALF, plateKg: BAR_PLATES })
    ctx.pad = barPad()
    implements_.push(ctx.bench!, ctx.bar, ctx.pad)
    if (p.implement === 'smith') {
      // the bar rides its rails over the hip crease at the bottom of the rep
      const g = zeroQ(skel)
      torso(skel, g, ctx, ctx.bottom, (h) => toWorld(skel, h, 'thorax2', ctx.pivot)[2])
      ctx.railZ = toWorld(skel, fk(skel, g), 'pelvis', skel.data.sites.hip_crease.local)[2]
      // the frame turned round on the rail line (families/hinge.ts draws it): its rear posts and base stand beyond the
      // feet, clear of the bench, and the open front faces the bench
      implements_.push({ ...smithRails({ z: ctx.railZ }), id: SMITH_REVERSED })
    }
    ctx.setup.contacts.push(
      { site: 'grip_l', kind: 'grip', target: { implement: ctx.bar.id, grip: 'l' } },
      { site: 'grip_r', kind: 'grip', target: { implement: ctx.bar.id, grip: 'r' } },
    )
  } else {
    // bottom: the butt just off the mat
    const gapAt = (tilt: number) => {
      const g = zeroQ(skel)
      torso(skel, g, ctx, tilt, (h) => toWorld(skel, h, 'thorax2', ctx.pivot)[2])
      return Math.min(...bodyCapsules(skel, fk(skel, g)).filter(LOW_TRUNK).map((c) => Math.min(c.a[1], c.b[1]) - c.r - MAT_TOP)) - FLOOR_GAP
    }
    ctx.bottom = root1d(gapAt, ctx.top, ctx.top + 80, { tol: 1e-7, scan: 16 }).x
    // the head's resting neck angle frame by frame steps where its lowest point moves across the skull: sampled and
    // smoothed instead
    const xs = Array.from({ length: NECK_SAMPLES }, (_, k) => k / (NECK_SAMPLES - 1))
    const necks = xs.map((u) => {
      const g = zeroQ(skel)
      torso(skel, g, ctx, lerp(ctx.top, ctx.bottom, u), (h) => toWorld(skel, h, 'thorax2', ctx.pivot)[2])
      return g[skel.dof['neck.flex']]
    })
    ctx.neckAt = monotoneCubic(xs, necks)
    // palms on the mat beside the hips, the mat under the body from the head to the heels
    const g = zeroQ(skel)
    torso(skel, g, ctx, ctx.top, (h) => toWorld(skel, h, 'thorax2', ctx.pivot)[2])
    const h = fk(skel, g)
    const sh = pos(skel, h, 'humerus_l')
    const palmY = MAT_TOP + palmHeight(skel)
    const flat = Math.sqrt(Math.max(0.01, PALM.reach ** 2 - (sh[1] - palmY) ** 2))
    const palm: V3 = [sh[0] + flat * Math.sin(PALM.abd * DEG), palmY, sh[2] + flat * Math.cos(PALM.abd * DEG)]
    ctx.palms = palmRests({ l: palm, r: [-palm[0], palm[1], palm[2]] })
    const headZ = pos(skel, h, 'head')[2]
    const heelZ = ctx.feet[0].ankle[2]
    const mat = floorMat()
    ctx.mat = { id: mat.id, pos: [0, 0, (headZ - 0.25 + heelZ + 0.1) / 2], rot: qid() }
    implements_.push(mat, ctx.palms)
    ctx.setup.contacts.push(
      { site: 'grip_l', kind: 'grip', target: { implement: ctx.palms.id, grip: 'l' } },
      { site: 'grip_r', kind: 'grip', target: { implement: ctx.palms.id, grip: 'r' } },
    )
  }
  return ctx
})

/** height of the grip site above the palm's surface when the hand lies flat, palm down, m */
function palmHeight(skel: Skeleton): number {
  const q = zeroQ(skel)
  const f = fk(skel, q)
  const grip = toWorld(skel, f, 'hand_l', skel.data.sites.grip_l.local)
  // zero pose: palm faces medially (-X for the left hand); the palm surface is the hand capsules' medial extreme
  const palm = Math.min(...bodyCapsules(skel, f).filter((c) => c.region === 'hand_l').map((c) => Math.min(c.a[0], c.b[0]) - c.r))
  return grip[0] - palm
}

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const s = 1 - phaseAt(u, ctx.tempo).c
  const fr = solveFrame(skel, ctx, s)
  return { q: fr.q, implements: poses(ctx, fr.bar), contacts: ctx.setup.contacts }
}

export const hipThrust: Template<P> = {
  id: 'hip-thrust',
  driver: 'root',
  params: SCHEMAS['hip-thrust'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}

