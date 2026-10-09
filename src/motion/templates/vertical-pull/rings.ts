import { attachHand, root1d } from '../../constraints.ts'
import { centerOfMass, fk, sitePos } from '../../fk.ts'
import { siteWorld } from '../../implements.ts'
import { bandPose, gymRings, ringAnchor, ringPose, RING_HEIGHT } from '../../implements/index.ts'
import { add, DEG, lerp, norm, qid, scale, type V3 } from '../../math.ts'
import { setDofs, shoulderRhythm, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { monotoneCubic } from '../solve.ts'
import type { ParamsOf } from '../schemas.ts'
import type { Setup } from '../types.ts'

// Ring pull-up (333): the pull-up of the bar branch (vertical-pull.ts) hanging from gymnastic rings. Root driver: the
// hands stay on the rings and the body rises between them, its centre of mass under the grips. From a dead hang with
// the palms forward (elbows ~6 deg, shoulders shrugged up) the scapulae draw down and back first, then the elbows drive
// down; the rings turn in the hands to a neutral grip and come in a little towards the shoulders as the chin clears
// them (cue: the rings close to the body at the top). Body angles follow the bar pull-up's.

type P = ParamsOf<'vertical-pull'>

const HANG_ELBOW = 6
const CHIN_CLEARANCE = 0.03
const HANG_ELEV = 165
const TOP_ELEV = 45
const ELBOW_LAG = 1.5
/** the grips come in to this share of their hang spacing at the top */
const TOP_IN = 0.8
/** the hands' turn from palms forward to palms in, deg */
const TURN = 80

const scapularLead = (c: number) => 1 - (1 - c) ** 2.2

export type RingsHang = {
  kind: 'rings'
  anchor: ImplementPose
  /** grip half spacing at the hang, grip height */
  half: number
  y: number
  height: (c: number) => number
}

function body(skel: Skeleton, q: Float64Array, c: number, bent: boolean) {
  const sc = scapularLead(c)
  setDofs(skel, q, {
    'clavicle_*.elev': lerp(20, -4, sc),
    'clavicle_*.prot': lerp(4, -12, sc),
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

/** the left grip point and hand line at contraction c: palms forward at the hang, turned in at the top */
function grip(v: Pick<RingsHang, 'half' | 'y'>, c: number) {
  const a = -TURN * c * DEG
  return { pos: [v.half * lerp(1, TOP_IN, c), v.y, 0] as V3, axis: [Math.cos(a), 0, -Math.sin(a)] as V3, palm: [Math.sin(a), 0, Math.cos(a)] as V3 }
}

const MIRRORED = ['scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']

function arms(skel: Skeleton, q: Float64Array, v: Pick<RingsHang, 'half' | 'y'>, c: number) {
  const up = shoulderRhythm(lerp(HANG_ELEV, TOP_ELEV, scapularLead(c)), 20).uprot
  // elbows out with the palms forward, coming forward as the hands turn in
  const pole = norm(lerp3([1, 0, 0.35], [0.6, 0, 0.8], c))
  attachHand(skel, q, 'l', grip(v, c), { pole, planeHint: 20, uprot: up })
  for (const k of MIRRORED) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
}

const lerp3 = (a: V3, b: V3, t: number): V3 => add(scale(a, 1 - t), scale(b, t))

function hangPose(skel: Skeleton, c: number, ty: number, p: P, v: Pick<RingsHang, 'half' | 'y'>) {
  const q = zeroQ(skel)
  body(skel, q, c, p.legs !== 'straight')
  q[skel.dof['pelvis.ty']] = ty
  const r = root1d((z) => {
    q[skel.dof['pelvis.tz']] = z
    arms(skel, q, v, c)
    return centerOfMass(skel, fk(skel, q))[2]
  }, -0.5, 0.7, { tol: 1e-7 })
  q[skel.dof['pelvis.tz']] = r.x
  arms(skel, q, v, c)
  return q
}

export function ringsContext(p: P, skel: Skeleton, tempo: Tempo): { tempo: Tempo; setup: Setup; v: RingsHang } {
  const half = (p.gripWidth * skel.data.shoulderWidth) / 2
  const y = RING_HEIGHT.pull_up
  const anchorSpec = ringAnchor({ spread: 2 * half, whole: true })
  const v: RingsHang = { kind: 'rings', anchor: { id: anchorSpec.id, pos: [0, 0, 0], rot: qid() }, half, y, height: () => 0 }
  const elbow = (c: number, ty: number) => hangPose(skel, c, ty, p, v)[skel.dof['elbow_l.flex']]
  const yHang = root1d((ty) => elbow(0, ty) - HANG_ELBOW, y - 1.6, y - 0.9, { tol: 1e-6 }).x
  const chin = (ty: number) => sitePos(skel, fk(skel, hangPose(skel, 1, ty, p, v)), 'chin')[1] - (y + CHIN_CLEARANCE)
  const yTop = root1d(chin, yHang, yHang + 0.7, { tol: 1e-6 }).x
  const topElbow = elbow(1, yTop)
  const cs = Array.from({ length: 9 }, (_, k) => k / 8)
  const ys = cs.map((c, k) => (k === 0 ? yHang : k === 8 ? yTop : root1d((ty) => elbow(c, ty) - lerp(HANG_ELBOW, topElbow, c ** ELBOW_LAG), yHang - 0.1, yTop + 0.05, { tol: 1e-6 }).x))
  v.height = monotoneCubic(cs, ys)
  const contacts: Contact[] = [
    { site: 'grip_l', kind: 'grip', target: { implement: 'ring_l', grip: 'grip' } },
    { site: 'grip_r', kind: 'grip', target: { implement: 'ring_r', grip: 'grip' } },
  ]
  const setup: Setup = {
    implements: [anchorSpec, ...gymRings({ anchor: anchorSpec.id })],
    contacts,
    tempo,
    symmetric: true,
    balance: { point: 'com', over: { implement: 'ring_l', sites: ['grip'] }, tol: 0.025 },
  }
  return { tempo, setup, v }
}

export function sampleRings(u: number, p: P, skel: Skeleton, ctx: { tempo: Tempo; setup: Setup }, v: RingsHang): Pose {
  const c = phaseAt(u, ctx.tempo).c
  const q = hangPose(skel, c, v.height(c), p, v)
  const anchorSpec = ctx.setup.implements[0]
  const g = grip(v, c)
  const ringSpecs = ctx.setup.implements.filter((s) => s.kind === 'gym_ring')
  const rings = ringSpecs.map((spec, i) => {
    const s = i === 0 ? 1 : -1
    const top = siteWorld(anchorSpec, v.anchor, i === 0 ? 'strap_l' : 'strap_r').pos
    return ringPose(spec, [s * g.pos[0], g.pos[1], g.pos[2]], [s * g.axis[0], g.axis[1], g.axis[2]], top)
  })
  return { q, implements: [v.anchor, ...rings, bandPose('strap_l'), bandPose('strap_r')], contacts: ctx.setup.contacts }
}
