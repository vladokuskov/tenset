import { attachHand, plantFoot, root1d, solveLegs, type FootTarget } from '../constraints.ts'
import { fk, segPos } from '../fk.ts'
import { siteWorld, type Cable, type ImplementSpec } from '../implements.ts'
import { twoHandHandle } from '../implements/core.ts'
import { add, cross, DEG, lerp, norm, qaxis, qfromBasis, qid, qmul, qrot, reject, scale, sub, type Quat, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Side, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { band, bandAnchor, bandGrip, bandPose, poseHandle } from '../implements/bands.ts'
import { stackSpec } from './core/cable.ts'
import { floorMat } from '../implements/shared.ts'
import { footContacts, legToward, MAT_TOP } from './core/floor.ts'
import { landmineContext, sampleLandmine, type Landmine } from './core/landmine.ts'
import { base as kneelBase, kneel } from './floor-core/quadruped.ts'
import { ROPE_IDS, ropeContacts, ropeImplements, ropePoses } from './triceps/rope.ts'
import { sampleTwist, twistContext, type Twist } from './core/twist.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { naturalCubic } from './solve.ts'
import { hipMidLocal, setPelvis, stanceWidth, type StanceName } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Rotation: cable woodchop high to low (809). Standing side-on to a high pulley on the working side, wide stance,
// both hands on a two-hand D-handle with long arms; hips and torso turn together from facing the stack to facing
// away (pelvis yaw plus lumbar and thoracic rotation, ~110 deg of shoulder-line turn), the weight shifts to the far
// leg, the near foot pivots on the ball (heel up, turning in, toes flat) and the knees soften as the handle finishes low outside
// the far hip. Research (motion-authoring): trunk rotation +-30-45 deg, transverse-plane motion is author judgment.
// Low to high (832): the same turn from a low pulley, starting sunk and bent towards the handle low by the near thigh
// and finishing tall with long arms above the far shoulder (the chop's spine flexion and hip drop run the other way).
// Band woodchop (833): the chop with a loop band anchored high on a post where the pulley stands, both fists stacked
// on the band's end where they hold the cable handle (the band runs from the anchor into the upper fist, out of the
// lower one and back), its pull in the balance as the cable's. Russian twist (821): seated, core/twist.ts. Landmine
// rotation (822, implement barbell): core/landmine.ts. Half-kneeling rope chop (831): kneelChop.

type P = ParamsOf<'rotation'>

/** start (c = 0, arms up towards the pulley) and finish (c = 1, handle low outside the far hip), deg / m, for side right */
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
  /** near foot: heel lift about the ball and inward turn at the finish, deg */
  heel: 20,
  pivot: 32,
} as const
/** low to high lift: as CHOP, the spine flexion and hip drop reversed (sunk and bent at the low start, tall at the finish) */
export const LIFT = {
  ...CHOP,
  lumbarFlex: [16, 0],
  thoraxFlex: [32, -2],
  drop: [0.18, 0.015],
} as const
/** elbow flexion of the straighter arm (long arms), deg */
const LONG_ELBOW = 6
const GAP = 0.1
/** wrist deviation band for the two-hand grip, deg: the chop turns the handle across the palms, so the hands use
 * nearly the whole range (joint limits -35..20) instead of settling obliquely */
const DEV: [number, number] = [-33, 18]
const CABLE_KG = 12
/** the near foot's forefoot capsule (rigid, straight toes) dips this far into the floor at full heel lift while the
 * drawn toes lie flat, mm (the push-up and plank FOOT_SINK, a lead decision) */
export const FOOT_SINK = 22
const TOE_OUT = 15
/** pulley beside the lifter on the working side, m */
const PULLEY_OUT = 1.0
/** pulley ahead of the feet line, m: the cable runs in front of the chest at the finish */
const PULLEY_Z = 0.5
/** band: the post's hook this far beside the lifter, m, further out along the pull line than the pulley so the loop
 * stays stretched at the top of the chop (hook to fists >= 1 m, about a 2.3x stretch range) */
const BAND_OUT = 1.55

/** where the arms point, world, side right (mirrored for left): up towards the pulley at the start, outside the far
 * knee at the finish, bowing forward through the middle of the chop */
