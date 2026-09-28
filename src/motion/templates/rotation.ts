import { attachHand, plantFoot, root1d, solveLegs, type FootTarget } from '../constraints.ts'
import { fk, segPos } from '../fk.ts'
import { siteWorld, type Cable, type ImplementSpec } from '../implements.ts'
import { twoHandHandle } from '../implements/core.ts'
import { add, cross, DEG, lerp, norm, qaxis, qfromBasis, qid, qmul, qrot, reject, scale, sub, type Quat, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Side, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { stackSpec } from './core/cable.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { naturalCubic } from './solve.ts'
import { hipMidLocal, setPelvis, stanceWidth, type StanceName } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Rotation: cable woodchop high to low (809). Standing side-on to a high pulley on the working side, wide stance,
// both hands on a two-hand D-handle with long arms; hips and torso turn together from facing the stack to facing
// away (pelvis yaw plus lumbar and thoracic rotation, ~110 deg of shoulder-line turn), the weight shifts to the far
// leg, the near foot pivots on its toes (heel up, turning in) and the knees soften as the handle finishes outside
// the far knee. Research (motion-authoring): trunk rotation +-30-45 deg, transverse-plane motion is author judgment.

type P = ParamsOf<'rotation'>

/** start (c = 0, arms up towards the pulley) and finish (c = 1, handle outside the far knee), deg / m, for side right */
export const CHOP = {
  yaw: [-26, 24],
  lumbarRot: [-8, 7],
  thoraxRot: [-24, 18],
  lumbarFlex: [0, 10],
  thoraxFlex: [-2, 22],
  bend: [-4, 4],
  /** pelvis shift towards the far foot, m; hip height drop, m */
  shift: [-0.05, 0.07],
  drop: [0.015, 0.075],
  /** near foot: heel lift about the toes and inward turn at the finish, deg */
  heel: 14,
  pivot: 32,
} as const
/** elbow flexion of the straighter arm (long arms), deg */
const LONG_ELBOW = 10
const GAP = 0.1
/** wrist deviation band for the two-hand grip, deg: the chop turns the handle across the palms, so the hands use
 * nearly the whole range (joint limits -35..20) instead of settling obliquely */
const DEV: [number, number] = [-33, 18]
const CABLE_KG = 12
const TOE_OUT = 15
/** pulley beside the lifter on the working side, m */
const PULLEY_OUT = 1.0
/** pulley ahead of the feet line, m: the cable runs in front of the chest at the finish */
const PULLEY_Z = 0.5

/** where the arms point, world, side right (mirrored for left): up towards the pulley at the start, outside the far
 * knee at the finish, bowing forward through the middle of the chop */
const AIM = { start: [-0.85, 2.15, 0.4] as V3, end: [0.8, 0.5, 0.55] as V3, bow: 0.32 }

type Ctx = {
  tempo: Tempo
  setup: Setup
  work: Side
  /** +1 when the stack is on the right (mirror sign for left) */
  s: number
  feet: { near: FootTarget; far: FootTarget }
  nearToe: V3
  handle: ImplementSpec
  pulley: V3
  hipY: number
  reach: (c: number) => number
}

/** near foot pivoting on its toes: heel lifted and turned in by the share `k` of the finish (the forefoot collision
 * capsule is rigid with the foot and covers the toes, so it pivots at the toe site rather than the ball) */
function nearFoot(skel: Skeleton, ctx: Pick<Ctx, 'work' | 's' | 'nearToe' | 'feet'>, k: number): FootTarget {
  const turn = qaxis([0, 1, 0], ctx.s * CHOP.pivot * k * DEG)
  const lift = qaxis([1, 0, 0], CHOP.heel * k * DEG)
  const rot = qmul(qmul(turn, ctx.feet.near.rot), lift)
  return { side: ctx.work, rot, ankle: sub(ctx.nearToe, qrot(rot, skel.data.sites[`toe_${ctx.work}`].local)) }
}

function body(skel: Skeleton, q: Float64Array, ctx: Ctx, c: number) {
  const s = ctx.s
  setDofs(skel, q, {
    'lumbar.rot': s * lerp(CHOP.lumbarRot[0], CHOP.lumbarRot[1], c),
    'thorax.rot': s * lerp(CHOP.thoraxRot[0], CHOP.thoraxRot[1], c),
    'lumbar.flex': lerp(CHOP.lumbarFlex[0], CHOP.lumbarFlex[1], c),
    'thorax.flex': lerp(CHOP.thoraxFlex[0], CHOP.thoraxFlex[1], c),
    'lumbar.bend': s * lerp(CHOP.bend[0], CHOP.bend[1], c) * 0.5,
    'thorax.bend': s * lerp(CHOP.bend[0], CHOP.bend[1], c) * 0.5,
    'neck.flex': lerp(-4, 12, c),
    'neck.rot': s * lerp(-6, 8, c),
    'clavicle_*.prot': lerp(12, 8, c),
    'clavicle_*.elev': lerp(8, 4, c),
    'grip_*.close': 1,
  })
  const hip: V3 = [s * lerp(CHOP.shift[0], CHOP.shift[1], c), ctx.hipY - lerp(CHOP.drop[0], CHOP.drop[1], c), 0]
  setPelvis(skel, q, hip, 4, s * lerp(CHOP.yaw[0], CHOP.yaw[1], c))
  const k = Math.max(0, Math.min(1, (c - 0.35) / 0.65))
  const pivot = k * k * (3 - 2 * k)
  solveLegs(skel, q, [nearFoot(skel, ctx, pivot), ctx.feet.far])
  q[skel.dof[`toe_${ctx.work}.flex`]] = -CHOP.heel * pivot
}

type Hold = { pose: ImplementPose; hand: Quat; up: V3 }

/**
 * Handle centre `d` m from the shoulder midpoint towards the aim point at c. The fists are stacked on the bar like a
 * bat grip, thumbs across the arms and fingers along them, so the forearms stay mid-range; the left fist is the
 * upper one and the rods turn towards the pulley.
 */
function handleAt(skel: Skeleton, q: Float64Array, ctx: Ctx, c: number, d: number): Hold {
  const f = fk(skel, q)
  const mid = scale(add(segPos(skel, f, 'humerus_l'), segPos(skel, f, 'humerus_r')), 0.5)
  const aim = add(lerpV(AIM.start, AIM.end, c), [0, 0, AIM.bow * Math.sin(Math.PI * c)])
  const dir = norm(sub([ctx.s * aim[0], aim[1], aim[2]], mid))
  const center = add(mid, scale(dir, d))
  // thumbs up across the arms at the start, forwards at the finish (the bar swings down like an axe handle)
  const up = norm(reject(norm([0, 1 - c, c]), dir))
  const toward = norm(reject(sub(ctx.pulley, center), up))
  const rot = qfromBasis(up, toward)
  const grip = scale(add(ctx.handle.sites.l.pos, ctx.handle.sites.r.pos), 0.5)
  return { pose: { id: ctx.handle.id, pos: sub(center, qrot(rot, grip)), rot }, hand: qfromBasis(cross(scale(dir, -1), up), scale(dir, -1)), up }
}

const lerpV = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

function arms(skel: Skeleton, q: Float64Array, ctx: Ctx, h: Hold) {
  for (const side of ['l', 'r'] as const) {
    const g = siteWorld(ctx.handle, h.pose, side)
    const out = side === 'l' ? 1 : -1
    attachHand(skel, q, side, { pos: g.pos, axis: g.axis!, palm: qrot(h.hand, [-out, 0, 0]) }, { pole: add(scale(h.up, -0.3), [out * 0.6, -1, 0]), planeHint: 60, devBand: DEV })
  }
}

function solveFrame(skel: Skeleton, ctx: Ctx, c: number, d: number): { q: Float64Array; pose: ImplementPose } {
  const q = zeroQ(skel)
  body(skel, q, ctx, c)
  const h = handleAt(skel, q, ctx, c, d)
  arms(skel, q, ctx, h)
  return { q, pose: h.pose }
}

const context = memo((p: P, skel: Skeleton): Ctx => {
  if (p.implement !== 'cable' || p.direction !== 'high_to_low' || p.posture !== 'standing' || p.stance === 'split' || (p.attachment ?? 'single_handle') !== 'single_handle') {
    throw new Error(`rotation: variant not implemented yet (${p.implement}/${p.direction}/${p.posture}/${p.stance}/${p.attachment ?? '-'})`)
  }
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const work: Side = p.side === 'left' ? 'l' : 'r'
  const s = work === 'r' ? 1 : -1
  const width = stanceWidth(skel, p.stance as StanceName)
  const far: Side = work === 'r' ? 'l' : 'r'
  const nearX = work === 'l' ? width / 2 : -width / 2
  const feet = {
    near: plantFoot(skel, work, [nearX, 0, 0], TOE_OUT),
    far: plantFoot(skel, far, [-nearX, 0, 0], TOE_OUT),
  }
  const nearToe = add(feet.near.ankle, qrot(feet.near.rot, skel.data.sites[`toe_${work}`].local))
  // standing hip height with straight-ish legs over the wide stance
  const hipY = skel.data.standingHeight + hipMidLocal(skel)[1] - 0.03
  const handle = twoHandHandle({ gap: GAP })
  const pulley: V3 = [-s * PULLEY_OUT, 2.0, PULLEY_Z]
  const ctx: Ctx = { tempo, setup: undefined as unknown as Setup, work, s, feet, nearToe, handle, pulley, hipY, reach: () => 0.6 }
  // arm reach at knots: the straighter arm nearly straight
  const cs = Array.from({ length: 13 }, (_, k) => 0.5 - 0.5 * Math.cos((Math.PI * k) / 12))
  const ds = cs.map((c) => root1d((d) => {
    const { q } = solveFrame(skel, ctx, c, d)
    // soft minimum: which arm is the straighter one changes mid-chop, and a hard min would kink the reach
    const [a, b] = [q[skel.dof['elbow_l.flex']], q[skel.dof['elbow_r.flex']]]
    return -10 * Math.log(Math.exp(-a / 10) + Math.exp(-b / 10)) - LONG_ELBOW
  }, 0.35, 0.8, { tol: 1e-5 }).x)
  ctx.reach = naturalCubic(cs, ds)
  const cable: Cable = { pulley, implement: handle.id, point: [0, 0, 0], kg: CABLE_KG }
  const contacts: Contact[] = [
    { site: `toe_${work}`, kind: 'planted', target: { world: nearToe } },
    ...(['heel', 'ball'] as const).map((site): Contact => ({ site: `${site}_${far}`, kind: 'planted', target: { world: add(feet.far.ankle, qrot(feet.far.rot, skel.data.sites[`${site}_${far}`].local)) } })),
    { site: 'grip_l', kind: 'grip', target: { implement: handle.id, grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: handle.id, grip: 'r' } },
  ]
  ctx.setup = { implements: [handle, stackSpec(pulley, [-s, 0, 0])], contacts, tempo, symmetric: false, cables: [cable] }
  return ctx
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  const { q, pose } = solveFrame(skel, ctx, c, ctx.reach(c))
  return { q, implements: [pose, { id: 'stack', pos: [0, 0, 0], rot: qid() }], contacts: ctx.setup.contacts }
}

export const rotation: Template<P> = {
  id: 'rotation',
  driver: 'implement',
  params: SCHEMAS.rotation,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}

