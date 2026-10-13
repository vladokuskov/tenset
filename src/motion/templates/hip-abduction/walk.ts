import { legKinematics, plantFoot, root1d, writeLeg, type FootTarget } from '../../constraints.ts'
import { centerOfPressure, fk } from '../../fk.ts'
import { around, band, bandNode, bandPose, segmentPose } from '../../implements/index.ts'
import { add, clamp, lerp } from '../../math.ts'
import { setDofs, zeroQ, type Pose, type Side, type Skeleton } from '../../skeleton.ts'
import { minJerk, type Tempo } from '../../timing.ts'
import { palmRests } from '../../implements/hinge.ts'
import { arms, PALMS } from '../back-extension.ts'
import type { ParamsOf } from '../schemas.ts'
import { setPelvis } from '../standing.ts'
import { memo, type Setup } from '../types.ts'

// Band lateral walk (hip-abduction, band, standing): a mini band round both legs just above the knees, a shallow
// athletic squat with the toes forward and the arms crossed on the chest. One loop is four steps that end where they began:
// the right foot steps out to the right and the left follows, then the left steps out to the left and the right
// follows. Before each follow step the weight moves slowly across the wide stance onto the lead foot's inner edge; the
// moving foot lifts a few centimetres, travels sideways flat and sets down; the trunk keeps its lean and faces forward.
// The band stretches as each lead step widens the stance (hip abduction of the lead leg ~0 -> 15-20 deg).
// Research (motion-authoring, hip-abduction): abduction against the band 0 -> ~20 deg with neutral hip rotation; the
// gait here is author judgment.

type P = ParamsOf<'hip-abduction'>

export const WALK = {
  /** narrow stance between the feet's spots, m, and the step's length */
  width: 0.26,
  step: 0.14,
  /** knee flexion in the narrow, centred stance (sets the hip height), deg; trunk lean (pelvis tilt), deg */
  knee: 28,
  tilt: 14,
  /** sole clearance at mid-swing, m */
  lift: 0.035,
  /** the centre of pressure sits this far inside the stance foot's inner edge, m (the foot capsule is ~96 mm wide) */
  inside: 0.012,
}
/**
 * seconds at WALK_TEMPO: a foot's swing, the weight shift across the wide stance between a lead step and its follow
 * step, and the settle between two steps over the same stance foot. Shifts stay slow (under 0.6 m/s at the pelvis), so
 * the torso glides rather than lurches
 */
export const TIME = { swing: 0.4, shift: 1.25, settle: 0.2 }
/** 4.5 s a loop (four steps); the concentric covers the left lead step and the shift onto it */
export const WALK_TEMPO: Tempo = [1.9, 0.2, 1.6, 0.8]
/** band round the thigh this far above the knee joint (m), radius (m) */
const BAND = { above: 0.075, r: 0.068 }
const FOOT_HALF = 0.048
/** the straightest a leg gets as the pelvis shifts over the other foot, deg of knee flexion */
const REACH_KNEE = 14

type Walk = {
  kind: 'walk'
  tempo: Tempo
  setup: Setup
  /** each foot's spot (x) before step k */
  feet: Record<Side, number[]>
  hipY: number
  /** hip to ankle distance at REACH_KNEE, m */
  reach: number
  z0: number
  plant: (side: Side, x: number) => FootTarget
}

/** the four steps: which foot moves */
const MOVER: Side[] = ['r', 'l', 'l', 'r']

const stanceOf = (k: number): Side => (MOVER[k % 4] === 'l' ? 'r' : 'l')

/**
 * the loop's timeline (seconds at WALK_TEMPO), from the middle of a settle: step k's swing, then a weight shift when
 * the next step stands on the other foot, else a settle
 */
