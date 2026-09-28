import { attachHand, root1d } from '../constraints.ts'
import { centerOfMass, fk } from '../fk.ts'
import { dipBars, DIP } from '../implements/press-vertical-bodyweight.ts'
import { siteWorld, type ImplementSpec } from '../implements.ts'
import { lerp, norm, qid, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { monotoneCubic, secant } from './solve.ts'
import { memo, type Setup, type Template } from './types.ts'

// Dip, root driver: the hands hold the parallel bars and the body moves. Trunk lean (torsoAngle, a little less at
// the top), hips and bent knees are keyed; each frame the arms are solved onto the bars and the body slides so its
// centre of mass stays over the hands. Body height follows a keyed elbow curve: ~8 deg at the top (not snapped into
// lockout) to ~92 deg at the bottom, where the upper arm is about level and the shoulder extended ~50-65 deg
// (motion-authoring research: shoulder extension ~45-60, elbow ~90 at the bottom; author judgment). Chest dips let
// the elbows drift out and lean forward; upright triceps dips keep the elbows straight back.

type P = ParamsOf<'dip'>

const TOP_ELBOW = 8
const BOTTOM_ELBOW = 98
/** lean at the top as a share of the lean at the bottom */
const TOP_LEAN = 0.75

type Ctx = { tempo: Tempo; setup: Setup; bars: ImplementSpec; pose: ImplementPose; height: (c: number) => number }

const MIRRORED = ['clavicle_*.elev', 'clavicle_*.prot', 'scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']

function unsupported(p: P) {
  if (p.laterality !== 'bilateral') return `laterality ${p.laterality}`
  if (p.implement !== 'bodyweight') return `implement ${p.implement}`
  if (p.grip !== 'neutral') return `grip ${p.grip}`
  return null
}

/** keyed trunk, hips, legs and head for contraction c (1 = top) */
function body(skel: Skeleton, q: Float64Array, p: P, c: number) {
  const lean = p.torsoAngle * lerp(1, TOP_LEAN, c)
  const chest = p.torsoAngle / 60
  setDofs(skel, q, {
    'lumbar.flex': 0.15 * lean,
    'thorax.flex': 0.15 * lean + 2,
    'hip_*.flex': 0.7 * lean + 10,
    'hip_*.abd': 2,
    'knee_*.flex': p.kneeAngle,
    'ankle_*.df': -30,
    'neck.flex': -0.35 * lean,
    'head.flex': 4,
    'clavicle_*.elev': lerp(8, -6, c),
    'clavicle_*.prot': lerp(4 + 6 * chest, -2, c),
    'grip_*.close': 1,
  })
  q[skel.dof['pelvis.tilt']] = 0.7 * lean
}

/** hands on the bars: left solved, right mirrored */
function arms(skel: Skeleton, q: Float64Array, p: P, ctx: Pick<Ctx, 'bars' | 'pose'>, c: number) {
  const g = siteWorld(ctx.bars, ctx.pose, 'l')
  const out = lerp(0.1, 0.4, p.torsoAngle / 45)
  attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm: [-1, 0, 0] }, { pole: norm([out, lerp(0.1, 0.4, c), -1]), wristBias: lerp(30, 18, c), planeHint: 0 })
  for (const k of MIRRORED) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

/** body at height y with its centre of mass over the grips */
function pose(skel: Skeleton, p: P, ctx: Pick<Ctx, 'bars' | 'pose'>, c: number, y: number): Float64Array {
  const q = zeroQ(skel)
  body(skel, q, p, c)
  q[skel.dof['pelvis.ty']] = y
  const over = siteWorld(ctx.bars, ctx.pose, 'l').pos[2]
  const z = secant((z) => {
    q[skel.dof['pelvis.tz']] = z
    arms(skel, q, p, ctx, c)
    return centerOfMass(skel, fk(skel, q))[2] - over
  }, over - 0.1, over - 0.05)
  q[skel.dof['pelvis.tz']] = z
  arms(skel, q, p, ctx, c)
  return q
}

const context = memo((p: P, skel: Skeleton): Ctx => {
  const why = unsupported(p)
  if (why) throw new Error(`dip: variant not implemented yet (${why})`)
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const bars = dipBars()
  const base = { bars, pose: { id: bars.id, pos: [0, 0, 0] as V3, rot: qid() } }
  const elbow = (c: number, y: number) => pose(skel, p, base, c, y)[skel.dof['elbow_l.flex']]
  // body height along the rep: solved at a few points so the elbow follows TOP -> BOTTOM linearly in c
  const cs = Array.from({ length: 7 }, (_, k) => k / 6)
  const ys = cs.map((c) => root1d((y) => elbow(c, y) - lerp(BOTTOM_ELBOW, TOP_ELBOW, c), DIP.height - 0.3, DIP.height + 0.4, { tol: 1e-6, scan: 4 }).x)
  const contacts: Contact[] = [
    { site: 'grip_l', kind: 'grip', target: { implement: bars.id, grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: bars.id, grip: 'r' } },
  ]
  const setup: Setup = {
    implements: [bars],
    contacts,
    tempo,
    symmetric: true,
    balance: { point: 'com', over: { implement: bars.id, sites: ['l', 'r'] }, tol: 0.025 },
  }
  return { tempo, setup, ...base, height: monotoneCubic(cs, ys) }
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  return { q: pose(skel, p, ctx, c, ctx.height(c)), implements: [ctx.pose], contacts: ctx.setup.contacts }
}

export const dip: Template<P> = {
  id: 'dip',
  driver: 'root',
  params: SCHEMAS.dip,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}

