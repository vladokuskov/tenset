import { centerOfPressure, fk, segPos } from '../fk.ts'
import { bodyCapsules, type Capsule } from '../collide.ts'
import { cableForce, cableHandle, comWorld, dumbbell, type ImplementSpec, type Part } from '../implements.ts'
import { dls } from '../ik.ts'
import { towelRoll } from '../implements/chest-shoulder-isolation.ts'
import { band, bandAnchor, bandHandle, bandPose, poseHandle } from '../implements/index.ts'
import { flatBench } from '../implements/shared.ts'
import { add, cross, DEG, dot, eulerFrom, lerp, norm, qaxis, qconj, qfromBasis, qid, qmul, qrot, RAD, reject, scale, sub, type Quat, type V3 } from '../math.ts'
import { setDofs, shoulderRhythm, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { handFrame, implementFromHand } from '../constraints.ts'
import { handleInHand, other, poseArm, relaxedArm, type Side } from './isolation.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { ARM_BALANCE_TOL, limitSway, makeStance, plantedContacts, setPelvis, stanceWidth, standBalanced, type StanceSetup, type Sway } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// External rotation with the upper arm pinned at the side (a folded-towel gap, ~12 deg out) and the elbow at 90:
// humeral axial rotation only, from the forearm across the stomach to rotated out, the trunk still (no research
// table for this template: author judgment, ~90 deg arc inside the active range). Cable: standing side-on to a
// stack on the far side at elbow height, the cable pulling the hand in. Side-lying: on the flat bench on the other
// side, head on the folded bottom arm, legs stacked; the top arm lifts the dumbbell from in front of the stomach towards the
// ceiling and stops before the torso would roll back. Band (232): the cable setup with a band from a post anchor at
// elbow height on the far side to a soft handle; its pull joins the balance as the cable's does.

type P = ParamsOf<'external-rotation'>

const DB_KG = 3
const CABLE_KG = 4
/** upper arm out from the side (towel), plane, elbow, deg */
const ARM = { elev: 12, plane: 20, elbow: 90 }
/** humeral rotation at the start (internal, forearm across the stomach) and the end (external), deg */
const ROT: Record<'standing' | 'side_lying', [number, number]> = { standing: [38, -52], side_lying: [52, -58] }
/** side-lying: bench top height, m */
const BENCH_H = 0.44

type Ctx = {
  kind: 'cable' | 'side'
  tempo: Tempo
  setup: Setup
  work: Side
  stance?: StanceSetup
  pulley?: V3
  handle?: ImplementSpec
  sway?: Sway
  hip?: V3
  prop?: number
  benchPose?: ImplementPose
  towel: TowelFit
}

function workingArm(skel: Skeleton, q: Float64Array, s: Side, c: number, rot: [number, number]) {
  const g = shoulderRhythm(ARM.elev, ARM.plane)
  setDofs(skel, q, {
    [`shoulder_${s}.plane`]: ARM.plane,
    [`shoulder_${s}.elev`]: ARM.elev,
    [`shoulder_${s}.rot`]: lerp(rot[0], rot[1], c),
    [`elbow_${s}.flex`]: ARM.elbow,
    [`forearm_${s}.pro`]: 0,
    [`wrist_${s}.flex`]: 0,
    [`clavicle_${s}.prot`]: -3,
    [`clavicle_${s}.elev`]: 0,
    [`scapula_${s}.uprot`]: g.uprot,
    [`grip_${s}.close`]: 1,
  })
}

// ---------- towel ----------

/** the rolled towel sinks at least this far into the arm and the ribs, m (the arm turning about its axis adds up to ~9 mm; the pad allowance is 15) */
const TOWEL_SQUASH = 0.003
/** how far down the humerus the towel sits (shoulder 0, elbow 1): just above the elbow */
const TOWEL_AT = 0.85

type TowelFit = { r: number; pos: V3; rot: Quat }

/** closest point to p on the segment a-b */
function onSegment(p: V3, a: V3, b: V3): V3 {
  const ab = sub(b, a)
  const len2 = dot(ab, ab)
  const t = len2 > 1e-12 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2)) : 0
  return add(a, scale(ab, t))
}

/**
 * The towel between the working upper arm and the ribs (the cue's folded towel): radius that fills the gap and its
 * pose in the thorax2 frame. The humerus stays pinned to the trunk through the rep while it turns about its own
 * axis, so the towel rides with the thorax, not the arm.
 */
