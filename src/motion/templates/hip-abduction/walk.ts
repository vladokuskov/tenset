import { legKinematics, plantFoot, root1d, writeLeg, type FootTarget } from '../../constraints.ts'
import { centerOfPressure, fk, sitePos } from '../../fk.ts'
import { around, band, bandNode, bandPose, segmentPose } from '../../implements/index.ts'
import { add, clamp, lerp } from '../../math.ts'
import { setDofs, zeroQ, type Pose, type Side, type Skeleton } from '../../skeleton.ts'
import { DEFAULT_TEMPO, minJerk, type Tempo } from '../../timing.ts'
import { palmRests } from '../../implements/hinge.ts'
import { arms, PALMS } from '../back-extension.ts'
import type { ParamsOf } from '../schemas.ts'
import { setPelvis } from '../standing.ts'
import { memo, type Setup } from '../types.ts'

// Band lateral walk (hip-abduction, band, standing): a mini band round both legs just above the knees, a shallow
// athletic squat with the toes forward and the arms crossed on the chest. One loop is four steps that end where they began:
// the right foot steps out to the right and the left follows, then the left steps out to the left and the right
// follows. Each step shifts the centre of pressure over the stance foot (its inner edge), lifts the moving foot a few
// centimetres, carries it sideways flat and sets it down; the trunk keeps its lean and faces forward. The band stretches
// as each lead step widens the stance (hip abduction of the lead leg ~0 -> 15-20 deg).
// Research (motion-authoring, hip-abduction): abduction against the band 0 -> ~20 deg with neutral hip rotation; the
// gait here is author judgment.

type P = ParamsOf<'hip-abduction'>

export const WALK = {
  /** narrow stance between the feet's spots, m, and the step's length */
  width: 0.26,
  step: 0.18,
  /** knee flexion in the narrow, centred stance (sets the hip height), deg; trunk lean (pelvis tilt), deg */
  knee: 28,
  tilt: 14,
  /** sole clearance at mid-swing, m */
  lift: 0.035,
  /** the centre of pressure sits this far inside the stance foot's inner edge, m (the foot capsule is ~96 mm wide) */
  inside: 0.012,
}
/** a step's share of its quarter of the loop: settle, weight shift, swing (the rest settles after touch-down) */
const STEP = { hold: 0.08, shift: 0.27, swing: 0.5 }
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

/** loop position: step k (0..3) and the fraction t within it */
const at = (u: number): [number, number] => {
  const x = (((u % 1) + 1) % 1) * 4
  const k = Math.min(3, Math.floor(x))
  return [k, x - k]
}

/** where the centre of pressure sits during step k's swing: inside the stance foot's inner edge */
function copTarget(v: Walk, k: number): number {
  const stance: Side = MOVER[k] === 'l' ? 'r' : 'l'
  const x = v.feet[stance][k]
  const towards = Math.sign(v.feet[MOVER[k]][k] - x)
  return x + towards * (FOOT_HALF - WALK.inside)
}

/** the centre of pressure's target x at loop fraction u: held over the stance foot during a swing, eased between */
function copAt(v: Walk, u: number): number {
  const [k, t] = at(u)
  const a = STEP.hold, b = a + STEP.shift
  const cur = copTarget(v, k)
  if (t >= b) {
    // swing, then ease towards the next step's stance foot over the settle and the next shift
    const end = b + STEP.swing
    if (t <= end) return cur
    const next = copTarget(v, (k + 1) % 4)
    const span = 1 - end + a + STEP.shift
    return lerp(cur, next, minJerk((t - end) / span))
  }
  // before the swing: still easing in from the previous step's stance foot
  const prev = copTarget(v, (k + 3) % 4)
  const span = 1 - (b + STEP.swing) + b
  return lerp(prev, cur, minJerk((t + 1 - (b + STEP.swing)) / span))
}

/** a foot's ankle x and lift at loop fraction u */
function footAt(v: Walk, side: Side, u: number): { x: number; lift: number } {
  const [k, t] = at(u)
  const from = v.feet[side][k], to = v.feet[side][(k + 1) % 4]
  if (MOVER[k] !== side) return { x: from, lift: 0 }
  const s = clamp((t - STEP.hold - STEP.shift) / STEP.swing, 0, 1)
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
  const tempo = p.tempo ?? DEFAULT_TEMPO
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
    // both feet step, so neither is a fixed contact; the lateral gate judges the double-support frames
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

/** the soles stay flat: exported for tests */
export const soleY = (skel: Skeleton, q: Float64Array, side: Side) => sitePos(skel, fk(skel, q), `heel_${side}`)[1]
