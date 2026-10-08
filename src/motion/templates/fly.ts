import { plantFoot, solveLegs, type FootTarget } from '../constraints.ts'
import { bodyCapsules, type Capsule } from '../collide.ts'
import { fk, segPos } from '../fk.ts'
import { pressBench } from '../implements/press-horizontal.ts'
import { flatBench } from '../implements/shared.ts'
import { dls } from '../ik.ts'
import { add, cross, norm, qid, scale, sub, type V3 } from '../math.ts'
import { setDofs, zeroQ, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { dumbbellContacts, dumbbellPoses, handDumbbells } from './arms.ts'
import { crossoverBody, crossoverContext, handlePoses, stillSplit, type CrossoverCtx } from './crossover.ts'
import { armDir, footContacts, mirrorArm, other, poseArm, relaxedArm, thoraxFrame, type Side } from './isolation.ts'
import { pecDeckContext, samplePecDeck, type PecDeckCtx } from './pec-deck.ts'
import { plantFeet, restHead, seatOnPads, solidOf, trunkPose, type Posture } from './press-body.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { setPelvis } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Fly: horizontal adduction with the elbows soft and fixed (research "fly: horizontal adduction ~-25 -> ~+90, elbow
// fixed 15-25"). The humerus sweeps from an open to a closed direction (thorax frame: plane of elevation and
// elevation, both linear in the contraction); the forearm bends towards the direction of travel (hugging a barrel)
// and the palm faces it. Dumbbells: lying on a flat bench, open ~20 deg past the frontal plane, closed with
// the arms over the chest. Cable crossover: split stance between the towers, high-to-low ends with the hands
// together in front of the hips, low-to-high starts just behind the hips and ends at chin height. Pec deck: seated,
// back on the pad, handles on arcs round the shoulders (pec-deck.ts). Incline dumbbells: butt on the seat and upper
// back on the inclined pad of the press bench (press-body.ts placement), the same thorax-relative arc as the flat
// bench, so the dumbbells close over the upper chest.

type P = ParamsOf<'fly'>

type Dir = { plane: number; elev: number }
/** `tilt`: the bend leans off the arc towards the head side of its plane, so the forearm sits ~30 deg short of full
 * supination and the elbows point back towards the hips. `fwd`: the forearm also bends towards the chest's front, which
 * keeps the humerus off its internal-rotation limit with the hands low in front */
type Arc = { open: Dir; closed: Dir; prot: [number, number]; shrug: number; tilt: number; fwd?: number }

const ARCS: Record<'bench' | 'high' | 'mid' | 'low' | 'single', Arc> = {
  // lying: open with the upper arms a little below the bench top, elbows towards the hips; closed over the chest
  bench: { open: { plane: -20, elev: 70 }, closed: { plane: 94, elev: 72 }, prot: [-12, -8], shrug: 0, tilt: 0.6 },
  // high pulleys: open a little above the shoulders, closed with the hands together in front of the hips
  high: { open: { plane: -10, elev: 104 }, closed: { plane: 100, elev: 40 }, prot: [-8, 4], shrug: 0.3, tilt: 0.6, fwd: 1.2 },
  // shoulder-height pulleys: open with the hands in line with the shoulders, closed together in front of the sternum
  mid: { open: { plane: -12, elev: 86 }, closed: { plane: 92, elev: 82 }, prot: [-10, 4], shrug: 0.3, tilt: 0.6 },
  // one arm at shoulder height: as mid, the hand sweeping on to the midline of the chest
  single: { open: { plane: -12, elev: 86 }, closed: { plane: 102, elev: 82 }, prot: [-10, 6], shrug: 0.3, tilt: 0.6 },
  // low pulleys: open just behind the hips, closed at chin height
  low: { open: { plane: -22, elev: 30 }, closed: { plane: 100, elev: 95 }, prot: [-6, 3], shrug: 0.5, tilt: 0.6 },
}

const DB_KG = 10
const CABLE_KG = 4
/** flat bench top height; butt and upper back sink this far into the pad, the head rests on it, m */
const BENCH_H = 0.44
const SINK = 0.01
const HEAD_SINK = 0.004
/** hip joints this far behind the seat's front edge, m */
const SEAT_FRONT = 0.12
/** lying: lumbar arch and feet planted either side of the bench */
const ARCH = { lumbar: -6, thorax: -2 }
const FEET = { x: 0.3, z: 0.42, toeOut: 10 }
/** crossover: half the span between the pulleys and how far ahead of the midfoot line they sit, m; the towers face
 * forward, either side of the lifter. Low pulleys sit behind the lifter (it steps forward), so at the stretch, hands
 * just behind the hips, the cable runs along the arm instead of pulling the hands forward */
const TOWER = { x: 1.12, z: { high: 0.2, mid: 0.05, low: -0.35 } }
const PULLEY_Y = { high: 2.0, mid: 1.45, low: 0.15 }
/** split stance: step length (m), front knee, pelvis tilt (deg); the high pulleys pull up and back, so the lifter leans
 * into them */
const SPLIT = { high: { step: 0.4, frontKnee: 32, tilt: 18 }, mid: { step: 0.4, frontKnee: 40, tilt: 10 }, low: { step: 0.4, frontKnee: 36, tilt: 4 } }
const SPLIT_TRUNK = {
  high: { 'lumbar.flex': 3, 'thorax.flex': 5, 'neck.flex': -8, 'head.flex': -4 },
  mid: { 'lumbar.flex': 2, 'thorax.flex': 3, 'neck.flex': -6, 'head.flex': -3 },
  low: { 'lumbar.flex': 0, 'thorax.flex': 0, 'neck.flex': -4, 'head.flex': -2 },
}

type Ctx =
  | { kind: 'bench'; tempo: Tempo; setup: Setup; arc: Arc; hip: V3; tilt: number; neck: number; feet: FootTarget[]; benchPose: ImplementPose }
  | { kind: 'incline'; tempo: Tempo; setup: Setup; arc: Arc; base: Float64Array; benchPose: ImplementPose }
  | { kind: 'seated'; tempo: Tempo; setup: Setup; arc: Arc; base: Float64Array; benchPose: ImplementPose; x: CrossoverCtx }
  | { kind: 'cable'; tempo: Tempo; setup: Setup; arc: Arc; x: CrossoverCtx; work?: Side }
  | { kind: 'machine'; tempo: Tempo; setup: Setup; x: PecDeckCtx }

// ---------- arms ----------

/** humerus plane and elevation at c: straight from open to closed (constant elevation is plain horizontal adduction) */
const dirAt = (arc: Arc, c: number): Dir => ({ plane: arc.open.plane + (arc.closed.plane - arc.open.plane) * c, elev: arc.open.elev + (arc.closed.elev - arc.open.elev) * c })

/** both arms at contraction c (0 open, 1 closed): the forearm bends and the palm faces the way the hand travels */
export function flyArms(skel: Skeleton, q: Float64Array, arc: Arc, c: number, elbow: number) {
  const fr = thoraxFrame(skel, q)
  const d = dirAt(arc, c)
  const at = (x: number) => {
    const e = dirAt(arc, Math.max(0, Math.min(1, x)))
    return armDir(e.plane, e.elev, fr)
  }
  const ahead = norm(sub(at(c + 0.02), at(c - 0.02)))
  const lean = sub(ahead, scale(norm(cross(armDir(d.plane, d.elev, fr), ahead)), arc.tilt))
  const bend = norm(arc.fwd ? add(lean, scale(fr.fwd, arc.fwd)) : lean)
  poseArm(skel, q, 'l', { ...d, elbow, bend, palm: ahead, shrug: arc.shrug, girdle: { prot: arc.prot[0] + (arc.prot[1] - arc.prot[0]) * c } })
  mirrorArm(skel, q)
}

// ---------- lying on a flat bench ----------

const BUTT = /^trunk0[12]$/
const UPPER_BACK = /^trunk1[1-4]$/

function lying(skel: Skeleton, q: Float64Array, hip: V3, tilt: number, neck: number, feet?: FootTarget[]) {
  setDofs(skel, q, { 'lumbar.flex': ARCH.lumbar, 'thorax.flex': ARCH.thorax, 'neck.flex': neck, 'head.flex': 0 })
  // supine, head towards -Z: the spine lies along -Z, the chest faces up
  setPelvis(skel, q, hip, tilt - 90)
  if (feet) solveLegs(skel, q, feet)
}

const lowest = (caps: Capsule[]) => Math.min(...caps.map((c) => Math.min(c.a[1], c.b[1]) - c.r))

function benchContext(skel: Skeleton, tempo: Tempo): Ctx {
  const spec = flatBench({ seatHeight: BENCH_H })
  const benchPose: ImplementPose = { id: spec.id, pos: [0, BENCH_H, 0], rot: qid() }
  const seat = spec.parts[0] as Extract<(typeof spec.parts)[number], { shape: 'box' }>
  const z = benchPose.pos[2] + seat.center[2] + seat.size[2] / 2 - SEAT_FRONT
  const target = BENCH_H - SINK
  // hip height and pelvis tilt that rest both the butt and the upper back on the pad, then the neck that rests the head
  const caps = (x: number[], neck = 0) => {
    const q = zeroQ(skel)
    lying(skel, q, [0, x[0], z], x[1], neck)
    return bodyCapsules(skel, fk(skel, q))
  }
  const r = dls((x) => {
    const c = caps(x)
    return [(lowest(c.filter((k) => BUTT.test(k.name))) - target) * 100, (lowest(c.filter((k) => UPPER_BACK.test(k.name))) - target) * 100]
  }, [BENCH_H + 0.1, 4], { tol: 1e-8, iters: 60 })
  const [y, tilt] = r.x
  const n = dls((x) => [(lowest(caps([y, tilt], x[0]).filter((k) => k.region === 'head')) - (BENCH_H - HEAD_SINK)) * 100], [0], { tol: 1e-8, iters: 40 })
  const hip: V3 = [0, y, z]
  const feet = [plantFoot(skel, 'l', [FEET.x, 0, z + FEET.z], FEET.toeOut), plantFoot(skel, 'r', [-FEET.x, 0, z + FEET.z], FEET.toeOut)]
  const setup: Setup = {
    implements: [...handDumbbells(DB_KG), spec],
    contacts: [...footContacts(skel, feet), ...dumbbellContacts()],
    tempo,
    symmetric: true,
  }
  return { kind: 'bench', tempo, setup, arc: ARCS.bench, hip, tilt, neck: n.x[0], feet, benchPose }
}

// ---------- incline bench ----------

/** incline: press bench seat height (m), a light arch and the knee flexion of the planted feet */
const INCLINE = { seatHeight: 0.44, pelvis: 4, lumbar: -6, thorax: -2, knee: 80, feetHalf: 0.3 }

/** butt on the press bench's seat and upper back on its pad at `a` deg, head resting, feet planted */
function onBench(skel: Skeleton, a: number) {
  const bench = pressBench({ backAngle: a, seatHeight: INCLINE.seatHeight })
  const benchPose: ImplementPose = { id: bench.id, pos: [0, INCLINE.seatHeight, 0], rot: qid() }
  const s: Posture = { tilt: -(90 - a) + INCLINE.pelvis, lumbar: INCLINE.lumbar, thorax: INCLINE.thorax, clavicle: { prot: 0, elev: 0 } }
  const hip = seatOnPads(skel, s, solidOf(bench, benchPose, 0), solidOf(bench, benchPose, 1), [benchPose.pos[1] + 0.09, benchPose.pos[2] + 0.1], SINK)
  const base = zeroQ(skel)
  trunkPose(skel, base, hip, s)
  restHead(skel, base, solidOf(bench, benchPose, 1))
  const legs = plantFeet(skel, base, hip, INCLINE.knee, INCLINE.feetHalf)
  return { bench, benchPose, base, contacts: legs.contacts }
}

function inclineContext(skel: Skeleton, tempo: Tempo, a: number): Ctx {
  const { bench, benchPose, base, contacts } = onBench(skel, a)
  const setup: Setup = { implements: [...handDumbbells(DB_KG), bench], contacts: [...contacts, ...dumbbellContacts()], tempo, symmetric: true }
  return { kind: 'incline', tempo, setup, arc: ARCS.bench, base, benchPose }
}

// ---------- seated between the towers ----------

/** seated cable fly: the pulleys at shoulder height, this far ahead of the shoulders (m) */
const SEATED_TOWER_Z = 0.05

function seatedCableContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const { bench, benchPose, base, contacts } = onBench(skel, p.benchAngle)
  const f = fk(skel, base)
  const sh = scale(add(segPos(skel, f, 'humerus_l'), segPos(skel, f, 'humerus_r')), 0.5)
  const y = sh[1], z = sh[2] + SEATED_TOWER_Z
  // the crossover rig gives the handles, cables and towers; the body sits, so its stance and balance are not used
  const x = crossoverContext(skel, {
    tempo,
    pulleys: { l: [TOWER.x, y, z], r: [-TOWER.x, y, z] },
    crossed: false,
    kg: CABLE_KG,
    stance: { kind: 'hip', knee: 0, tilt: 0 },
    trunk: {},
    facing: [0, 0, 1],
  })
  const grips = x.setup.contacts.filter((c) => c.kind === 'grip')
  const setup: Setup = { implements: [...x.setup.implements, bench], contacts: [...contacts, ...grips], tempo, symmetric: true, cables: x.setup.cables }
  return { kind: 'seated', tempo, setup, arc: ARCS.mid, base, benchPose, x }
}

