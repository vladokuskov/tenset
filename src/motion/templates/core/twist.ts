import { attachHand, type FootTarget } from '../../constraints.ts'
import type { Capsule } from '../../collide.ts'
import { fk, sitePos, type FK } from '../../fk.ts'
import { siteWorld, type ImplementSpec } from '../../implements.ts'
import { weightPlate } from '../../implements/free-weights.ts'
import { floorMat } from '../../implements/shared.ts'
import { dls } from '../../ik.ts'
import { add, qid, qrot, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Side, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import type { ParamsOf } from '../schemas.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'
import { footContacts, legsToward, MAT_TOP, restOnMat } from './floor.ts'

// Russian twist (821): seated on the mat, knees bent and heels down, the trunk leaning back ~45 deg with the chest up;
// a plate held by its rim in front of the chest. The shoulders turn (thoracic and lumbar rotation, the pelvis turning a
// little with them) to bring the plate down beside one hip, then across to the other: one loop sweeps from the far
// hip (bottom) to the working side's hip (top), slowly one way and quickly back. Research (motion-authoring): trunk
// rotation +-30-45 deg; the lean and the plate path are author judgment.

type P = ParamsOf<'rotation'>

/** deg: trunk lean back from vertical, thoracic and lumbar rotation and pelvis yaw at either end, spine flexion, knee
 * flexion with the heels down; plate kg */
export const TWIST = { lean: 45, thorax: 30, lumbar: 12, pelvis: 6, lumbarFlex: 4, thoraxFlex: 6, knee: 95, kg: 10 } as const
/** plate centre from the sternum in the thorax frame (towards the head, out of the chest), m; it drops this far
 * (world) towards the mat at either end of the turn */
const PLATE_AT: V3 = [0, -0.05, 0.15]
const PLATE_DROP = 0.06

export type Twist = {
  kind: 'twist'
  tempo: Tempo
  setup: Setup
  work: Side
  /** pelvis tilt that leans the trunk back TWIST.lean, deg */
  tilt: number
  feet: FootTarget[]
  plate: ImplementSpec
  mat: ImplementPose
}

const SEAT = (c: Capsule) => c.segment === 'pelvis'

/** turn to the left (+1) or right (-1) side, -1..1 */
function body(skel: Skeleton, q: Float64Array, v: Pick<Twist, 'tilt'>, turn: number) {
  setDofs(skel, q, {
    'lumbar.flex': TWIST.lumbarFlex,
    'thorax.flex': TWIST.thoraxFlex,
    'lumbar.rot': TWIST.lumbar * turn,
    'thorax.rot': TWIST.thorax * turn,
    'neck.flex': 10,
    'neck.rot': 6 * turn,
    'clavicle_*.prot': 8,
    'clavicle_*.elev': 2,
    'grip_*.close': 1,
  })
  setPelvis(skel, q, [0, 0.3, 0], v.tilt, TWIST.pelvis * turn)
  restOnMat(skel, q, SEAT)
}

function platePose(skel: Skeleton, f: FK, plate: ImplementSpec, turn: number): ImplementPose {
  const thorax = f.rot[skel.seg.thorax2]
  const pos = add(add(sitePos(skel, f, 'sternum'), qrot(thorax, PLATE_AT)), [0, -PLATE_DROP * turn * turn, 0])
  return { id: plate.id, pos, rot: thorax }
}

function arms(skel: Skeleton, q: Float64Array, plate: ImplementSpec, pose: ImplementPose) {
  const thorax = fk(skel, q).rot[skel.seg.thorax2]
  for (const s of ['l', 'r'] as const) {
    const out = s === 'l' ? 1 : -1
    const g = siteWorld(plate, pose, `rim_${s}`)
    attachHand(skel, q, s, { pos: g.pos, axis: g.axis!, palm: qrot(thorax, [-out, 0, 0]) }, { pole: qrot(thorax, [out, -0.5, -0.2]), planeHint: 70 })
  }
}

/** the turn at contraction c: the far side at the bottom (c = 0), the working side at the top */
const turnAt = (v: Pick<Twist, 'work'>, c: number) => (v.work === 'l' ? 1 : -1) * (2 * c - 1)

function frame(skel: Skeleton, v: Twist, c: number): { q: Float64Array; plate: ImplementPose } {
  const q = zeroQ(skel)
  const turn = turnAt(v, c)
  body(skel, q, v, turn)
  legsToward(skel, q, v.feet, [0, 1, 0])
  const plate = platePose(skel, fk(skel, q), v.plate, turn)
  arms(skel, q, v.plate, plate)
  return { q, plate }
}

export function twistContext(p: P, skel: Skeleton, tempo: Tempo): Twist {
  const work: Side = p.side === 'left' ? 'l' : 'r'
  // the pelvis tilt that leans the thorax TWIST.lean back from vertical
  const q = zeroQ(skel)
  const v0 = { tilt: -TWIST.lean - TWIST.lumbarFlex - TWIST.thoraxFlex }
  body(skel, q, v0, 0)
  // heels on the mat, knees bent: thighs and shins from the hips with the knee at TWIST.knee, feet flat
  const r = dls((x) => {
    setDofs(skel, q, { 'hip_*.flex': x[0], 'knee_*.flex': TWIST.knee, 'ankle_*.df': x[1], 'hip_*.abd': 4 })
    const f = fk(skel, q)
    const heel = sitePos(skel, f, 'heel_l'), ball = sitePos(skel, f, 'ball_l')
    return [(heel[1] - MAT_TOP) * 100, (ball[1] - MAT_TOP) * 100]
  }, [70, 5], { tol: 1e-8, iters: 60 })
  setDofs(skel, q, { 'hip_*.flex': r.x[0], 'ankle_*.df': r.x[1] })
  const f = fk(skel, q)
  const feet: FootTarget[] = (['l', 'r'] as const).map((side) => ({ side, rot: f.rot[skel.seg[`foot_${side}`]], ankle: f.pos[skel.seg[`foot_${side}`]] }))
  const contacts: Contact[] = footContacts(skel, feet)
  const plate = weightPlate({ id: 'plate', kg: TWIST.kg })
  contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: plate.id, grip: 'rim_l' } }, { site: 'grip_r', kind: 'grip', target: { implement: plate.id, grip: 'rim_r' } })
  const matSpec = floorMat()
  const back = f.pos[skel.seg.pelvis][2] - 0.45, front = sitePos(skel, f, 'toe_l')[2] + 0.1
  const mat: ImplementPose = { id: matSpec.id, pos: [0, 0, (back + front) / 2], rot: qid() }
  const setup: Setup = {
    implements: [matSpec, plate],
    contacts,
    tempo,
    symmetric: false,
    // the fingers wrap the rim over the plate's faces (the hand capsule reaches the core disc), as the weighted crunch
    rests: [{ implement: plate.id, regions: ['hand_l', 'hand_r'], tol: 22 }],
  }
  return { kind: 'twist', tempo, setup, work, tilt: v0.tilt, feet, plate, mat }
}

export function sampleTwist(skel: Skeleton, v: Twist, c: number): Pose {
  const { q, plate } = frame(skel, v, c)
  return { q, implements: [v.mat, plate], contacts: v.setup.contacts }
}
