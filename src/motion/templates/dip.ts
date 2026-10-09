import { attachHand, root1d, solveLegs, type FootTarget } from '../constraints.ts'
import { bodyCapsules, placeParts } from '../collide.ts'
import { centerOfMass, fk } from '../fk.ts'
import { crossBench, DRAWN_BENCH } from '../implements/arms.ts'
import { dipBars, DIP, palmRest } from '../implements/press-vertical-bodyweight.ts'
import { RING_HEIGHT } from '../implements/index.ts'
import { siteWorld, type ImplementSpec } from '../implements.ts'
import { DEG, lerp, norm, qaxis, qid, qrot, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../timing.ts'
import { armElevation, minClear, plantFeet } from './press-body.ts'
import { PALM_SINK, PALM_WRIST_LIMITS } from './push-up.ts'
import { ringContacts, ringPoses, ringRig, ringSpread, type RingRig } from './rings.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { monotoneCubic, secant } from './solve.ts'
import { setPelvis } from './standing.ts'
import { memo, type Setup, type Template } from './types.ts'

// Dip, root driver: the hands hold the parallel bars and the body moves. Trunk lean (torsoAngle, a little less at
// the top), hips and bent knees are keyed; each frame the arms are solved onto the bars and the body slides so its
// centre of mass stays over the hands. Body height follows a keyed elbow curve: ~8 deg at the top (not snapped into
// lockout) to ~92 deg at the bottom, where the upper arm is about level and the shoulder extended ~50-65 deg
// (motion-authoring research: shoulder extension ~45-60, elbow ~90 at the bottom; author judgment). Chest dips let
// the elbows drift out and lean forward; upright triceps dips keep the elbows straight back.
// Bench dip (support bench): the palms flat on the front edge of a flat bench across the lifter, beside the hips with
// the fingers forward, the feet planted in front with the knees bent; the hips slide down just clear of the bench while
// the elbows bend straight back from ~8 deg to ~90 deg (upper arms about level), the trunk upright.
// Ring dip (implement rings): the same dip on gymnastic rings held by the hips (RING_DIP.half, narrower than the bars),
// the rings turning out a little at the top (thumbs out, RING_DIP.turn) and each ring leaning on its forearm
// (rings.ts).

type P = ParamsOf<'dip'>

const TOP_ELBOW = 8
const BOTTOM_ELBOW = 98
/** lean at the top as a share of the lean at the bottom */
const TOP_LEAN = 0.75

type Ctx = { tempo: Tempo; setup: Setup; bars: ImplementSpec; pose: ImplementPose; height: (c: number) => number; rig?: RingRig }

/**
 * ring dip: the grips' half spread beside the hips, m (narrower and the straight arms press into the lats at the top);
 * how far the hands turn out (thumbs out) at the top, deg; clavicle elevation at the top, deg (the bars' depressed -6
 * draws the upper arms into the trunk with the hands this close)
 */
const RING_DIP = { half: 0.28, turn: 15, shrug: 0 }

/**
 * Bench dip: pad top height, m; the back's clearance off the bench, m; the hands' half spread (beside the hips), m,
 * and wrist extension bias, deg; elbow flexion at the top, deg;
 * shoulder extension at the bottom (upper arm behind the trunk), deg: 82, the upper arm about level with the elbow at
 * ~85-90 (the hands fixed on the pad behind the hips take the shoulder further than a free arm's ~50-60, as bench-dip
 * studies and the bar dips here go past 85 at the elbow); the horizontal-abduction gate's allowance for that pure
 * extension, deg; scapulae (clavicle elevation and protraction at the bottom and the top), deg; the feet half spread, m,
 * and toe-out, deg (more turns the knees out and rolls the planted feet onto their outer edges as the hips drop)
 */
const BENCH_DIP = { seat: 0.44, back: 0.05, half: 0.27, wrist: 60, elbow: 15, extension: 80, behind: 85, clavicle: { elev: [10, 0], prot: [4, -2] }, feetHalf: 0.12, toeOut: 6 }
/**
 * The hands grip the pad's front edge, palms down on it, fingers forward and curled over: the grip line (the centre of
 * the fist, little finger to index along -X for the left hand) runs just outside the edge, this far above and in
 * front of it, m; palm direction; wrist extension, deg (the push-up's flat-palm wrist range)
 */
const PAD_GRIP = 0.006
const BENCH_PALM: V3 = norm([0, -1, 0.15])
/** the edge crosses the palm a little flatter than a bar would (deg): keeps the wrist off its radial stop at the top */
const BENCH_OBLIQUE = 10
/** knots of the hips' path down the bench */
const SLIDE_KNOTS = 7
/** elbows straight back and a little out, towards the pole (world) */
const BENCH_POLE: V3 = norm([0.3, 0.1, -1])

type BenchCtx = { kind: 'bench'; tempo: Tempo; setup: Setup; bench: ImplementPose; palms: ImplementPose; feet: FootTarget[]; height: (c: number) => number; slide: (y: number) => number }

const MIRRORED = ['clavicle_*.elev', 'clavicle_*.prot', 'scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev']

function unsupported(p: P) {
  if (p.laterality !== 'bilateral') return `laterality ${p.laterality}`
  if (p.support === 'bench') return p.implement === 'bodyweight' ? null : `bench ${p.implement}`
  if (p.implement !== 'bodyweight' && p.implement !== 'rings') return `implement ${p.implement}`
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
    'clavicle_*.elev': lerp(8, p.implement === 'rings' ? RING_DIP.shrug : -6, c),
    'clavicle_*.prot': lerp(4 + 6 * chest, -2, c),
    'grip_*.close': 1,
  })
  q[skel.dof['pelvis.tilt']] = 0.7 * lean
}