type Seg = { k: number; kind: 'swing' | 'shift' | 'settle'; t0: number; t1: number }
const SEGS: Seg[] = (() => {
  const out: Seg[] = []
  let t = TIME.settle / 2
  for (let k = 0; k < 4; k++) {
    out.push({ k, kind: 'swing', t0: t, t1: (t += TIME.swing) })
    const shift = stanceOf(k) !== stanceOf(k + 1)
    const d = shift ? TIME.shift : k === 3 ? TIME.settle / 2 : TIME.settle
    out.push({ k, kind: shift ? 'shift' : 'settle', t0: t, t1: (t += d) })
  }
  return out
})()
const LOOP = SEGS[SEGS.length - 1].t1

/** the segment at loop fraction u and the fraction s within it */
const at = (u: number): [Seg, number] => {
  const t = (((u % 1) + 1) % 1) * LOOP
  const seg = t < SEGS[0].t0 ? SEGS[SEGS.length - 1] : SEGS.find((g) => t < g.t1) ?? SEGS[SEGS.length - 1]
  return [seg, clamp((t - seg.t0) / (seg.t1 - seg.t0), 0, 1)]
}

/** where the centre of pressure sits during step k's swing: inside the stance foot's inner edge */
function copTarget(v: Walk, k: number): number {
  k %= 4
  const stance = stanceOf(k)
  const x = v.feet[stance][k]
  const towards = Math.sign(v.feet[MOVER[k]][k] - x)
  return x + towards * (FOOT_HALF - WALK.inside)
}

/** the centre of pressure's target x at loop fraction u: held over the stance foot, eased across in a shift */
function copAt(v: Walk, u: number): number {
  const [seg, s] = at(u)
  return seg.kind === 'shift' ? lerp(copTarget(v, seg.k), copTarget(v, seg.k + 1), minJerk(s)) : copTarget(v, seg.k)
}

/** a foot's ankle x and lift at loop fraction u */
function footAt(v: Walk, side: Side, u: number): { x: number; lift: number } {
  const [seg, s] = at(u)
  const k = seg.k
  if (seg.kind !== 'swing') return { x: v.feet[side][(k + 1) % 4], lift: 0 }
  const from = v.feet[side][k], to = v.feet[side][(k + 1) % 4]
  if (MOVER[k] !== side) return { x: from, lift: 0 }
  return { x: lerp(from, to, minJerk(s)), lift: WALK.lift * Math.sin(Math.PI * s) ** 2 }
}

/** smooth minimum, length scale 2 cm, so the hips sink without a kink when a leg's reach takes over */
const smin = (xs: number[]) => {
  const m = Math.min(...xs)
  return m - SOFT * Math.log(xs.reduce((a, x) => a + Math.exp(-(x - m) / SOFT), 0))
}
const SOFT = 0.02

function legs(skel: Skeleton, q: Float64Array, v: Walk, u: number, x: number, z: number) {
  const targets = (['l', 'r'] as Side[]).map((side) => {
    const { x: fx, lift } = footAt(v, side, u)
    const t = v.plant(side, fx)
    return { side, t: { ...t, ankle: add(t.ankle, [0, lift, 0]) } }
  })
  // the hips sink when the pelvis over one foot would leave the other leg straighter than REACH_KNEE
  setPelvis(skel, q, [x, v.hipY, z], WALK.tilt)
  let f = fk(skel, q)
  const caps = targets.map(({ side, t }) => {
    const hip = f.pos[skel.seg[`femur_${side}`]]
    const dx = hip[0] - t.ankle[0], dz = hip[2] - t.ankle[2]
    return v.hipY - (hip[1] - (t.ankle[1] + Math.sqrt(Math.max(0, v.reach * v.reach - dx * dx - dz * dz))))
  })
  setPelvis(skel, q, [x, smin([v.hipY, ...caps]), z], WALK.tilt)
  f = fk(skel, q)
  for (const { side, t } of targets) writeLeg(skel, q, side, legKinematics(skel, side, f.pos[skel.seg[`femur_${side}`]], f.rot[skel.seg.pelvis], t))
}