function towelFit(skel: Skeleton, q: Float64Array, work: Side): TowelFit {
  const f = fk(skel, q)
  const sh = segPos(skel, f, `humerus_${work}`), el = segPos(skel, f, `forearm_${work}`)
  const at = add(sh, scale(sub(el, sh), TOWEL_AT))
  const caps = bodyCapsules(skel, f)
  const clear = (p: V3, keep: (c: Capsule) => boolean) => Math.min(...caps.filter(keep).map((c) => Math.hypot(...sub(p, onSegment(p, c.a, c.b))) - c.r))
  const isArm = (c: Capsule) => c.region === `upperarm_${work}`, isTrunk = (c: Capsule) => c.region === 'trunk'
  // from the point on the humerus towards the nearest trunk axis, the spot as far from the arm as from the ribs
  const trunkAxis = caps.filter(isTrunk).map((c) => onSegment(at, c.a, c.b)).sort((x, y) => Math.hypot(...sub(x, at)) - Math.hypot(...sub(y, at)))[0]
  const n = norm(sub(trunkAxis, at))
  const L = Math.hypot(...sub(trunkAxis, at))
  let lo = 0, hi = L
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2
    const c = add(at, scale(n, m))
    if (clear(c, isArm) < clear(c, isTrunk)) lo = m
    else hi = m
  }
  const center = add(at, scale(n, lo))
  const r = clear(center, isArm) + TOWEL_SQUASH
  // rolled along the fore-aft axis of the chest
  const th = f.rot[skel.seg.thorax2]
  const axis = norm(reject(qrot(th, [0, 0, 1]), n))
  const rot = qfromBasis(n, cross(axis, n))
  const inv = qconj(th)
  return { r, pos: qrot(inv, sub(center, f.pos[skel.seg.thorax2])), rot: qmul(inv, rot) }
}

function towelPose(skel: Skeleton, q: Float64Array, fit: TowelFit): ImplementPose {
  const f = fk(skel, q)
  const th = f.rot[skel.seg.thorax2]
  return { id: 'towel', pos: add(f.pos[skel.seg.thorax2], qrot(th, fit.pos)), rot: qmul(th, fit.rot) }
}

// ---------- standing cable ----------

function trunkPose(skel: Skeleton, q: Float64Array) {
  setDofs(skel, q, { 'lumbar.flex': 1, 'thorax.flex': 2, 'neck.flex': -4, 'head.flex': -2 })
}

/** cable handle in the hand, or the band handle with its ring towards the anchor */
function handPose(skel: Skeleton, q: Float64Array, ctx: Ctx): ImplementPose {
  if (ctx.handle!.kind !== 'band_handle') return handleInHand(skel, q, ctx.work, ctx.pulley!, ctx.handle!)
  const h = handFrame(skel, fk(skel, q), ctx.work)
  return poseHandle(ctx.handle!, 'c', h.pos, h.axis, ctx.pulley!)
}

/** the band anchor's post stands on the far side, its face turned to the lifter, the hook on the pulley point */
function stackPose(ctx: Ctx): ImplementPose {
  if (ctx.handle!.kind !== 'band_handle') return { id: 'stack', pos: [0, 0, 0], rot: qid() }
  const away = ctx.pulley![0] > 0 ? 1 : -1
  const rot = qaxis([0, 1, 0], (-away * 90) * DEG)
  const hook = ctx.setup.implements.find((s) => s.id === 'stack')!.sites.hook.pos
  return { id: 'stack', pos: sub(ctx.pulley!, qrot(rot, hook)), rot }
}

function cableMeasure(skel: Skeleton, ctx: Ctx) {
  const cable = ctx.setup.cables![0]
  return (q: Float64Array) => {
    const hp = handPose(skel, q, ctx)
    const { at, force } = cableForce(cable, hp)
    return centerOfPressure(skel, fk(skel, q), [{ mass: ctx.handle!.mass, pos: comWorld(ctx.handle!, hp) }], [{ at, force }])[1]
  }
}

function standing(u: number, skel: Skeleton, ctx: Ctx, q: Float64Array, sway?: Sway) {
  trunkPose(skel, q)
  const c = phaseAt(u, ctx.tempo).c
  const upper = (qq: Float64Array) => {
    workingArm(skel, qq, ctx.work, c, ROT.standing)
    relaxedArm(skel, qq, other(ctx.work))
  }
  return standBalanced(skel, q, ctx.stance!, { knee: 6, tilt: 3 }, cableMeasure(skel, ctx), upper, undefined, sway)
}

function cableContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const work: Side = p.side === 'left' ? 'l' : 'r'
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  // pulley on the far side at elbow height, level with the hand at mid-rep, so the cable runs across the body
  const q = zeroQ(skel)
  trunkPose(skel, q)
  standBalanced(skel, q, stance, { knee: 6, tilt: 3 }, (qq) => fk(skel, qq).pos[0][2], (qq) => workingArm(skel, qq, work, 0.5, ROT.standing))
  const hand = handFrame(skel, fk(skel, q), work).pos
  const away = work === 'r' ? 1 : -1
  const pulley: V3 = [away * 0.8, p.cableHeight === 'mid' ? hand[1] + 0.02 : p.cableHeight === 'high' ? 1.8 : 0.1, hand[2]]
  const isBand = p.implement === 'band'
  const handle = isBand ? bandHandle({ id: 'handle' }) : cableHandle({ id: 'handle', attachment: 'single_handle' })
  const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })
  const col: V3 = [pulley[0] + away * 0.12, 0, pulley[2]]
  const stack: ImplementSpec = isBand ? { ...bandAnchor({ id: 'stack', height: pulley[1], mount: 'post' }) } : {
    id: 'stack',
    kind: 'bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [cyl(col, [col[0], 2.1, col[2]], 0.05), cyl(pulley, [col[0], pulley[1], col[2]], 0.04)],
    sites: {},
  }
  const contacts: Contact[] = [...plantedContacts(skel, stance), { site: `grip_${work}`, kind: 'grip', target: { implement: 'handle', grip: 'c' } }]
  const setup: Setup = {
    implements: [handle, stack],
    contacts,
    tempo,
    symmetric: false,
    balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL },
    cables: [{ pulley, implement: 'handle', point: [0, 0, 0], kg: CABLE_KG }],
  }
  if (isBand) setup.implements.push(band({ path: [{ implement: 'stack', site: 'hook' }, { implement: 'handle', site: 'ring' }], size: 'light' }))
  const towel = towelFit(skel, q, work)
  setup.implements.push(towelRoll({ r: towel.r }))
  const ctx: Ctx = { kind: 'cable', tempo, setup, work, stance, pulley, handle, towel }
  ctx.sway = limitSway((uu, sway) => standing(uu, skel, ctx, zeroQ(skel), sway))
  return ctx
}

// ---------- side-lying on a flat bench ----------

/**
 * side-lying legs curled and stacked (the clamshell start: knees and feet together), the usual way to lie on a bench
 * shorter than the lifter: hips and knees bent so the shins come back over the seat instead of sticking out past its
 * end; `lift` raises both towards the ceiling, the top leg adducted `topAbd` and turned out `topRot` so its knee and
 * foot come down onto the bottom leg's (the thighs then press within the default soft-tissue tolerance); the neck's
 * side bend onto the pillow arm
 */
const SIDE = { hip: 38, knee: 120, lift: 16, topAbd: -1, topRot: -21, topAnkle: 0, ankle: -12, neckBend: 22 }
/** the bottom arm overhead along the pad, the forearm folded back up behind and under the head as a pillow (the
 * elbow bends towards the back and the ceiling: the humeral rotation this needs stays inside the rig's range) */
const PILLOW = { plane: 95, elev: 170, elbow: 135 }
/** the bottom shoulder and hip sink this far into the pad, m */
const SIDE_SINK = 0.012
/** hip joints this far towards the feet end from the pad joint, so the curled shins lie over the seat */
const Z_SHIFT = -0.04

/**
 * lying on the non-working side along the bench, head towards -Z: the lifter faces +X (working right arm up) or -X,
 * legs stacked, the head on the folded bottom arm. `prop` (deg) raises the head end so the body rests on both the
 * bottom shoulder and the hip.
 */