// ---------- cable crossover ----------

function cableContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const h = p.cableHeight
  const y = PULLEY_Y[p.cableHeight]
  const split = SPLIT[h]
  const x = crossoverContext(skel, {
    tempo,
    pulleys: { l: [TOWER.x, y, TOWER.z[h]], r: [-TOWER.x, y, TOWER.z[h]] },
    crossed: false,
    kg: CABLE_KG,
    stance: { kind: 'split', front: 'l', step: split.step, frontKnee: split.frontKnee, tilt: split.tilt },
    trunk: SPLIT_TRUNK[h],
    facing: [0, 0, 1],
  })
  const arc = ARCS[h]
  x.sway = stillSplit(skel, x, () => zeroQ(skel), (u) => (q) => flyArms(skel, q, arc, phaseAt(u, tempo).c, p.elbowAngle))
  return { kind: 'cable', tempo, setup: x.setup, arc, x }
}

// ---------- single arm ----------

/**
 * One handle on the working side's tower at shoulder height, the free arm relaxed at the side, the same split stance
 * and arc as the two-arm mid fly. The crossover rig is reused with a weightless stand-in on the free side (no load,
 * no cable pull), so the balance counts the one cable; only the working tower is drawn (it alone has a cable).
 */
function singleContext(p: P, skel: Skeleton, tempo: Tempo): Ctx {
  const work: Side = p.side === 'left' ? 'l' : 'r'
  const y = PULLEY_Y.mid, z = TOWER.z.mid
  const split = SPLIT.mid
  const x = crossoverContext(skel, {
    tempo,
    pulleys: { l: [TOWER.x, y, z], r: [-TOWER.x, y, z] },
    crossed: false,
    kg: CABLE_KG,
    // the free side's foot leads, so the working arm sweeps across in front of the trunk
    stance: { kind: 'split', front: other(work), step: split.step, frontKnee: split.frontKnee, tilt: split.tilt },
    trunk: SPLIT_TRUNK.mid,
    facing: [0, 0, 1],
  })
  const free = other(work)
  x.handles[free] = { ...x.handles[free], mass: 0 }
  x.cables[free] = { ...x.cables[free], kg: 0 }
  const handle = x.handles[work]
  x.setup = {
    ...x.setup,
    implements: [handle, x.crossover],
    contacts: x.setup.contacts.filter((c) => c.kind !== 'grip' || c.site === `grip_${work}`),
    symmetric: false,
    cables: [x.cables[work]],
  }
  const arc = ARCS.single
  x.sway = stillSplit(skel, x, () => zeroQ(skel), (u) => (q) => singleArms(skel, q, arc, phaseAt(u, tempo).c, p.elbowAngle, work))
  return { kind: 'cable', tempo, setup: x.setup, arc, x, work }
}

