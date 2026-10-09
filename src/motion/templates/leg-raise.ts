import { attachHand, root1d } from '../constraints.ts'
import { bodyCapsules, type Capsule } from '../collide.ts'
import { centerOfMass, fk, sitePos } from '../fk.ts'
import { pullupBar, siteWorld, type ImplementSpec } from '../implements.ts'
import { palmRest } from '../implements/core.ts'
import { floorMat } from '../implements/shared.ts'
import { dls } from '../ik.ts'
import { naturalCubic, secant } from './solve.ts'
import { DEG, dist, eulerFrom, lerp, qaxis, qid, qmul, qnorm, RAD, smoothstep, type Axis, type Quat, type V3 } from '../math.ts'
import { jointRotation, setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { MAT_TOP, matClearance, mirrorArm, palmDown, palmHeight, restHead, restOnMat, segPosOf, SINK } from './core/floor.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { setPelvis } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Leg raise: hip flexion with the pelvis curling up at the top (posterior tilt) and no swing. The topHipAngle param is
// the total flexion between thighs and thorax (hip plus lumbar and thoracic flexion); research (motion-authoring):
// hip 0 -> 90-110 deg. Hanging (802, 806): active hang from a pull-up bar, elbows ~6 deg, the body's centre of mass
// held under the grips every frame (so the trunk moves back and leans a little as the legs rise, it never swings);
// straight legs together (knees soft) or knees bending to the param on the way up. Lying (807): supine on a mat, palms down
// beside the hips, straight legs from just off the mat to the param, the lower back pressed down (posterior tilt
// growing towards the top, the lumbar spine flattening so the upper back stays still).

type P = ParamsOf<'leg-raise'>

/** hanging: lean back of the thorax at the top, lumbar and thoracic flexion bottom -> top (pelvis curls up), deg */
export const HANG = { lean: 6, lumbar: [0, 16], thorax: [0, 4], clavicle: 12, elbow: 6, neck: [0, 8] } as const
/** toes-to-bar: the legs a little apart (feet about hip width at the bar), so the thighs pass either side of the belly
 * at the top, deg of hip abduction */
const BAR_ABD = 8
/**
 * toes-to-bar: with straight arms and legs the toes only reach the bar in a ~145 deg pike, where the thighs' proximal
 * capsules press ~65 mm into the lower ribcage capsule (thorax1, default 15) and ~95 mm into the belly (lumbar3,
 * default 60): the thighs lie on the trunk in the fold, mm (a lead decision)
 */
export const BAR_PIKE = { ribs: 66, belly: 96 } as const
/** straight-leg hanging raise: hips adducted so the legs hang together (ankles ~10 cm apart centre to centre, the
 * cue), deg; the inner thighs then press together, which the capsules read as ~41 mm of overlap (THIGHS_TOGETHER) */
const LEGS_TOGETHER = -4
/** thigh-thigh soft-tissue allowance with the legs together, mm (the side plank's stacked-thigh allowance, a lead decision) */
export const THIGHS_TOGETHER = 42
/** total flexion at the dead hang (thighs a touch forward), knee flexion hanging for bent-knee raises, deg */
const HANG_FLEX = 4
const HANG_KNEE_BENT = 16
/** toes this far above the floor at the dead hang, m */
const TOE_CLEAR = 0.08
/** grip width, multiples of shoulder width (pronated, a little wider than the shoulders) */
const GRIP = 1.35
/** lying: legs this far above the mat at the bottom, posterior pelvic tilt added at the top, deg */
export const LYING = { low: 14, tilt: 10, lumbar: 3 } as const
/** reverse crunch: posterior pelvic tilt at the top, deg; the lumbar spine flexes as much, so the thorax stays on the
 * mat while the hips roll up (research motion-authoring: lumbar flexion ~20-40 deg; the knee angle stays fixed) */
export const REVERSE = { tilt: 36 } as const
/** lying: arms on the mat a little out from the sides (deg), palms down */
const PALM_ABD = 12
/** knees soft on straight-leg raises, ankles relaxed, deg */
const SOFT_KNEE = 3
const ANKLE = -22

type Hang = {
  kind: 'hang'
  tempo: Tempo
  setup: Setup
  bar: ImplementSpec
  barPose: ImplementPose
  top: Top
  /** root height, depth and sideways shift, m, and the whole body's roll about the forward axis, deg (oblique raise) */
  root: (c: number) => [number, number, number, number]
  /** oblique raise: both hands' world orientation, splined over the knots so the wrists move smoothly */
  hands?: (c: number) => [Quat, Quat]
}
/** thorax lean back at the top of a hanging raise, deg */
type Top = { lean: number }
const HANG_TOP: Top = { lean: HANG.lean }
type Lying = { kind: 'lying'; tempo: Tempo; setup: Setup; tilt0: number; neck0: number; mat: ImplementPose; palms: ImplementSpec }
type Ctx = Hang | Lying

const bent = (p: P) => p.kneeAngle > 30

/** knee flexion over the rep: straight legs stay soft, bent-knee raises fold as the thighs come up */
function kneeAt(p: P, c: number, hanging: boolean) {
  if (!bent(p)) return Math.max(SOFT_KNEE, p.kneeAngle)
  return lerp(hanging ? HANG_KNEE_BENT : p.kneeAngle, p.kneeAngle, smoothstep(Math.min(1, c * 1.4)))
}

// ---------- hanging ----------

function hangBody(skel: Skeleton, q: Float64Array, p: P, c: number, top: Top = HANG_TOP) {
  const lumbar = lerp(HANG.lumbar[0], HANG.lumbar[1], c)
  const thorax = lerp(HANG.thorax[0], HANG.thorax[1], c)
  const total = lerp(HANG_FLEX, p.topHipAngle, c)
  if (p.twist) twistBody(skel, q, p, c)
  setDofs(skel, q, {
    'clavicle_*.elev': HANG.clavicle,
    'clavicle_*.prot': 2,
    'lumbar.flex': lumbar,
    'thorax.flex': thorax,
    'neck.flex': lerp(HANG.neck[0], HANG.neck[1], c),
    'hip_*.flex': total - lumbar - thorax,
    'hip_*.abd': bent(p) ? 1 : p.toBar ? BAR_ABD : LEGS_TOGETHER,
    'knee_*.flex': p.toBar ? lerp(SOFT_KNEE, Math.max(SOFT_KNEE, p.kneeAngle), smoothstep(c)) : kneeAt(p, c, true),
    'ankle_*.df': ANKLE,
    'grip_*.close': 1,
  })
  // thorax lean back in the world: the pelvis tilts back under it by the spinal flexion
  q[skel.dof['pelvis.tilt']] = -top.lean * c - lumbar - thorax
}

/**
 * Oblique raise: the pelvis turns and lists so the knees travel towards the working side's shoulder (the hip on that
 * side rising towards the ribs) while the spine turns and bends back the other way, so the thorax stays square under
 * the bar. The lumbar spine takes 35 % of the turn (its range is +-15 deg) and 60 % of the side bend.
 */
export const TWIST = { list: 0.6, lumbarRot: 0.35, lumbarBend: 0.6 } as const

function twistBody(skel: Skeleton, q: Float64Array, p: P, c: number) {
  const s = p.side === 'left' ? -1 : 1
  const turn = p.twist! * c, list = TWIST.list * p.twist! * c
  setDofs(skel, q, {
    'lumbar.rot': s * TWIST.lumbarRot * turn,
    'thorax.rot': s * (1 - TWIST.lumbarRot) * turn,
    'lumbar.bend': -s * TWIST.lumbarBend * list,
    'thorax.bend': -s * (1 - TWIST.lumbarBend) * list,
  })
  q[skel.dof['pelvis.rot']] = -s * turn
  q[skel.dof['pelvis.list']] = -s * list
}

function hangArms(skel: Skeleton, q: Float64Array, v: Pick<Hang, 'bar' | 'barPose'>, both = false, hands?: [Quat, Quat]) {
  for (const [k, side] of (both ? (['l', 'r'] as const) : (['l'] as const)).entries()) {
    const g = siteWorld(v.bar, v.barPose, side)
    attachHand(skel, q, side, { pos: g.pos, axis: g.axis!, palm: [0, 0, 1], ...(hands ? { hand: hands[k] } : {}) }, { pole: [side === 'l' ? 1 : -1, 0, 0.35], planeHint: 20 })
  }
  if (!both) mirrorArm(skel, q)
}

/** turns the whole body about the world's forward axis by `deg` */
function rollRoot(skel: Skeleton, q: Float64Array, deg: number) {
  const j = skel.joints[0], ids = j.dofs.slice(3)
  const axes = ids.map((i) => {
    const a = skel.dofs[i].axis, k = Math.abs(a[0]) > 0.5 ? 0 : Math.abs(a[1]) > 0.5 ? 1 : 2
    return { k: k as Axis, s: Math.sign(a[k]) }
  })
  const e = eulerFrom(qmul(qaxis([0, 0, 1], deg * DEG), jointRotation(skel, j, q)), axes[0].k, axes[1].k, axes[2].k)
  ids.forEach((i, n) => (q[i] = (e[n] * RAD) / axes[n].s))
}

/**
 * Oblique raise: the knees swing to one side, so the body hangs in the four-bar of the bar, the two straight arms and
 * the shoulders: it slides sideways under the bar and rolls (the shoulder line tilting towards the far grip) until
 * the centre of mass is back under the bar's middle, both arms as straight as the dead hang's. Root shift, height,
 * depth and roll from both shoulders' distance to their grips (held at the straight-arm value `reach`) and the centre
 * of mass under the grips.
 */
function hangPoseRolled(skel: Skeleton, p: P, v: Pick<Hang, 'bar' | 'barPose'>, c: number, top: Top, reach: number, guess: number[]): { q: Float64Array; x: number[] } {
  const q = zeroQ(skel)
  const [tx, ty, tz] = (['pelvis.tx', 'pelvis.ty', 'pelvis.tz'] as const).map((n) => skel.dof[n])
  const grips = (['l', 'r'] as const).map((s) => siteWorld(v.bar, v.barPose, s).pos)
  const place = (x: number[]) => {
    hangBody(skel, q, p, c, top)
    rollRoot(skel, q, x[3])
    q[tx] = x[0]
    q[ty] = x[1]
    q[tz] = x[2]
  }
  const res = (x: number[]) => {
    place(x)
    // the arms' reach moves the shoulder girdle (scapulohumeral rhythm), so measure with them on the bar
    hangArms(skel, q, v, true)
    const f = fk(skel, q)
    const com = centerOfMass(skel, f)
    return [
      ...(['l', 'r'] as const).map((s, k) => (dist(segPosOf(skel, f, `humerus_${s}`), grips[k]) - reach) * 100),
      (com[0] - v.barPose.pos[0]) * 100,
      (com[2] - v.barPose.pos[2]) * 100,
    ]
  }
  const { x } = dls(res, guess, { tol: 1e-10, iters: 60 })
  place(x)
  hangArms(skel, q, v, true)
  return { q, x }
}

/** root height and depth that hang the body with the elbows at HANG.elbow and its centre of mass under the grips */
function hangPose(skel: Skeleton, p: P, v: Pick<Hang, 'bar' | 'barPose'>, c: number, top: Top = HANG_TOP): Float64Array {
  const q = zeroQ(skel)
  hangBody(skel, q, p, c, top)
  const barZ = v.barPose.pos[2]
  const ty = skel.dof['pelvis.ty'], tz = skel.dof['pelvis.tz']
  const elbowAt = (y: number) => {
    q[ty] = y
    hangArms(skel, q, v)
    return q[skel.dof['elbow_l.flex']] - HANG.elbow
  }
  const y0 = v.barPose.pos[1] - 1.25
  // the elbow saturates near straight when the bar is out of reach, so bracket the height
  const comAt = (z: number) => {
    q[tz] = z
    elbowAt(root1d(elbowAt, y0 - 0.2, y0 + 0.15, { tol: 1e-6, scan: 7 }).x)
    return centerOfMass(skel, fk(skel, q))[2] - barZ
  }
  comAt(secant(comAt, 0, -0.02, 1e-7))
  return q
}

/** root shift, height, depth and roll at each knot, the oblique raise's from the previous knot's (the square dead hang's
 * shoulder-to-grip distance with the elbows at HANG.elbow) */
function rootKnots(skel: Skeleton, p: P, v: Pick<Hang, 'bar' | 'barPose'>, cs: number[], top: Top): { roots: number[][]; hands?: Quat[][] } {
  const d = (n: string, q: Float64Array) => q[skel.dof[n]]
  if (!p.twist) return { roots: cs.map((c) => {
    const q = hangPose(skel, p, v, c, top)
    return [0, d('pelvis.ty', q), d('pelvis.tz', q), 0]
  }) }
  const square = hangPose(skel, p, v, 0, top)
  const reach = dist(segPosOf(skel, fk(skel, square), 'humerus_l'), siteWorld(v.bar, v.barPose, 'l').pos)
  let guess = [0, d('pelvis.ty', square), d('pelvis.tz', square), 0]
  const hands: Quat[][] = []
  const roots = cs.map((c) => {
    const { q, x } = hangPoseRolled(skel, p, v, c, top, reach, guess)
    const f = fk(skel, q)
    // each hand's quaternion kept in one hemisphere from knot to knot, so the spline does not flip
    hands.push((['l', 'r'] as const).map((s, k) => {
      const h = f.rot[skel.seg[`hand_${s}`]], prev = hands.at(-1)?.[k]
      return prev && h.reduce((a, e, i) => a + e * prev[i], 0) < 0 ? (h.map((e) => -e) as unknown as Quat) : h
    }))
    return (guess = x)
  })
  return { roots, hands }
}

/** toes-to-bar: the toe tips this far below the bar's centre line at the top, m (touching the bar) */
const TOE_UNDER_BAR = 0.045

/**
 * Toes-to-bar: the thorax lean at the top that lifts the toe tips to the bar. The arms press the bar down towards the
 * hips (shoulder extension), so the trunk lies back while the centre of mass stays under the grips; topHipAngle sets
 * the pike, which puts the feet at the bar rather than in front of it.
 */
function barTop(skel: Skeleton, p: P, v: Pick<Hang, 'bar' | 'barPose'>): Top {
  const toeY = (lean: number) => {
    const f = fk(skel, hangPose(skel, p, v, 1, { lean }))
    return (sitePos(skel, f, 'toe_l')[1] + sitePos(skel, f, 'toe_r')[1]) / 2 - (v.barPose.pos[1] - TOE_UNDER_BAR)
  }
  return { lean: root1d(toeY, HANG.lean, 75, { tol: 1e-5, scan: 15 }).x }
}

function hangContext(p: P, skel: Skeleton, tempo: Tempo): Hang {
  const bar = pullupBar({ height: 2.4, gripWidth: GRIP * skel.data.shoulderWidth })
  // hang at a trial bar height, then raise the bar so the toes clear the floor
  const trial = { bar, barPose: { id: bar.id, pos: [0, 2.4, 0] as V3, rot: qid() } }
  const q0 = hangPose(skel, p, trial, 0)
  const low = Math.min(...bodyCapsules(skel, fk(skel, q0)).map((cp) => Math.min(cp.a[1], cp.b[1]) - cp.r))
  const height = 2.4 + TOE_CLEAR - low
  const spec = pullupBar({ height, gripWidth: GRIP * skel.data.shoulderWidth })
  const barPose: ImplementPose = { id: spec.id, pos: [0, height, 0], rot: qid() }
  const top = p.toBar ? barTop(skel, p, { bar: spec, barPose }) : HANG_TOP
  // root height and depth solved at knots (dense at both ends of the rep) and splined over contraction
  const cs = Array.from({ length: 13 }, (_, k) => 0.5 - 0.5 * Math.cos((Math.PI * k) / 12))
  const { roots, hands } = rootKnots(skel, p, { bar: spec, barPose }, cs, top)
  const [xs, ys, zs, rolls] = [0, 1, 2, 3].map((k) => naturalCubic(cs, roots.map((r) => r[k])))
  const handSplines = hands && [0, 1].map((k) => [0, 1, 2, 3].map((i) => naturalCubic(cs, hands.map((h) => h[k][i]))))
  const contacts: Contact[] = [
    { site: 'grip_l', kind: 'grip', target: { implement: spec.id, grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: spec.id, grip: 'r' } },
  ]
  const setup: Setup = {
    implements: [spec],
    contacts,
    tempo,
    symmetric: !p.twist,
    balance: { point: 'com', over: { implement: spec.id, sites: ['l', 'r'] }, tol: 0.02 },
    ...(p.toBar
      ? { tolerances: { body: Object.fromEntries(['l', 'r'].flatMap((s) => [[`thigh_${s} / trunk`, BAR_PIKE.ribs], [`thigh_${s} / trunk (lumbar3)`, BAR_PIKE.belly]])) } }
      : bent(p) ? {} : { tolerances: { body: { 'thigh_l / thigh_r': THIGHS_TOGETHER } } }),
  }
  return { kind: 'hang', tempo, setup, bar: spec, barPose, top, root: (c) => [xs(c), ys(c), zs(c), rolls(c)], hands: handSplines && ((c) => handSplines.map((sp) => qnorm(sp.map((f) => f(c)) as unknown as Quat)) as [Quat, Quat]) }
}

function sampleHang(skel: Skeleton, p: P, ctx: Hang, c: number): Pose {
  const q = zeroQ(skel)
  hangBody(skel, q, p, c, ctx.top)
  const [x, y, z, roll] = ctx.root(c)
  if (p.twist) {
    rollRoot(skel, q, roll)
    q[skel.dof['pelvis.tx']] = x
  }
  q[skel.dof['pelvis.ty']] = y
  q[skel.dof['pelvis.tz']] = z
  hangArms(skel, q, ctx, !!p.twist, ctx.hands?.(c))
  return { q, implements: [ctx.barPose], contacts: ctx.setup.contacts }
}

// ---------- lying ----------

const PELVIS = (c: Capsule) => c.segment === 'pelvis' || c.segment === 'lumbar1'
const UPPER_BACK = (c: Capsule) => c.segment === 'thorax1' || c.segment === 'thorax2'
const TRUNK = (c: Capsule) => c.region === 'trunk'
const TRUNK_SEAT = (c: Capsule) => c.region === 'trunk' || c.region === 'thigh_l' || c.region === 'thigh_r'

function lyingBody(skel: Skeleton, q: Float64Array, p: P, ctx: Pick<Lying, 'tilt0'>, c: number) {
  const curl = p.pelvisCurl ? REVERSE.tilt : LYING.tilt
  const tilt = ctx.tilt0 - curl * c
  // the legs' elevation from the mat is hip flexion minus the pelvis's turn away from lying flat
  const elev = lerp(p.bottomHipAngle ?? LYING.low, p.topHipAngle, c)
  setDofs(skel, q, {
    'lumbar.flex': LYING.lumbar + curl * c,
    'thorax.flex': 0,
    'hip_*.flex': elev + 90 + tilt,
    'hip_*.abd': 0,
    'knee_*.flex': kneeAt(p, c, false),
    'ankle_*.df': ANKLE,
    'grip_*.close': 0,
  })
  setPelvis(skel, q, [0, 0.3, 0], tilt)
  // the reverse crunch rolls the pelvis up off the mat: the lumbar spine takes up the tilt, the upper back stays down;
  // at the bottom the buttocks (the thighs' proximal capsules with the hips at 90) rest on the mat too
  restOnMat(skel, q, p.pelvisCurl ? TRUNK_SEAT : TRUNK)
}

function lyingArms(skel: Skeleton, q: Float64Array, palms: ImplementSpec) {
  setDofs(skel, q, { 'clavicle_*.prot': 3, 'clavicle_*.elev': 0 })
  const s = Math.sin(PALM_ABD * DEG), co = Math.cos(PALM_ABD * DEG)
  // fingers towards the feet (+Z) and a little out
  const dir: V3 = [s, 0, co]
  attachHand(skel, q, 'l', { pos: palms.sites.l.pos, axis: [co, 0, -s], palm: [0, -1, 0], hand: palmDown('l', dir) }, { pole: [1, -0.3, 0], planeHint: 0 })
  mirrorArm(skel, q)
}

function lyingContext(p: P, skel: Skeleton, tempo: Tempo): Lying {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': LYING.lumbar, 'hip_*.flex': LYING.low })
  const res = (x: number[]) => {
    setPelvis(skel, q, [0, x[0], 0], x[1])
    const caps = bodyCapsules(skel, fk(skel, q))
    return [(matClearance(caps.filter(PELVIS)) + SINK) * 100, (matClearance(caps.filter(UPPER_BACK)) + SINK) * 100]
  }
  const tilt0 = dls(res, [0.12, -90], { tol: 1e-8, iters: 60 }).x[1]
  lyingBody(skel, q, p, { tilt0 }, 0)
  const neck0 = Math.max(-8, restHead(skel, q))
  const f = fk(skel, q)
  // palms on the mat beside the hips: the straight arm's reach from the shoulder, a little out from the side
  const sh = segPosOf(skel, f, 'humerus_l')
  const reach = 0.7
  const palmY = MAT_TOP + palmHeight(skel)
  const flat = Math.sqrt(Math.max(0.01, reach * reach - (sh[1] - palmY) ** 2))
  const palm: V3 = [sh[0] + flat * Math.sin(PALM_ABD * DEG), palmY, sh[2] + flat * Math.cos(PALM_ABD * DEG)]
  const palms = palmRest({ sites: { l: palm, r: [-palm[0], palm[1], palm[2]] } })
  const matSpec = floorMat()
  const headZ = segPosOf(skel, f, 'head')[2]
  const heelZ = segPosOf(skel, f, 'foot_l')[2]
  const mat: ImplementPose = { id: matSpec.id, pos: [0, 0, (headZ - 0.22 + heelZ + 0.12) / 2], rot: qid() }
  const contacts: Contact[] = [
    { site: 'grip_l', kind: 'grip', target: { implement: palms.id, grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: palms.id, grip: 'r' } },
  ]
  const setup: Setup = { implements: [matSpec, palms], contacts, tempo, symmetric: true }
  return { kind: 'lying', tempo, setup, tilt0, neck0, mat, palms }
}

function sampleLying(skel: Skeleton, p: P, ctx: Lying, c: number): Pose {
  const q = zeroQ(skel)
  lyingBody(skel, q, p, ctx, c)
  setDofs(skel, q, { 'neck.flex': ctx.neck0, 'head.flex': ctx.neck0 * 0.3 })
  lyingArms(skel, q, ctx.palms)
  return { q, implements: [ctx.mat, { id: ctx.palms.id, pos: [0, 0, 0], rot: qid() }], contacts: ctx.setup.contacts }
}

// ---------- template ----------

const context = memo((p: P, skel: Skeleton): Ctx => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.support !== 'none') throw new Error(`leg-raise: variant not implemented yet (support ${p.support})`)
  if (p.posture === 'hanging') return hangContext(p, skel, tempo)
  return lyingContext(p, skel, tempo)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  return ctx.kind === 'hang' ? sampleHang(skel, p, ctx, c) : sampleLying(skel, p, ctx, c)
}

export const legRaise: Template<P> = {
  id: 'leg-raise',
  driver: 'root',
  params: SCHEMAS['leg-raise'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