const AIM = { start: [-0.85, 2.15, 0.4] as V3, end: [0.8, 0.5, 0.55] as V3, bow: 0.32 }
/** low to high: low by the near thigh at the start, above the far shoulder at the finish where the chest faces
 * (aimed across less, the near arm folds), bowing well forward so neither arm folds as the fists swap over midway */
const LIFT_AIM = { start: [-1.0, -0.1, 0.4] as V3, end: [0.85, 2.0, 0.65] as V3, bow: 0.4 }
/** where the thumbs point along the bar, world, side right: up at the start, forwards, up and across towards the far
 * side at the finish, so both wrists stay inside their deviation band and the bar sits square in both fists (a bar
 * turned straight forwards needs more radial deviation of the lower hand than it has, and slides across its palm) */
const THUMBS = { start: [-0.25, 1, 0] as V3, end: [1, 0.5, 1] as V3 }
/** low to high: thumbs forwards at the low start, up and across towards the far side at the finish (the bar square
 * in both fists, the handle's rods off the lower forearm) */
const LIFT_THUMBS = { start: [0, 0.5, 1] as V3, end: [0.55, 1, 0.4] as V3 }

type Body = { [K in keyof typeof CHOP]: (typeof CHOP)[K] extends readonly number[] ? readonly [number, number] : number }
type Path = { body: Body; aim: typeof AIM; thumbs: typeof THUMBS; neck: [number, number]; clav: { prot: [number, number]; elev: [number, number] }; pulleyY: number }
const PATHS: Record<'high_to_low' | 'low_to_high', Path> = {
  high_to_low: { body: CHOP, aim: AIM, thumbs: THUMBS, neck: [-4, 12], clav: { prot: [12, 8], elev: [8, 4] }, pulleyY: 2.0 },
  low_to_high: { body: LIFT, aim: LIFT_AIM, thumbs: LIFT_THUMBS, neck: [10, -6], clav: { prot: [8, 12], elev: [4, 8] }, pulleyY: 0.1 },
}

type Ctx = {
  kind: 'chop'
  tempo: Tempo
  setup: Setup
  work: Side
  /** +1 when the stack is on the right (mirror sign for left) */
  s: number
  path: Path
  feet: { near: FootTarget; far: FootTarget }
  nearBall: V3
  handle: ImplementSpec
  pulley: V3
  hipY: number
  reach: (c: number) => number
  /** band: the anchor's pose (its hook where the pulley would be) and the two fists' band grips (upper, lower) */
  band?: { anchor: ImplementPose; hook: V3; grips: [ImplementSpec, ImplementSpec] }
  /** half kneeling: the lower body held still (root and leg angles of this pose), the rope drawn from the fists */
  kneel?: { q: Float64Array; mat: ImplementPose }
}

/** band grips: the left fist on the upper one */
const BAND_GRIPS = { l: 'band_l', r: 'band_r' } as const

/** near foot pivoting on the ball: heel lifted and turned in by the share `k` of the finish, the toes flexed back
 * so they stay flat (the forefoot collision capsule is rigid with the foot and dips into the floor, FOOT_SINK) */
function nearFoot(skel: Skeleton, ctx: Pick<Ctx, 'work' | 's' | 'nearBall' | 'feet'>, k: number): FootTarget {
  const turn = qaxis([0, 1, 0], ctx.s * CHOP.pivot * k * DEG)
  const lift = qaxis([1, 0, 0], CHOP.heel * k * DEG)
  const rot = qmul(qmul(turn, ctx.feet.near.rot), lift)
  return { side: ctx.work, rot, ankle: sub(ctx.nearBall, qrot(rot, skel.data.sites[`ball_${ctx.work}`].local)) }
}