function singleArms(skel: Skeleton, q: Float64Array, arc: Arc, c: number, elbow: number, work: Side) {
  flyArms(skel, q, arc, c, elbow)
  const s = other(work)
  for (const k of ['clavicle_*.elev', 'clavicle_*.prot', 'shoulder_*.rot', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']) q[skel.dof[k.replace('*', s)]] = 0
  relaxedArm(skel, q, s)
}

// ---------- template ----------

const context = memo((p: P, skel: Skeleton): Ctx => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.laterality === 'unilateral' && p.implement === 'cable' && p.posture === 'standing' && p.stance === 'split' && p.cableHeight === 'mid') return singleContext(p, skel, tempo)
  if (p.laterality !== 'bilateral') throw new Error(`fly: variant not implemented yet (${p.laterality})`)
  if (p.implement === 'dumbbell' && p.posture === 'lying_supine' && p.benchAngle === 0) return benchContext(skel, tempo)
  if (p.implement === 'dumbbell' && p.posture === 'lying_supine' && p.benchAngle >= 15 && p.benchAngle <= 45) return inclineContext(skel, tempo, p.benchAngle)
  if (p.implement === 'cable' && p.posture === 'standing' && p.stance === 'split') return cableContext(p, skel, tempo)
  if (p.implement === 'cable' && p.posture === 'seated' && p.cableHeight === 'mid' && p.benchAngle >= 60) return seatedCableContext(p, skel, tempo)
  if (p.implement === 'machine' && p.posture === 'seated') {
    const x = pecDeckContext(skel, 'fly', { elbow: p.elbowAngle, tempo, symmetric: true })
    return { kind: 'machine', tempo, setup: x.setup, x }
  }
  throw new Error(`fly: variant not implemented yet (${p.implement}/${p.posture}${p.implement === 'cable' ? `/${p.cableHeight}/${p.stance}` : ''})`)
})

