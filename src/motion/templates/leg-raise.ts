import { attachHand, root1d } from '../constraints.ts'
import { bodyCapsules, type Capsule } from '../collide.ts'
import { centerOfMass, fk } from '../fk.ts'
import { pullupBar, siteWorld, type ImplementSpec } from '../implements.ts'
import { palmRest } from '../implements/core.ts'
import { floorMat } from '../implements/shared.ts'
import { dls } from '../ik.ts'
import { naturalCubic, secant } from './solve.ts'
import { DEG, lerp, qid, smoothstep, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { MAT_TOP, matClearance, mirrorArm, palmDown, palmHeight, restHead, restOnMat, segPosOf, SINK } from './core/floor.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { setPelvis } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Leg raise: hip flexion with the pelvis curling up at the top (posterior tilt) and no swing. The topHipAngle param is
// the total flexion between thighs and thorax (hip plus lumbar and thoracic flexion); research (motion-authoring):
// hip 0 -> 90-110 deg. Hanging (802, 806): active hang from a pull-up bar, elbows ~6 deg, the body's centre of mass
// held under the grips every frame (so the trunk moves back and leans a little as the legs rise, it never swings);
// straight legs (knees soft) or knees bending to the param on the way up. Lying (807): supine on a mat, palms down
// beside the hips, straight legs from just off the mat to the param, the lower back pressed down (posterior tilt
// growing towards the top, the lumbar spine flattening so the upper back stays still).

type P = ParamsOf<'leg-raise'>

/** hanging: lean back of the thorax at the top, lumbar and thoracic flexion bottom -> top (pelvis curls up), deg */
export const HANG = { lean: 6, lumbar: [0, 16], thorax: [0, 4], clavicle: 12, elbow: 6, neck: [0, 8] } as const
/** total flexion at the dead hang (thighs a touch forward), knee flexion hanging for bent-knee raises, deg */
const HANG_FLEX = 4
const HANG_KNEE_BENT = 16
/** toes this far above the floor at the dead hang, m */
const TOE_CLEAR = 0.08
/** grip width, multiples of shoulder width (pronated, a little wider than the shoulders) */
const GRIP = 1.35
/** lying: legs this far above the mat at the bottom, posterior pelvic tilt added at the top, deg */
export const LYING = { low: 14, tilt: 10, lumbar: 3 } as const
/** lying: arms on the mat a little out from the sides (deg), palms down */
const PALM_ABD = 12
/** knees soft on straight-leg raises, ankles relaxed, deg */
const SOFT_KNEE = 3
const ANKLE = -22

type Hang = { kind: 'hang'; tempo: Tempo; setup: Setup; bar: ImplementSpec; barPose: ImplementPose; root: (c: number) => [number, number] }
type Lying = { kind: 'lying'; tempo: Tempo; setup: Setup; tilt0: number; neck0: number; mat: ImplementPose; palms: ImplementSpec }
type Ctx = Hang | Lying

const bent = (p: P) => p.kneeAngle > 30

/** knee flexion over the rep: straight legs stay soft, bent-knee raises fold as the thighs come up */
function kneeAt(p: P, c: number, hanging: boolean) {
  if (!bent(p)) return Math.max(SOFT_KNEE, p.kneeAngle)
  return lerp(hanging ? HANG_KNEE_BENT : p.kneeAngle, p.kneeAngle, smoothstep(Math.min(1, c * 1.4)))
}

// ---------- hanging ----------

function hangBody(skel: Skeleton, q: Float64Array, p: P, c: number) {
  const lumbar = lerp(HANG.lumbar[0], HANG.lumbar[1], c)
  const thorax = lerp(HANG.thorax[0], HANG.thorax[1], c)
  const total = lerp(HANG_FLEX, p.topHipAngle, c)
  setDofs(skel, q, {
    'clavicle_*.elev': HANG.clavicle,
    'clavicle_*.prot': 2,
    'lumbar.flex': lumbar,
    'thorax.flex': thorax,
    'neck.flex': lerp(HANG.neck[0], HANG.neck[1], c),
    'hip_*.flex': total - lumbar - thorax,
    'hip_*.abd': 1,
    'knee_*.flex': kneeAt(p, c, true),
    'ankle_*.df': ANKLE,
    'grip_*.close': 1,
  })
  // thorax lean back in the world: the pelvis tilts back under it by the spinal flexion
  q[skel.dof['pelvis.tilt']] = -HANG.lean * c - lumbar - thorax
}

function hangArms(skel: Skeleton, q: Float64Array, v: Pick<Hang, 'bar' | 'barPose'>) {
  const g = siteWorld(v.bar, v.barPose, 'l')
  attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm: [0, 0, 1] }, { pole: [1, 0, 0.35], planeHint: 20 })
  mirrorArm(skel, q)
}