function upper(skel: Skeleton, q: Float64Array) {
  setDofs(skel, q, { 'lumbar.flex': 3, 'thorax.flex': 2, 'neck.flex': -8, 'head.flex': -3, 'clavicle_*.prot': 8, 'clavicle_*.elev': 0 })
  // arms crossed on the chest (hands on the hips would meet the thighs as the hips flex)
  arms(skel, q)
}

/** pelvis x and z that put the centre of pressure on its target and over the midfoot line */
function solve(skel: Skeleton, v: Walk, u: number): Float64Array {
  const q = zeroQ(skel)
  const target = copAt(v, u)
  let x = target, z = v.z0
  for (let k = 0; k < 10; k++) {
    legs(skel, q, v, u, x, z)
    upper(skel, q)
    const [cx, cz] = centerOfPressure(skel, fk(skel, q))
    const ex = target - cx, ez = -cz
    if (Math.hypot(ex, ez) < 2e-6) break
    x += ex
    z += ez
  }
  return q
}

export const walkContext = memo((p: P, skel: Skeleton): Walk => {
  const tempo = p.tempo ?? WALK_TEMPO
  const { width: w, step: d } = WALK
  // stance changes, lifter's right = -X: right steps out, left follows, left steps out, right follows
  const feet: Walk['feet'] = { l: [w / 2, w / 2, w / 2 - d, w / 2], r: [-w / 2, -w / 2 - d, -w / 2 - d, -w / 2 - d] }
  const plant = (side: Side, x: number): FootTarget => plantFoot(skel, side, [x, 0, 0], 0)
  const v: Walk = { kind: 'walk', tempo, setup: undefined as unknown as Setup, feet, hipY: 0.9, reach: 0, z0: 0, plant }
  // hip height: the narrow centred stance at the keyed knee flexion
  const q = zeroQ(skel)
  v.hipY = root1d((y) => {
    setPelvis(skel, q, [0, y, 0], WALK.tilt)
    const f = fk(skel, q)
    return legKinematics(skel, 'l', f.pos[skel.seg.femur_l], f.rot[skel.seg.pelvis], plant('l', w / 2)).knee - WALK.knee
  }, 0.6, 1.0, { tol: 1e-9 }).x
  const lt = skel.segments[skel.seg.femur_l].length, ls = skel.segments[skel.seg.tibia_l].length
  v.reach = Math.sqrt(lt * lt + ls * ls + 2 * lt * ls * Math.cos((REACH_KNEE * Math.PI) / 180))
  const nodes = [bandNode('knee_l'), bandNode('knee_r')]
  const loop = band({
    path: [...around('knee_l', { r: BAND.r, from: -90, to: 90 }), ...around('knee_r', { r: BAND.r, from: 90, to: 270 })],
    closed: true,
    size: 'mini',
  })
  v.setup = {
    implements: [...nodes, loop, palmRests({ id: 'palms', ...PALMS })],
    // both feet step, so neither is a fixed contact and the QA lateral and foot slip gates skip the loop; walk.test.ts
    // judges both per stance phase
    contacts: [{ site: 'grip_l', kind: 'grip', target: { implement: 'palms', grip: 'l' } }, { site: 'grip_r', kind: 'grip', target: { implement: 'palms', grip: 'r' } }],
    tempo,
    symmetric: false,
    balance: { point: 'com', over: 'midfoot', tol: 0.025, lateral: true },
  }
  return v
})

export function sampleWalk(u: number, p: P, skel: Skeleton): Pose {
  const v = walkContext(p, skel)
  const q = solve(skel, v, u)
  const f = fk(skel, q)
  const nodes = (['l', 'r'] as const).map((s) => segmentPose(skel, f, `knee_${s}`, `femur_${s}`, [0, -(skel.segments[skel.seg[`femur_${s}`]].length - BAND.above), 0]))
  return { q, implements: [...nodes, bandPose(), { id: 'palms', pos: f.pos[skel.seg.thorax2], rot: f.rot[skel.seg.thorax2] }], contacts: v.setup.contacts }
}