function sideBody(skel: Skeleton, q: Float64Array, work: Side, hip: V3, prop: number) {
  const down = other(work)
  const toRight = work === 'r'
  setDofs(skel, q, {
    'lumbar.flex': 4,
    'thorax.flex': 4,
    'neck.flex': 4,
    'neck.bend': toRight ? SIDE.neckBend : -SIDE.neckBend,
    'head.flex': 2,
    'hip_*.flex': SIDE.hip,
    'knee_*.flex': SIDE.knee,
    [`ankle_${down}.df`]: SIDE.ankle,
    [`ankle_${work}.df`]: SIDE.topAnkle,
    [`hip_${down}.abd`]: -SIDE.lift,
    [`hip_${work}.abd`]: SIDE.lift + SIDE.topAbd,
    [`hip_${work}.rot`]: SIDE.topRot,
  })
  // body axes in the world: the spine along -Z, the down side's lateral axis pointing at the floor, facing +/-X
  const lat: V3 = toRight ? [0, -1, 0] : [0, 1, 0]
  const r0 = qmul(qaxis([1, 0, 0], prop * DEG), qfromBasis(lat, [0, 0, -1]))
  const [yaw, tilt, list] = eulerFrom(r0, 1, 0, 2).map((a) => a * RAD)
  setPelvis(skel, q, hip, tilt, yaw, list)
  poseArm(skel, q, down, { ...PILLOW, bend: [toRight ? -0.6 : 0.6, 0.8, 0], palm: [0, 1, 0], close: 0.3 })
}

const lowest = (caps: Capsule[]) => Math.min(...caps.map((c) => Math.min(c.a[1], c.b[1]) - c.r))

function sideContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const work: Side = p.side === 'left' ? 'l' : 'r'
  const down = other(work)
  // the knees at the seat end, the body over the middle of the pad
  const x = 0, z = Z_SHIFT
  const target = BENCH_H - SIDE_SINK
  // hip height and head-end prop that rest the bottom shoulder and the bottom hip on the pad (the shins past its end
  // and the pillow forearm under the head carry no weight)
  const r = dls((v) => {
    const q = zeroQ(skel)
    sideBody(skel, q, work, [x, v[0], z], v[1])
    const caps = bodyCapsules(skel, fk(skel, q))
    const shoulder = caps.filter((c) => [`girdle_${down}`, `upperarm_${down}`].includes(c.region) || c.segment === 'thorax2')
    const hips = caps.filter((c) => c.segment === 'pelvis' || c.name === `thigh_${down}1`)
    return [(lowest(shoulder) - target) * 100, (lowest(hips) - target) * 100]
  }, [BENCH_H + 0.2, 0], { tol: 1e-8, iters: 60 })
  const [y, prop] = r.x
  const benchPose: ImplementPose = { id: 'bench', pos: [0, BENCH_H, 0], rot: qid() }
  const db = dumbbell({ id: `db_${work}`, mass: DB_KG })
  const bench = flatBench({ seatHeight: BENCH_H })
  const setup: Setup = {
    implements: [db, bench],
    contacts: [{ site: `grip_${work}`, kind: 'grip', target: { implement: db.id, grip: 'c' } }],
    tempo,
    symmetric: false,
  }
  const qt = zeroQ(skel)
  sideBody(skel, qt, work, [x, y, z], prop)
  workingArm(skel, qt, work, 0.5, ROT.side_lying)
  const towel = towelFit(skel, qt, work)
  setup.implements.push(towelRoll({ r: towel.r }))
  return { kind: 'side', tempo, setup, work, hip: [x, y, z], prop, benchPose, towel }
}

// ---------- template ----------

const context = memo((p: P, skel: Skeleton): Ctx => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.armPosition !== 'side') throw new Error(`external-rotation: variant not implemented yet (${p.armPosition})`)
  if ((p.implement === 'cable' || p.implement === 'band') && p.posture === 'standing') return cableContext(p, skel, tempo)
  if (p.implement === 'dumbbell' && p.posture === 'side_lying') return sideContext(p, skel, tempo)
  throw new Error(`external-rotation: variant not implemented yet (${p.implement}/${p.posture})`)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const q = zeroQ(skel)
  if (ctx.kind === 'cable') {
    standing(u, skel, ctx, q, ctx.sway)
    const hp = handPose(skel, q, ctx)
    const extra = p.implement === 'band' ? [bandPose()] : []
    return { q, implements: [hp, stackPose(ctx), towelPose(skel, q, ctx.towel), ...extra], contacts: ctx.setup.contacts }
  }
  sideBody(skel, q, ctx.work, ctx.hip!, ctx.prop ?? 0)
  workingArm(skel, q, ctx.work, phaseAt(u, ctx.tempo).c, ROT.side_lying)
  const h = handFrame(skel, fk(skel, q), ctx.work)
  return { q, implements: [{ id: `db_${ctx.work}`, pos: h.pos, rot: implementFromHand(h.axis, h.palm) }, ctx.benchPose!, towelPose(skel, q, ctx.towel)], contacts: ctx.setup.contacts }
}

export const externalRotation: Template<P> = {
  id: 'external-rotation',
  driver: 'joint',
  params: SCHEMAS['external-rotation'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
