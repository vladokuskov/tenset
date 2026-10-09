import { bodyCapsules } from '../../collide.ts'
import { attachHand, handFrame, plantFoot, root1d, solveLegs, type FootTarget } from '../../constraints.ts'
import { fk, segPos, sitePos } from '../../fk.ts'
import { band, bandGrip, bandNode, bandPose, poseHandle, FLOOR_MAT, floorMat, type BandPoint } from '../../implements/index.ts'
import type { ImplementSpec } from '../../implements.ts'
import { add, lerp, norm, qalign, qrot, scale, sub, type V3 } from '../../math.ts'
import { setDofs, setScapula, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import type { ParamsOf } from '../schemas.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'

// Band wrist extension, half kneeling (750): the free side's knee down on a short mat, the working side's foot flat in
// front on the band, that forearm resting along the front thigh, palm down, the wrist just past the knee. A loop band
// runs from under the front foot's ball up to the fist. Only the wrist moves: from flexion (the hand hanging down,
// the band's stretch) to extension, lifting the back of the hand. The free arm hangs relaxed. Ranges as the kneeling
// wrist curls (joint limits less a margin); the half-kneeling stance is coaching standard.

type P = ParamsOf<'wrist-curl'>
type S = 'l' | 'r'

const HALF = {
  /** trunk: spine flexion; the pelvis tilt is solved so the shoulder sits an upper arm above the elbow */
  lumbar: 6,
  thorax: 6,
  neck: -20,
  head: -10,
  /** rear leg: thigh behind vertical, knee flexion, ankle, toes tucked (deg) */
  rearThigh: -5,
  rearKnee: 95,
  ankle: -10,
  toes: -30,
  sink: 0.004,
  /** front foot: half spacing (m), toe-out, knee flexion (deg) */
  front: { x: 0.16, toeOut: 10, knee: 90 },
  /** the wrist joint this far past the knee along the thigh, m; the forearm sinks this far into the thigh, m */
  over: 0.06,
  /** the elbow's pole leans this far out to the side, so the upper arm comes down beside the thigh, not onto it */
  elbowOut: 0.3,
  rest: -0.006,
  /** wrist flexion (deg, + towards the palm): hanging down at the stretch, extended at the top */
  range: [40, -45] as [number, number],
  mat: { length: 0.45, width: 0.4 },
  /** the strip under the front foot: either side of the ball, and in front of the toes, m */
  under: { x: 0.03, y: 0.003, ahead: 0.02 },
}

export type HalfKneel = {
  tempo: Tempo
  setup: Setup
  work: S
  /** the still pose with the wrist straight */
  q: Float64Array
  flex0: number
  fist: ImplementSpec
  /** the band's floor point under the front foot (the fist turns its strands towards it) */
  foot: V3
  matPose: ImplementPose
}

function trunk(skel: Skeleton, q: Float64Array, rear: S, hip: V3, tilt: number) {
  setDofs(skel, q, {
    'lumbar.flex': HALF.lumbar,
    'thorax.flex': HALF.thorax,
    'neck.flex': HALF.neck,
    'head.flex': HALF.head,
    [`hip_${rear}.flex`]: tilt + HALF.rearThigh,
    [`hip_${rear}.abd`]: 2,
    [`knee_${rear}.flex`]: HALF.rearKnee,
    [`ankle_${rear}.df`]: HALF.ankle,
    [`toe_${rear}.flex`]: HALF.toes,
    'grip_*.close': 1,
  })
  setPelvis(skel, q, hip, tilt)
}

/** lowest point of these regions' capsules, m */
const lowest = (skel: Skeleton, q: Float64Array, re: RegExp) =>
  Math.min(...bodyCapsules(skel, fk(skel, q)).filter((c) => re.test(c.region)).map((c) => Math.min(c.a[1], c.b[1]) - c.r))

/** the free arm hangs relaxed */
function freeArm(skel: Skeleton, q: Float64Array, s: S) {
  setDofs(skel, q, { [`shoulder_${s}.plane`]: 60, [`shoulder_${s}.elev`]: 10, [`elbow_${s}.flex`]: 15, [`forearm_${s}.pro`]: 20, [`grip_${s}.close`]: 0.3 })
  setScapula(skel, q, s)
}

export function halfKneelContext(p: P, skel: Skeleton, tempo: Tempo): HalfKneel {
  const work: S = p.side === 'left' ? 'l' : 'r'
  const rear: S = work === 'l' ? 'r' : 'l'
  const sgn = work === 'l' ? 1 : -1
  const matTop = FLOOR_MAT.thick
  // the rear knee on the mat: pelvis height for a tilt
  const kneeling = (tilt: number) => {
    const at = (y: number) => {
      const q = zeroQ(skel)
      trunk(skel, q, rear, [0, y, 0], tilt)
      return q
    }
    const y = root1d((yy) => lowest(skel, at(yy), new RegExp(`^(shank|thigh)_${rear}$`)) - (matTop - HALF.sink), 0.3, 1.1, { tol: 1e-7 }).x
    const q = at(y)
    // the rear shin rises from the knee until the tucked toes rest on the floor
    const k = skel.dof[`knee_${rear}.flex`]
    q[k] = root1d((a) => {
      q[k] = a
      return lowest(skel, q, new RegExp(`^foot_${rear}$`)) + HALF.sink
    }, 60, 150, { tol: 1e-7 }).x
    return { q, y }
  }
  // the front foot flat where the front knee bends HALF.front.knee
  const withFront = (tilt: number) => {
    const { q, y } = kneeling(tilt)
    let foot!: FootTarget
    const z = root1d((zz) => {
      foot = plantFoot(skel, work, [sgn * HALF.front.x, 0, zz], HALF.front.toeOut)
      solveLegs(skel, q, [foot])
      return q[skel.dof[`knee_${work}.flex`]] - HALF.front.knee
    }, 0.1, 0.9, { tol: 1e-6 })
    foot = plantFoot(skel, work, [sgn * HALF.front.x, 0, z.x], HALF.front.toeOut)
    solveLegs(skel, q, [foot])
    return { q, y, foot }
  }
  // the forearm along the top of the front thigh, wrist HALF.over past the knee
  const l1 = skel.segments[skel.seg[`humerus_${work}`]].length
  const l2 = skel.segments[skel.seg[`forearm_${work}`]].length
  const forearmOn = (q: Float64Array) => {
    const f = fk(skel, q)
    const hip = segPos(skel, f, `femur_${work}`), knee = segPos(skel, f, `tibia_${work}`)
    const dir = norm(sub(knee, hip))
    const caps = bodyCapsules(skel, f)
    const thigh = caps.find((c) => c.region === `thigh_${work}`)!
    const fore = caps.find((c) => c.region === `forearm_${work}`)!
    const up = norm(sub([0, 1, 0], scale(dir, dir[1])))
    const lift = scale(up, thigh.r + fore.r - HALF.rest)
    const W = add(add(knee, scale(dir, HALF.over)), lift)
    return { W, E: sub(W, scale(dir, l2)), dir }
  }
  const tilt = root1d((t) => {
    const { q } = withFront(t)
    const { E } = forearmOn(q)
    const S = segPos(skel, fk(skel, q), `humerus_${work}`)
    return Math.hypot(...sub(S, E)) - l1
  }, 0, 70, { tol: 1e-6 }).x
  const { q, foot } = withFront(tilt)
  freeArm(skel, q, rear)
  setDofs(skel, q, { [`clavicle_${work}.prot`]: 6 })
  const { W, E, dir } = forearmOn(q)
  // the hand straight on: fingers along the forearm, palm down
  const site = skel.data.sites[`grip_${work}`]
  const palm: V3 = [0, -1, 0]
  const hand = qalign([0, -1, 0], site.normal!, dir, palm)
  const S = segPos(skel, fk(skel, q), `humerus_${work}`)
  attachHand(skel, q, work, { pos: add(W, qrot(hand, site.local)), axis: qrot(hand, site.axis!), palm, hand }, { pole: add(sub(E, add(S, scale(norm(sub(W, S)), l1))), [sgn * HALF.elbowOut, 0, 0]), planeHint: 90 })
  // mat under the rear knee
  const F = fk(skel, q)
  const kneePos = segPos(skel, F, `tibia_${rear}`)
  const mat = floorMat({ id: 'mat', length: HALF.mat.length, width: HALF.mat.width })
  const matPose: ImplementPose = { id: 'mat', pos: [kneePos[0], 0, kneePos[2] - 0.1], rot: [0, 0, 0, 1] }
  // the band: under the front foot's ball, up to the fist
  const ball = sitePos(skel, F, `ball_${work}`)
  const toe = sitePos(skel, F, `toe_${work}`)
  const { x, y, ahead } = HALF.under
  const fist = bandGrip({ id: 'fist' })
  const footAt: V3 = [ball[0], y, ball[2]]
  const pose0 = poseHandle(fist, 'c', handFrame(skel, F, work).pos, handFrame(skel, F, work).axis, footAt)
  const ax = add(pose0.pos, qrot(pose0.rot, fist.sites.a.pos))[0], bx = add(pose0.pos, qrot(pose0.rot, fist.sites.b.pos))[0]
  const [hi, lo] = ax > bx ? ['a', 'b'] : ['b', 'a']
  const floor = (at: V3): BandPoint => ({ implement: 'floor', at, face: [0, 1, 0] })
  const strip = band({
    path: [
      { implement: 'fist', site: lo },
      floor([toe[0] - x, y, toe[2] + ahead]),
      floor([ball[0] - x, y, ball[2]]),
      floor([ball[0] + x, y, ball[2]]),
      floor([toe[0] + x, y, toe[2] + ahead]),
      { implement: 'fist', site: hi },
    ],
    closed: true,
  })
  const contacts: Contact[] = [
    ...['heel', 'ball'].map((n): Contact => ({ site: `${n}_${work}`, kind: 'planted', target: { world: add(foot.ankle, qrot(foot.rot, skel.data.sites[`${n}_${work}`].local)) } })),
    { site: `ball_${rear}`, kind: 'planted', target: { world: sitePos(skel, F, `ball_${rear}`) } },
    { site: `grip_${work}`, kind: 'grip', target: { implement: 'fist', grip: 'c' } },
  ]
  const setup: Setup = { implements: [fist, bandNode('floor'), strip, mat], contacts, tempo, symmetric: false }
  return { tempo, setup, work, q, flex0: q[skel.dof[`wrist_${work}.flex`]], fist, foot: footAt, matPose }
}

export function sampleHalfKneel(u: number, skel: Skeleton, v: HalfKneel): Pose {
  const q = Float64Array.from(v.q)
  q[skel.dof[`wrist_${v.work}.flex`]] = v.flex0 + lerp(HALF.range[0], HALF.range[1], phaseAt(u, v.tempo).c)
  const h = handFrame(skel, fk(skel, q), v.work)
  const fist = poseHandle(v.fist, 'c', h.pos, h.axis, v.foot)
  return { q, implements: [fist, { id: 'floor', pos: [0, 0, 0], rot: [0, 0, 0, 1] }, bandPose(), v.matPose], contacts: v.setup.contacts }
}