/** hands on the bars: left solved, right mirrored */
function arms(skel: Skeleton, q: Float64Array, p: P, ctx: Pick<Ctx, 'bars' | 'pose'>, c: number) {
  const g = siteWorld(ctx.bars, ctx.pose, 'l')
  const out = lerp(0.1, 0.4, p.torsoAngle / 45)
  // rings: the hands turn out (index towards the side) as the arms straighten
  const axis = p.implement === 'rings' ? qrot(qaxis([0, 1, 0], RING_DIP.turn * c * c * DEG), g.axis!) : g.axis!
  attachHand(skel, q, 'l', { pos: g.pos, axis, palm: [-1, 0, 0] }, { pole: norm([out, lerp(0.1, 0.4, c), -1]), wristBias: lerp(30, 18, c), planeHint: 0 })
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

/** the ring dip's grips: no parts (the rings are their own implements), the hands' sites at the rings' height */
function ringGrips(): ImplementSpec {
  const x = RING_DIP.half, y = RING_HEIGHT.dip
  return { id: 'ring_grips', kind: 'floor_contact', mass: 0, com: [0, 0, 0], parts: [], sites: { l: { pos: [x, y, 0], axis: [0, 0, 1] }, r: { pos: [-x, y, 0], axis: [0, 0, 1] } } }
}

// ---------- bench dip ----------

/** the bench's back pad (centred on the lifter) as a world solid */
const padOf = (spec: ImplementSpec, pose: ImplementPose) => placeParts({ ...spec, parts: [spec.parts[1]] }, pose)[0]

type BenchRig = Pick<BenchCtx, 'bench' | 'palms' | 'feet'> & { spec: ImplementSpec; slide?: (y: number) => number }

/** trunk, head and scapulae for contraction c (1 = top), the trunk leaning torsoAngle forward */
function benchTrunk(skel: Skeleton, q: Float64Array, c: number) {
  const k = BENCH_DIP.clavicle
  setDofs(skel, q, {
    'lumbar.flex': 0,
    'thorax.flex': 2,
    'neck.flex': 2,
    'head.flex': 2,
    'clavicle_*.elev': lerp(k.elev[0], k.elev[1], c),
    'clavicle_*.prot': lerp(k.prot[0], k.prot[1], c),
    'grip_*.close': 1,
  })
}

/** hip z at hip height y that puts the back just off the bench (searching from in front of it back towards it) */
function backZ(skel: Skeleton, p: P, v: BenchRig, y: number): number {
  const q = zeroQ(skel)
  benchTrunk(skel, q, 0)
  const pad = padOf(v.spec, v.bench)
  const front = v.bench.pos[2] + DRAWN_BENCH.back.width / 2
  const trunk = (z: number) => {
    setPelvis(skel, q, [0, y, z], p.torsoAngle)
    return minClear(bodyCapsules(skel, fk(skel, q)).filter((cap) => cap.region === 'trunk'), pad) - BENCH_DIP.back
  }
  return root1d(trunk, front + 0.4, front - 0.05, { tol: 1e-6, scan: 18 }).x
}

/** body with the hips at height y for contraction c: the hips slide down the bench (v.slide, or the back placed just
 * off it), legs to the planted feet, hands on the pad's edge */
function benchFrame(skel: Skeleton, p: P, v: BenchRig, c: number, y: number): Float64Array {
  const q = zeroQ(skel)
  benchTrunk(skel, q, c)
  setPelvis(skel, q, [0, y, v.slide ? v.slide(y) : backZ(skel, p, v, y)], p.torsoAngle)
  if (v.feet.length) solveLegs(skel, q, v.feet)
  const g: V3 = [v.palms.pos[0] + BENCH_DIP.half, v.palms.pos[1], v.palms.pos[2]]
  attachHand(skel, q, 'l', { pos: g, axis: [-1, 0, 0], palm: BENCH_PALM, oblique: BENCH_OBLIQUE }, { pole: BENCH_POLE, wristBias: BENCH_DIP.wrist, planeHint: -80, devBand: [-35, 20], limits: { flex: PALM_WRIST_LIMITS['wrist_l.flex'] } })
  for (const k of MIRRORED) q[skel.dof[k.replace('*', 'r')]] = q[skel.dof[k.replace('*', 'l')]]
  return q
}

function benchContext(p: P, skel: Skeleton, tempo: Tempo): BenchCtx {
  const spec = crossBench({ id: 'xbench', seatHeight: BENCH_DIP.seat })
  // across behind the lifter, the back pad centred on him, its front edge at z = 0
  const bench: ImplementPose = { id: spec.id, pos: [DRAWN_BENCH.gap + DRAWN_BENCH.back.len / 2, BENCH_DIP.seat, -DRAWN_BENCH.back.width / 2], rot: qaxis([0, 1, 0], 90 * DEG) }
  const palmSpec = palmRest({ half: BENCH_DIP.half })
  const palms: ImplementPose = { id: palmSpec.id, pos: [0, BENCH_DIP.seat + PAD_GRIP, PAD_GRIP], rot: qid() }
  const v: BenchRig = { bench, palms, feet: [], spec }
  const elbowAt = (c: number, y: number) => benchFrame(skel, p, v, c, y)[skel.dof['elbow_l.flex']]
  // the ends: the top at the soft lockout, the bottom with the upper arm BENCH_DIP.extension behind the trunk
  const ext = (y: number) => armElevation(skel, fk(skel, benchFrame(skel, p, v, 0, y))) - BENCH_DIP.extension
  const ends = [root1d(ext, 0.6, 0.05, { tol: 1e-6, scan: 11 }).x, root1d((y) => elbowAt(1, y) - BENCH_DIP.elbow, 0.0, 0.75, { tol: 1e-6, scan: 15 }).x]
  // the back's clearance at knots between the ends, splined (a smooth path down the bench face)
  const ys = Array.from({ length: SLIDE_KNOTS }, (_, k) => lerp(ends[0] - 0.03, ends[1] + 0.03, k / (SLIDE_KNOTS - 1)))
  const zOf = monotoneCubic(ys, ys.map((y) => backZ(skel, p, v, y)))
  v.slide = (y) => zOf(Math.max(ys[0], Math.min(ys[ys.length - 1], y)))
  // the hips move along that path: re-solve the ends on it, then the elbow opens linearly in c
  ends[0] = root1d(ext, 0.6, 0.05, { tol: 1e-6, scan: 11 }).x
  ends[1] = root1d((y) => elbowAt(1, y) - BENCH_DIP.elbow, 0.0, 0.75, { tol: 1e-6, scan: 15 }).x
  const bottom = elbowAt(0, ends[0])
  const yFor = (c: number) => root1d((y) => elbowAt(c, y) - lerp(bottom, BENCH_DIP.elbow, c), ends[0] - 0.05, ends[1] + 0.05, { tol: 1e-6, scan: 15 }).x
  // feet planted where the knees bend to kneeAngle at the top
  const q1 = benchFrame(skel, p, v, 1, ends[1])
  const hip = fk(skel, q1).pos[skel.seg.pelvis]
  const legs = plantFeet(skel, q1, [0, hip[1], hip[2]], p.kneeAngle, BENCH_DIP.feetHalf, BENCH_DIP.toeOut)
  v.feet = legs.feet
  const cs = Array.from({ length: 7 }, (_, k) => k / 6)
  const height = monotoneCubic(cs, cs.map(yFor))
  const setup: Setup = {
    implements: [palmSpec, spec],
    contacts: [
      ...legs.contacts,
      { site: 'grip_l', kind: 'grip', target: { implement: palmSpec.id, grip: 'l' } },
      { site: 'grip_r', kind: 'grip', target: { implement: palmSpec.id, grip: 'r' } },
    ],
    tempo,
    symmetric: true,
    rests: [{ implement: spec.id, regions: ['hand_l', 'hand_r'], tol: PALM_SINK }],
    limits: PALM_WRIST_LIMITS,
    // at the bottom the upper arm is level behind the trunk: pure shoulder extension (plane ~-77), which the
    // horizontal-abduction gate reads as ~77 deg behind the frontal plane once elevation passes 60. A lead decision
    tolerances: { horizontalAbduction: BENCH_DIP.behind },
  }
  return { kind: 'bench', tempo, setup, bench, palms, feet: v.feet, height, slide: v.slide }
}

const benchSpecOf = (ctx: BenchCtx) => ctx.setup.implements.find((s) => s.id === ctx.bench.id)!

const benchCtx = memo((p: P, skel: Skeleton): BenchCtx => {
  const why = unsupported(p)
  if (why) throw new Error(`dip: variant not implemented yet (${why})`)
  return benchContext(p, skel, p.tempo ?? DEFAULT_TEMPO)
})

const context = memo((p: P, skel: Skeleton): Ctx => {
  const why = unsupported(p)
  if (why) throw new Error(`dip: variant not implemented yet (${why})`)
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const rings = p.implement === 'rings'
  // rings: where the hands hold them, as the bars' grip sites (the rings are posed in the hands each frame)
  const bars = rings ? ringGrips() : dipBars()
  const base = { bars, pose: { id: bars.id, pos: [0, 0, 0] as V3, rot: qid() } }
  const elbow = (c: number, y: number) => pose(skel, p, base, c, y)[skel.dof['elbow_l.flex']]
  // body height along the rep: solved at a few points so the elbow follows TOP -> BOTTOM linearly in c
  const cs = Array.from({ length: 7 }, (_, k) => k / 6)
  const ys = cs.map((c) => root1d((y) => elbow(c, y) - lerp(BOTTOM_ELBOW, TOP_ELBOW, c), DIP.height - 0.3, DIP.height + 0.4, { tol: 1e-6, scan: 4 }).x)
  if (rings) {
    // the straps hang just outside the arms
    const rig = ringRig({ z: 0, spread: ringSpread(RING_DIP.half) })
    const setup: Setup = {
      implements: rig.implements,
      contacts: ringContacts(),
      tempo,
      symmetric: true,
      balance: { point: 'com', over: { implement: rig.anchor.id, sites: ['strap_l', 'strap_r'] }, tol: 0.025 },
    }
    return { tempo, setup, ...base, height: monotoneCubic(cs, ys), rig }
  }
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
  if (p.support === 'bench') {
    const b = benchCtx(p, skel)
    const c = phaseAt(u, b.tempo).c
    return { q: benchFrame(skel, p, { ...b, spec: benchSpecOf(b) }, c, b.height(c)), implements: [b.palms, b.bench], contacts: b.setup.contacts }
  }
  const ctx = context(p, skel)
  const c = phaseAt(u, ctx.tempo).c
  const q = pose(skel, p, ctx, c, ctx.height(c))
  return { q, implements: ctx.rig ? ringPoses(skel, fk(skel, q), ctx.rig) : [ctx.pose], contacts: ctx.setup.contacts }
}

export const dip: Template<P> = {
  id: 'dip',
  driver: 'root',
  params: SCHEMAS.dip,
  implemented: true,
  setup: (p, skel) => (p.support === 'bench' ? benchCtx(p, skel).setup : context(p, skel).setup),
  sample,
}