/** root height and depth that hang the body with the elbows at HANG.elbow and its centre of mass under the grips */
function hangPose(skel: Skeleton, p: P, v: Pick<Hang, 'bar' | 'barPose'>, c: number): Float64Array {
  const q = zeroQ(skel)
  hangBody(skel, q, p, c)
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

function hangContext(p: P, skel: Skeleton, tempo: Tempo): Hang {
  const bar = pullupBar({ height: 2.4, gripWidth: GRIP * skel.data.shoulderWidth })
  // hang at a trial bar height, then raise the bar so the toes clear the floor
  const trial = { bar, barPose: { id: bar.id, pos: [0, 2.4, 0] as V3, rot: qid() } }
  const q0 = hangPose(skel, p, trial, 0)
  const low = Math.min(...bodyCapsules(skel, fk(skel, q0)).map((cp) => Math.min(cp.a[1], cp.b[1]) - cp.r))
  const height = 2.4 + TOE_CLEAR - low
  const spec = pullupBar({ height, gripWidth: GRIP * skel.data.shoulderWidth })
  const barPose: ImplementPose = { id: spec.id, pos: [0, height, 0], rot: qid() }
  // root height and depth solved at knots (dense at both ends of the rep) and splined over contraction
  const cs = Array.from({ length: 13 }, (_, k) => 0.5 - 0.5 * Math.cos((Math.PI * k) / 12))
  const roots = cs.map((c) => {
    const q = hangPose(skel, p, { bar: spec, barPose }, c)
    return [q[skel.dof['pelvis.ty']], q[skel.dof['pelvis.tz']]]
  })
  const ys = naturalCubic(cs, roots.map((r) => r[0])), zs = naturalCubic(cs, roots.map((r) => r[1]))
  const contacts: Contact[] = [
    { site: 'grip_l', kind: 'grip', target: { implement: spec.id, grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: spec.id, grip: 'r' } },
  ]
  const setup: Setup = {
    implements: [spec],
    contacts,
    tempo,
    symmetric: true,
    balance: { point: 'com', over: { implement: spec.id, sites: ['l', 'r'] }, tol: 0.02 },
  }
  return { kind: 'hang', tempo, setup, bar: spec, barPose, root: (c) => [ys(c), zs(c)] }
}

function sampleHang(skel: Skeleton, p: P, ctx: Hang, c: number): Pose {
  const q = zeroQ(skel)
  hangBody(skel, q, p, c)
  const [y, z] = ctx.root(c)
  q[skel.dof['pelvis.ty']] = y
  q[skel.dof['pelvis.tz']] = z
  hangArms(skel, q, ctx)
  return { q, implements: [ctx.barPose], contacts: ctx.setup.contacts }
}

// ---------- lying ----------

const PELVIS = (c: Capsule) => c.segment === 'pelvis' || c.segment === 'lumbar1'
const UPPER_BACK = (c: Capsule) => c.segment === 'thorax1' || c.segment === 'thorax2'
const TRUNK = (c: Capsule) => c.region === 'trunk'

function lyingBody(skel: Skeleton, q: Float64Array, p: P, ctx: Pick<Lying, 'tilt0'>, c: number) {
  const tilt = ctx.tilt0 - LYING.tilt * c
  // the legs' elevation from the mat is hip flexion minus the pelvis's turn away from lying flat
  const elev = lerp(LYING.low, p.topHipAngle, c)
  setDofs(skel, q, {
    'lumbar.flex': LYING.lumbar + LYING.tilt * c,
    'thorax.flex': 0,
    'hip_*.flex': elev + 90 + tilt,
    'hip_*.abd': 0,
    'knee_*.flex': kneeAt(p, c, false),
    'ankle_*.df': ANKLE,
    'grip_*.close': 0,
  })
  setPelvis(skel, q, [0, 0.3, 0], tilt)
  restOnMat(skel, q, TRUNK)
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