function sample(u: number, p: P, skel: Skeleton): Pose {
  const ctx = context(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  if (ctx.kind === 'machine') {
    const r = samplePecDeck(skel, ctx.x, c)
    return { q: r.q, implements: r.implements, contacts: ctx.setup.contacts }
  }
  if (ctx.kind === 'incline' || ctx.kind === 'seated') {
    const q = Float64Array.from(ctx.base)
    flyArms(skel, q, ctx.arc, c, p.elbowAngle)
    const held = ctx.kind === 'seated' ? [...handlePoses(skel, ctx.x, q), { id: ctx.x.crossover.id, pos: [0, 0, 0] as V3, rot: qid() }] : dumbbellPoses(skel, q)
    return { q, implements: [...held, ctx.benchPose], contacts: ctx.setup.contacts }
  }
  const q = zeroQ(skel)
  if (ctx.kind === 'bench') {
    lying(skel, q, ctx.hip, ctx.tilt, ctx.neck, ctx.feet)
    flyArms(skel, q, ctx.arc, c, p.elbowAngle)
    return { q, implements: [...dumbbellPoses(skel, q), ctx.benchPose], contacts: ctx.setup.contacts }
  }
  const work = ctx.work
  crossoverBody(skel, ctx.x, q, (qq) => (work ? singleArms(skel, qq, ctx.arc, c, p.elbowAngle, work) : flyArms(skel, qq, ctx.arc, c, p.elbowAngle)), ctx.x.sway)
  const handles = handlePoses(skel, ctx.x, q).filter((h) => !work || h.id === ctx.x.handles[work].id)
  return { q, implements: [...handles, { id: ctx.x.crossover.id, pos: [0, 0, 0], rot: qid() }], contacts: ctx.setup.contacts }
}

export const fly: Template<P> = {
  id: 'fly',
  driver: 'joint',
  params: SCHEMAS.fly,
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample,
}