function body(skel: Skeleton, q: Float64Array, ctx: Ctx, c: number) {
  const s = ctx.s
  const CHOP = ctx.path.body
  const { neck, clav } = ctx.path
  setDofs(skel, q, {
    'lumbar.rot': s * lerp(CHOP.lumbarRot[0], CHOP.lumbarRot[1], c),
    'thorax.rot': s * lerp(CHOP.thoraxRot[0], CHOP.thoraxRot[1], c),
    'lumbar.flex': lerp(CHOP.lumbarFlex[0], CHOP.lumbarFlex[1], c),
    'thorax.flex': lerp(CHOP.thoraxFlex[0], CHOP.thoraxFlex[1], c),
    'lumbar.bend': s * lerp(CHOP.bend[0], CHOP.bend[1], c) * 0.5,
    'thorax.bend': s * lerp(CHOP.bend[0], CHOP.bend[1], c) * 0.5,
    'neck.flex': lerp(neck[0], neck[1], c),
    'neck.rot': s * lerp(-6, 8, c),
    'clavicle_*.prot': lerp(clav.prot[0], clav.prot[1], c),
    'clavicle_*.elev': lerp(clav.elev[0], clav.elev[1], c),
    'grip_*.close': 1,
  })
  if (ctx.kneel) {
    // half kneeling: the hips stay square and still, so the whole turn is the spine's; no side bend (the compact
    // motion's size budget, with the rope's moving pieces)
    for (const n of KNEEL_DOFS) q[skel.dof[n]] = ctx.kneel.q[skel.dof[n]]
    setDofs(skel, q, { 'lumbar.bend': 0, 'thorax.bend': 0 })
    return
  }
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
  const { aim: AIM, thumbs: THUMBS } = ctx.path
  const aim = add(lerpV(AIM.start, AIM.end, c), [0, 0, AIM.bow * Math.sin(Math.PI * c)])
  const dir = norm(sub([ctx.s * aim[0], aim[1], aim[2]], mid))
  const center = add(mid, scale(dir, d))
  // thumbs up across the arms at the start, forwards and across at the finish (the bar swings down like an axe handle)
  const [a, b] = [THUMBS.start, THUMBS.end].map((t): V3 => [ctx.s * t[0], t[1], t[2]])
  const up = norm(reject(add(scale(a, 1 - c), scale(b, c)), dir))
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

/** half kneeling: root and leg DOFs copied from the kneeling pose every frame */
const KNEEL_DOFS = ['pelvis.tx', 'pelvis.ty', 'pelvis.tz', 'pelvis.rot', 'pelvis.tilt', 'pelvis.list', ...['hip', 'knee', 'ankle', 'toe'].flatMap((j) => ['l', 'r'].flatMap((sd) => (j === 'hip' ? ['flex', 'abd', 'rot'] : j === 'ankle' ? ['df', 'inv'] : ['flex']).map((k) => `${j}_${sd}.${k}`)))]
/** half kneeling: the front foot this far ahead of the hips and out from the midline, m; rope strand length, m */
const HALF_KNEEL = { ahead: 0.42, out: 0.14 } as const
const ROPE_FREE = 0.32
/** the strands leave the fists this far past the grip centre, m (the kneeling cable crunch's ROPE_EXIT) */
const ROPE_EXIT = 0.08
/** half kneeling: the fists further apart on the rope's two ends (m), the chop turned more in the spine and aimed less
 * far across (the hips cannot turn), the pulley set lower for the lower shoulders (m) */
const ROPE_GAP = 0.15
const KNEEL_PATH: Path = {
  ...PATHS.high_to_low,
  body: { ...CHOP, thoraxRot: [-28, 30], lumbarRot: [-10, 12] },
  aim: { ...AIM, start: [-0.85, 1.7, 0.45], end: [0.62, 0.55, 0.75] },
  pulleyY: 1.6,
}

/**
 * Half-kneeling chop (831): side-on to a high pulley with the near knee down (the working side's: thigh straight down,
 * toes tucked on a mat) and the far foot planted ahead, both hips square; both fists on a rope. The chop's path and
 * spine turn are the standing chop's (the pelvis neither turns nor drops), the rope drawn from the fists to the
 * pulley as in the kneeling cable crunch (triceps/rope.ts).
 */
function kneelChop(p: P, skel: Skeleton): Ctx {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const work: Side = p.side === 'left' ? 'l' : 'r'
  const s = work === 'r' ? 1 : -1
  const far: Side = work === 'r' ? 'l' : 'r'
  const k = kneel(skel, 0)
  const q = zeroQ(skel)
  kneelBase(skel, q, { tilt: 0, ...k })
  // the far leg forward: the foot flat on the mat ahead of its hip
  const f0 = fk(skel, q)
  const farHip = f0.pos[skel.seg[`femur_${far}`]]
  const foot = plantFoot(skel, far, [farHip[0] + (far === 'l' ? 1 : -1) * (HALF_KNEEL.out - Math.abs(farHip[0])), 0, farHip[2] + HALF_KNEEL.ahead], 6, MAT_TOP)
  legToward(skel, q, foot, [0, 1, 0.5])
  const fk1 = fk(skel, q)
  const hipY = fk1.pos[skel.seg.femur_l][1]
  const handle = twoHandHandle({ gap: ROPE_GAP })
  const path = KNEEL_PATH
  const pulley: V3 = [-s * PULLEY_OUT, path.pulleyY, PULLEY_Z]
  const nearToe = fk1.pos[skel.seg[`foot_${work}`]]
  const mat = floorMat({ length: 1.1, width: 0.7 })
  const matPose: ImplementPose = { id: mat.id, pos: [0, 0, (nearToe[2] - 0.15 + foot.ankle[2] + 0.25) / 2], rot: qid() }
  const ctx: Ctx = { kind: 'chop', tempo, setup: undefined as unknown as Setup, work, s, path, feet: { near: foot, far: foot }, nearBall: [0, 0, 0], handle, pulley, hipY, reach: () => 0.6, kneel: { q, mat: matPose } }
  const cs = Array.from({ length: 13 }, (_, i) => 0.5 - 0.5 * Math.cos((Math.PI * i) / 12))
  const ds = cs.map((c) => root1d((d) => {
    const { q: qq } = solveFrame(skel, ctx, c, d)
    const [a, b] = [qq[skel.dof['elbow_l.flex']], qq[skel.dof['elbow_r.flex']]]
    return -10 * Math.log(Math.exp(-a / 10) + Math.exp(-b / 10)) - LONG_ELBOW
  }, 0.3, 0.8, { tol: 1e-5 }).x)
  ctx.reach = naturalCubic(cs, ds)
  const contacts: Contact[] = [
    ...footContacts(skel, [{ side: work, rot: fk1.rot[skel.seg[`foot_${work}`]], ankle: fk1.pos[skel.seg[`foot_${work}`]] }], ['ball', 'toe']),
    ...footContacts(skel, [foot]),
    ...ropeContacts(),
  ]
  const cable: Cable = { pulley, implement: ROPE_IDS.handle, point: [0, 0, 0], kg: CABLE_KG }
  ctx.setup = { implements: [...ropeImplements(ROPE_FREE), stackSpec(pulley, [-s, 0, 0]), mat], contacts, tempo, symmetric: false, cables: [cable] }
  return ctx
}

const context = memo((p: P, skel: Skeleton): Ctx | Twist | Landmine => {
  if (p.implement === 'barbell' && p.posture === 'standing' && p.direction === 'horizontal' && p.laterality !== 'bilateral' && p.stance !== 'split') return landmineContext(p, skel, p.tempo ?? DEFAULT_TEMPO)
  if (p.implement === 'plate' && p.posture === 'seated' && p.direction === 'horizontal' && p.laterality !== 'bilateral') return twistContext(p, skel, p.tempo ?? DEFAULT_TEMPO)
  // the pulley sits where the handle starts: high for the chop, low for the lift
  const height = p.direction === 'low_to_high' ? 'low' : 'high'
  const kneeling = p.implement === 'cable' && p.posture === 'kneeling' && p.attachment === 'rope' && p.direction === 'high_to_low' && p.cableHeight === 'high' && p.laterality === 'unilateral'
  if (kneeling) return kneelChop(p, skel)
  if ((p.implement !== 'cable' && !(p.implement === 'band' && p.direction === 'high_to_low')) || p.direction === 'horizontal' || p.cableHeight !== height || p.posture !== 'standing' || p.stance === 'split' || (p.attachment ?? 'single_handle') !== 'single_handle') {
    throw new Error(`rotation: variant not implemented yet (${p.implement}/${p.direction}/${p.cableHeight}/${p.posture}/${p.stance}/${p.attachment ?? '-'})`)
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
  const nearBall = add(feet.near.ankle, qrot(feet.near.rot, skel.data.sites[`ball_${work}`].local))
  // standing hip height with straight-ish legs over the wide stance
  const hipY = skel.data.standingHeight + hipMidLocal(skel)[1] - 0.03
  const handle = twoHandHandle({ gap: GAP })
  const path = PATHS[p.direction]
  const pulley: V3 = [-s * PULLEY_OUT, path.pulleyY, PULLEY_Z]
  const ctx: Ctx = { kind: 'chop', tempo, setup: undefined as unknown as Setup, work, s, path, feet, nearBall, handle, pulley, hipY, reach: () => 0.6 }
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
  const isBand = p.implement === 'band'
  const contacts: Contact[] = [
    { site: `ball_${work}`, kind: 'planted', target: { world: nearBall } },
    ...(['heel', 'ball'] as const).map((site): Contact => ({ site: `${site}_${far}`, kind: 'planted', target: { world: add(feet.far.ankle, qrot(feet.far.rot, skel.data.sites[`${site}_${far}`].local)) } })),
    { site: 'grip_l', kind: 'grip', target: isBand ? { implement: BAND_GRIPS.l, grip: 'c' } : { implement: handle.id, grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: isBand ? { implement: BAND_GRIPS.r, grip: 'c' } : { implement: handle.id, grip: 'r' } },
  ]
  if (isBand) {
    // a post beside the lifter, its face turned towards them, the hook at the pulley's height further out
    const hook: V3 = [-s * BAND_OUT, pulley[1], PULLEY_Z]
    const anchorSpec = bandAnchor({ id: 'anchor', height: hook[1], mount: 'post' })
    const rot = qaxis([0, 1, 0], s * 90 * DEG)
    const anchor: ImplementPose = { id: anchorSpec.id, pos: sub(hook, qrot(rot, anchorSpec.sites.hook.pos)), rot }
    const grips: [ImplementSpec, ImplementSpec] = [bandGrip({ id: BAND_GRIPS.l }), bandGrip({ id: BAND_GRIPS.r })]
    const strip = band({ path: [{ implement: anchorSpec.id, site: 'hook' }, ...grips.flatMap((g) => [{ implement: g.id, site: 'a' }, { implement: g.id, site: 'b' }])], closed: true, size: 'medium' })
    ctx.band = { anchor, hook, grips }
    ctx.setup = { implements: [anchorSpec, ...grips, strip], contacts, tempo, symmetric: false, cables: [{ ...cable, pulley: hook, implement: BAND_GRIPS.l }], tolerances: { floor: FOOT_SINK } }
    return ctx
  }
  ctx.setup = { implements: [handle, stackSpec(pulley, [-s, 0, 0])], contacts, tempo, symmetric: false, cables: [cable], tolerances: { floor: FOOT_SINK } }
  return ctx
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  if (ctx.kind === 'twist') return sampleTwist(skel, ctx, c)
  if (ctx.kind === 'landmine') return sampleLandmine(skel, ctx, c)
  const { q, pose } = solveFrame(skel, ctx, c, ctx.reach(c))
  if (ctx.kneel) return { q, implements: [...ropePoses(skel, fk(skel, q), ctx.pulley, ROPE_FREE, ROPE_EXIT), { id: 'stack', pos: [0, 0, 0], rot: qid() }, ctx.kneel.mat], contacts: ctx.setup.contacts }
  if (!ctx.band) return { q, implements: [pose, { id: 'stack', pos: [0, 0, 0], rot: qid() }], contacts: ctx.setup.contacts }
  // the band grips sit on the handle's grips, their +Y towards the anchor
  const grips = (['l', 'r'] as const).map((side, i) => {
    const g = siteWorld(ctx.handle, pose, side)
    return poseHandle(ctx.band!.grips[i], 'c', g.pos, g.axis!, ctx.band!.hook)
  })
  return { q, implements: [ctx.band.anchor, ...grips, bandPose()], contacts: ctx.setup.contacts }
}

export const rotation: Template<P> = {
  id: 'rotation',
  driver: 'implement',
  params: SCHEMAS.rotation,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}

