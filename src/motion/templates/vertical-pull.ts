import { attachHand, root1d } from '../constraints.ts'
import { centerOfMass, fk, sitePos } from '../fk.ts'
import { pullupBar, siteWorld, type ImplementSpec } from '../implements.ts'
import { lerp, qid, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { memo, type Setup, type Template } from './types.ts'

// Pull-up / chin-up, root driver: hands fixed on the bar, the body moves. Body height is keyed between a dead hang
// (elbows ~6 deg) and chin over the bar; the arms are solved by IK each frame and the body swings so its COM stays
// under the bar. Endpoint angles are author judgment (no clean primary-source table), to be fitted from video.

type P = ParamsOf<'vertical-pull'>

const BAR_HEIGHT = 2.4
const HANG_ELBOW = 6
const CHIN_CLEARANCE = 0.03

type Ctx = { tempo: Tempo; bar: ImplementSpec; barPose: ImplementPose; yHang: number; yTop: number; setup: Setup; p: P }

function barSpec(p: P, skel: Skeleton): ImplementSpec {
  const spec = pullupBar({ height: BAR_HEIGHT, gripWidth: p.gripWidth * skel.data.shoulderWidth })
  if (p.grip !== 'neutral') return spec
  const g = (p.gripWidth * skel.data.shoulderWidth) / 2
  return {
    ...spec,
    parts: [...spec.parts, { shape: 'cylinder', a: [g, -0.02, -0.08], b: [g, -0.02, 0.08], r: 0.016 }, { shape: 'cylinder', a: [-g, -0.02, -0.08], b: [-g, -0.02, 0.08], r: 0.016 }],
    sites: { l: { pos: [g, -0.02, 0], axis: [0, 0, 1] }, r: { pos: [-g, -0.02, 0], axis: [0, 0, 1] } },
  }
}

function palm(p: P, side: 'l' | 'r'): V3 {
  if (p.grip === 'pronated') return [0, 0, 1]
  if (p.grip === 'supinated') return [0, 0, -1]
  return side === 'l' ? [-1, 0, 0] : [1, 0, 0]
}

function pole(p: P, side: 'l' | 'r'): V3 {
  const lat = side === 'l' ? 1 : -1
  if (p.grip === 'pronated') return [lat, 0, 0.35]
  if (p.grip === 'supinated') return [-lat * 0.3, 0, 1]
  return [lat * 0.6, 0, 0.8]
}

function body(skel: Skeleton, q: Float64Array, c: number, p: P) {
  const bent = p.legs !== 'straight'
  setDofs(skel, q, {
    'clavicle_*.elev': lerp(20, -4, c),
    'clavicle_*.prot': lerp(4, -12, c),
    'thorax.flex': lerp(0, -12, c),
    'lumbar.flex': lerp(-2, -5, c),
    'neck.flex': lerp(0, -16, c),
    'head.flex': lerp(0, -8, c),
    'hip_*.flex': bent ? lerp(18, 28, c) : lerp(4, 10, c),
    'hip_*.abd': 3,
    'knee_*.flex': bent ? 75 : 6,
    'ankle_*.df': -28,
    'grip_*.close': 1,
  })
  q[skel.dof['pelvis.tilt']] = lerp(-3, -8, c)
}

function arms(skel: Skeleton, q: Float64Array, p: P, bar: ImplementSpec, barPose: ImplementPose) {
  for (const s of ['l', 'r'] as const) {
    const g = siteWorld(bar, barPose, s)
    attachHand(skel, q, s, { pos: g.pos, axis: g.axis!, palm: palm(p, s) }, { pole: pole(p, s), planeHint: 20 })
  }
}

function poseAt(skel: Skeleton, c: number, y: number, p: P, bar: ImplementSpec, barPose: ImplementPose): Float64Array {
  const q = zeroQ(skel)
  body(skel, q, c, p)
  q[skel.dof['pelvis.ty']] = y
  const r = root1d((z) => {
    q[skel.dof['pelvis.tz']] = z
    arms(skel, q, p, bar, barPose)
    return centerOfMass(skel, fk(skel, q))[2] - barPose.pos[2]
  }, -0.5, 0.5, { tol: 1e-7 })
  q[skel.dof['pelvis.tz']] = r.x
  arms(skel, q, p, bar, barPose)
  return q
}

const context = memo((p: P, skel: Skeleton): Ctx => {
  if (p.implement !== 'bodyweight' || p.posture !== 'hanging') throw new Error(`vertical-pull: variant not implemented yet (${p.implement}/${p.posture})`)
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const bar = barSpec(p, skel)
  const barPose: ImplementPose = { id: bar.id, pos: [0, BAR_HEIGHT, 0], rot: qid() }
  const elbow = (c: number, y: number) => poseAt(skel, c, y, p, bar, barPose)[skel.dof['elbow_l.flex']]
  const yHang = root1d((y) => elbow(0, y) - HANG_ELBOW, BAR_HEIGHT - 1.6, BAR_HEIGHT - 0.9, { tol: 1e-6 }).x
  const chin = (y: number) => sitePos(skel, fk(skel, poseAt(skel, 1, y, p, bar, barPose)), 'chin')[1] - (BAR_HEIGHT + CHIN_CLEARANCE)
  const yTop = root1d(chin, yHang, yHang + 0.7, { tol: 1e-6 }).x
  const contacts: Contact[] = [
    { site: 'grip_l', kind: 'grip', target: { implement: bar.id, grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: bar.id, grip: 'r' } },
  ]
  const setup: Setup = {
    implements: [bar],
    contacts,
    tempo,
    symmetric: p.laterality === 'bilateral',
    balance: { point: 'com', over: { implement: bar.id, sites: ['l', 'r'] }, tol: 0.025 },
  }
  return { tempo, bar, barPose, yHang, yTop, setup, p }
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  const q = poseAt(skel, c, lerp(ctx.yHang, ctx.yTop, c), p, ctx.bar, ctx.barPose)
  return { q, implements: [ctx.barPose], contacts: ctx.setup.contacts }
}

export const verticalPull: Template<P> = {
  id: 'vertical-pull',
  driver: 'root',
  params: SCHEMAS['vertical-pull'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
