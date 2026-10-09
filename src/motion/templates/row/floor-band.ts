import { root1d, solveLegs, type FootTarget } from '../../constraints.ts'
import { bodyCapsules, capsuleClearance } from '../../collide.ts'
import { fk, localToWorld } from '../../fk.ts'
import { band, bandNode, bandPose, segmentPose, type BandPoint } from '../../implements/index.ts'
import { floorMat } from '../../implements/shared.ts'
import { add, DEG, norm, qaxis, qid, qmul, qrot, scale, sub, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { fistContacts, fistGrips, fistId, fistPoses } from '../band-pose.ts'
import { MAT_TOP, matClearance, SINK } from '../core/floor.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'
import { elbowPole, lerp, mirrorArm, phases, PROT, reach, shoulderMid, type P } from './common.ts'

// Band seated row (323): sitting tall on a mat with the legs straight (knees soft), the middle of the band round the
// soles of both feet and an end in each fist (neutral). As the seated cable row: at the stretch the trunk leans a
// little forward from the hips and the shoulders reach; the pull brings the trunk upright with the scapulae, then the
// elbows drive the fists to the stomach. The band's pull runs from the hands to the feet (inside the body's support).

/** deg: soft knees, the feet's pitch back from the floor (toes up), trunk lean at the stretch */
const LEGS = { knee: 6, footPitch: 72, half: 0.11 }
const LEAN_START = 12
const START_ELBOW = 9
/** arms at the stretch point this far below horizontal, deg (the fists pass over the knees) */
const START_DIP = 24
/** fists to the stomach at the finish, m */
const FINISH_GAP = 0.012
/** band round each sole at the ball of the foot: either edge and the plantar surface (foot frame, m) */
const SOLE = { half: 0.048, below: 0.012 }

export type FloorBand = {
  kind: 'floor'
  tempo: Tempo
  setup: Setup
  hip: V3
  feet: FootTarget[]
  start: V3
  finish: V3
  sm0: V3
  g: number
  mat: ImplementPose
}

const trunkCurve = (c: number) => 1 - (1 - c) ** 1.7

function body(skel: Skeleton, q: Float64Array, hip: V3, feet: FootTarget[], s: number, t: number) {
  setDofs(skel, q, {
    'lumbar.flex': lerp(2, 0, t),
    'thorax.flex': lerp(3, 1, t),
    'neck.flex': lerp(-6, -2, t),
    'head.flex': -2,
    'clavicle_*.prot': lerp(PROT.start, PROT.finish, s),
    'clavicle_*.elev': lerp(4, -3, s),
    'grip_*.close': 1,
  })
  setPelvis(skel, q, hip, lerp(LEAN_START, 0, t) - 4)
  solveLegs(skel, q, feet, 0)
}

/** heels on the mat, legs reaching forward from the hips with soft knees */
function feetFor(skel: Skeleton, hip: V3, lift = 0): FootTarget[] {
  const femur = skel.segments[skel.seg.femur_l]
  const lt = femur.length, ls = skel.segments[skel.seg.tibia_l].length
  const legReach = Math.sqrt(lt * lt + ls * ls + 2 * lt * ls * Math.cos(LEGS.knee * DEG))
  return (['l', 'r'] as const).map((side) => {
    const rot = qmul(qaxis([1, 0, 0], -LEGS.footPitch * DEG), qid())
    const heel = skel.data.sites[`heel_${side}`].local
    const x = side === 'l' ? LEGS.half : -LEGS.half
    // the ankle where the leg reaches, the heel on the mat
    const ankleY = MAT_TOP - SINK / 2 - qrot(rot, heel)[1] + lift
    const dx = x - (side === 'l' ? femur.offset[0] : -femur.offset[0]), dy = hip[1] - ankleY
    const z = hip[2] + Math.sqrt(Math.max(0.01, legReach * legReach - dx * dx - dy * dy))
    return { side, rot, ankle: [x, ankleY, z] as V3 }
  })
}

/** both fists on `center`, g either side, neutral (palms in), elbows back by the ribs */
function arms(skel: Skeleton, q: Float64Array, p: P, center: V3, g: number) {
  reach(skel, q, 'l', { pos: add(center, [g, 0, 0]), axis: [0, 1, 0], palm: [-1, 0, 0] }, { pole: elbowPole(skel, q, 'l', p.elbowFlare, 0.45), planeHint: 60 })
  mirrorArm(skel, q)
}

function soles(skel: Skeleton): BandPoint[] {
  const out: BandPoint[] = []
  for (const side of ['l', 'r'] as const) {
    const ball = skel.data.sites[`ball_${side}`].local
    const lat = side === 'l' ? 1 : -1
    const edge = (k: number): V3 => [ball[0] + lat * k, ball[1] - SOLE.below, ball[2]]
    const pts = side === 'l' ? [edge(SOLE.half), edge(-SOLE.half)] : [edge(-SOLE.half), edge(SOLE.half)]
    for (const at of pts) out.push({ implement: `sole_${side}`, at, face: [0, -1, 0] })
  }
  return out
}

export function floorBandContext(p: P, skel: Skeleton, tempo: Tempo): FloorBand {
  // hip height that rests the buttocks on the mat (the legs reach the heels from it)
  const seat = (c: { region: string; segment: string }) => c.segment === 'pelvis' || c.region === 'trunk'
  let hip: V3 = [0, 0.16, 0]
  let lift = 0
  for (let pass = 0; pass < 3; pass++) {
    const y = root1d((h) => {
      const q = zeroQ(skel)
      body(skel, q, [0, h, 0], feetFor(skel, [0, h, 0], lift), 1, 1)
      return matClearance(bodyCapsules(skel, fk(skel, q)).filter(seat)) + SINK
    }, 0.05, 0.4, { tol: 1e-6 }).x
    hip = [0, y, 0]
    // the heels' capsules (not the heel site) rest on the mat
    const q = zeroQ(skel)
    body(skel, q, hip, feetFor(skel, hip, lift), 1, 1)
    lift -= matClearance(bodyCapsules(skel, fk(skel, q)).filter((c) => c.region.startsWith('foot_'))) + SINK / 2
  }
  const feet = feetFor(skel, hip, lift)
  const g = (0.8 * skel.data.shoulderWidth) / 2
  const v: FloorBand = { kind: 'floor', tempo, setup: undefined as never, hip, feet, start: [0, 0, 0], finish: [0, 0, 0], sm0: [0, 0, 0], g, mat: { id: 'mat', pos: [0, 0, 0], rot: qid() } }
  // start: arms reaching towards the feet, elbows just short of straight
  const q0 = zeroQ(skel)
  body(skel, q0, hip, feet, 0, 0)
  v.sm0 = shoulderMid(skel, q0)
  const dir = norm([0, -Math.sin(START_DIP * DEG), Math.cos(START_DIP * DEG)])
  const elbowAt = (d: number) => {
    const q = Float64Array.from(q0)
    arms(skel, q, p, add(v.sm0, scale(dir, d)), g)
    return q[skel.dof['elbow_l.flex']]
  }
  v.start = add(v.sm0, scale(dir, root1d((d) => elbowAt(d) - START_ELBOW, 0.35, 0.8, { tol: 1e-6 }).x))
  // finish: fists at the stomach, just off it
  const q1 = zeroQ(skel)
  body(skel, q1, hip, feet, 1, 1)
  const f1 = fk(skel, q1)
  const anchor = localToWorld(skel, f1, 'lumbar3', [0, 0.04, 0])
  const fwd = norm(qrot(f1.rot[skel.seg.thorax1], [0, 0, 1]))
  const trunk = bodyCapsules(skel, f1).filter((c) => c.region === 'trunk')
  const gapAt = (d: number) => {
    const q = Float64Array.from(q1)
    arms(skel, q, p, add(anchor, scale(fwd, d)), g)
    const hands = bodyCapsules(skel, fk(skel, q)).filter((c) => c.region.startsWith('hand_'))
    return Math.min(...hands.flatMap((h) => trunk.map((c) => capsuleClearance(h, c)))) - FINISH_GAP
  }
  v.finish = add(anchor, scale(fwd, root1d(gapAt, 0, 0.35, { tol: 1e-6 }).x))
  // the mat from behind the seat to past the heels
  const mat = floorMat({ length: 1.6 })
  v.mat = { id: mat.id, pos: [0, 0, (hip[2] - 0.3 + feet[0].ankle[2] + 0.2) / 2], rot: qid() }
  const strip = band({
    path: [{ implement: fistId('l'), site: 'a' }, { implement: fistId('l'), site: 'b' }, ...soles(skel), { implement: fistId('r'), site: 'b' }, { implement: fistId('r'), site: 'a' }],
    size: 'medium',
  })
  const contacts: Contact[] = [...fistContacts()]
  for (const f of feet) for (const site of ['heel']) contacts.push({ site: `${site}_${f.side}`, kind: 'planted', target: { world: add(f.ankle, qrot(f.rot, skel.data.sites[`${site}_${f.side}`].local)) } })
  v.setup = { implements: [...fistGrips(), bandNode('sole_l'), bandNode('sole_r'), strip, mat], contacts, tempo, symmetric: p.laterality === 'bilateral' }
  return v
}

export function sampleFloorBand(u: number, p: P, skel: Skeleton, v: FloorBand): Pose {
  const ph = phases(u, v.tempo)
  const q = zeroQ(skel)
  body(skel, q, v.hip, v.feet, ph.s, trunkCurve(ph.c))
  const from = add(v.start, sub(shoulderMid(skel, q), v.sm0))
  arms(skel, q, p, add(scale(from, 1 - ph.g), scale(v.finish, ph.g)), v.g)
  const f = fk(skel, q)
  return {
    q,
    implements: [...fistPoses(skel, q), segmentPose(skel, f, 'sole_l', 'foot_l'), segmentPose(skel, f, 'sole_r', 'foot_r'), bandPose(), v.mat],
    contacts: v.setup.contacts,
  }
}
