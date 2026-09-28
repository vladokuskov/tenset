import { attachHand } from '../../constraints.ts'
import { bodyCapsules, type Capsule } from '../../collide.ts'
import { fk } from '../../fk.ts'
import type { Cable, ImplementSpec } from '../../implements.ts'
import { coreRope } from '../../implements/core.ts'
import { floorMat } from '../../implements/shared.ts'
import { dls } from '../../ik.ts'
import { add, cross, dist, lerp, norm, qfromBasis, qid, qmul, qrot, reject, scale, sub, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'
import { stackSpec } from './cable.ts'
import { matClearance, mirrorArm, SINK, toWorld } from './floor.ts'

// Kneeling cable crunch (801): kneeling on a mat facing a high pulley, toes tucked, hips held over the knees; the
// fists hold the rope beside the head and the spine curls (lumbar and thoracic flexion, the ribs towards the pelvis)
// while the hips stay put. Research (motion-authoring): trunk flexion is thoracolumbar; the cable version curls
// further than the floor crunch (~60 deg of spinal flexion here), author judgment.

/** deg: pelvis tilt (trunk leaning forward from the hips), lumbar and thoracic flexion top -> curled, neck */
export const KNEEL = { tilt: 16, lumbar: [-2, 28], thorax: [0, 32], neck: [4, 12], head: [2, 4] } as const
/** thighs lean forward from vertical this much (hips over the knees), toes tucked (extension), deg */
const THIGH = 6
const TOES = -55
/** left fist (grip site) beside the temple, head frame, m: the strands pass either side of the head */
const FIST: V3 = [0.125, 0.03, 0.06]
/** rope grips below the carabiner, m */
const ROPE_DROP = 0.4
/** cable from the rope to the pulley at the top of the rep, deg from vertical towards the stack */
const CABLE_LEAN = 35
/** high pulley wheel centre, m (props/cable.ts PULLEY_HEIGHTS.high) */
const PULLEY_Y = 2.0
/** stack load for the cable force, kg */
const CABLE_KG = 20

export type Kneel = {
  kind: 'kneel'
  tempo: Tempo
  setup: Setup
  /** root height and knee flexion that rest the knees and toes on the mat */
  ty: number
  knee: number
  rope: ImplementSpec
  pulley: V3
  mat: ImplementPose
}

const LEG = (c: Capsule) => c.region.startsWith('shank_') || c.region.startsWith('thigh_')
const FOREFOOT = (c: Capsule) => c.name.startsWith('forefoot_')

function kneelBody(skel: Skeleton, q: Float64Array, c: number, v: Pick<Kneel, 'ty' | 'knee'>) {
  setDofs(skel, q, {
    'lumbar.flex': lerp(KNEEL.lumbar[0], KNEEL.lumbar[1], c),
    'thorax.flex': lerp(KNEEL.thorax[0], KNEEL.thorax[1], c),
    'neck.flex': lerp(KNEEL.neck[0], KNEEL.neck[1], c),
    'head.flex': lerp(KNEEL.head[0], KNEEL.head[1], c),
    'clavicle_*.elev': 8,
    'clavicle_*.prot': 6,
    'hip_*.flex': THIGH + KNEEL.tilt,
    'hip_*.abd': 2,
    'knee_*.flex': v.knee,
    'ankle_*.df': 0,
    'toe_*.flex': TOES,
    'grip_*.close': 1,
  })
  setPelvis(skel, q, [0, v.ty, 0], KNEEL.tilt)
}

/** fists by the temples: the left hand fixed in the head frame (palm in, the strand leaving the top of the fist
 * forwards and up), the arm solved to it, the right mirrored */
function fists(skel: Skeleton, q: Float64Array) {
  const f = fk(skel, q)
  const head = f.rot[skel.seg.head]
  const target = toWorld(skel, f, 'head', FIST)
  // hand axes in the head frame: back of the hand (+X local) out, index side (+Z local) along the strand
  const hand = qmul(head, qfromBasis([1, 0, 0], cross(STRAND, [1, 0, 0])))
  const thorax = f.rot[skel.seg.thorax2]
  attachHand(skel, q, 'l', { pos: target, axis: qrot(hand, [0, 0, 1]), palm: qrot(hand, [-1, 0, 0]), hand }, { pole: qrot(thorax, [0.35, -0.55, 1]), planeHint: 80 })
  mirrorArm(skel, q)
}

/** rope strand direction through the fist, head frame */
const STRAND: V3 = norm([-0.25, 0.55, 0.8])

/** the rope hangs from the fists: grips on the fists' grip sites, carabiner on the line towards the pulley */
function ropePose(skel: Skeleton, q: Float64Array, v: Pick<Kneel, 'rope' | 'pulley'>): ImplementPose {
  const f = fk(skel, q)
  const l = toWorld(skel, f, 'hand_l', skel.data.sites.grip_l.local)
  const r = toWorld(skel, f, 'hand_r', skel.data.sites.grip_r.local)
  const mid = scale(add(l, r), 0.5)
  const x = norm(sub(l, r))
  const y = norm(reject(sub(v.pulley, mid), x))
  const rot = qfromBasis(x, y)
  return { id: v.rope.id, pos: sub(mid, qrot(rot, [0, -ROPE_DROP, 0])), rot }
}

export function kneelContext(skel: Skeleton, tempo: Tempo): Kneel {
  // knees and tucked toes on the mat: root height and knee flexion
  const q = zeroQ(skel)
  const rest = (x: number[]) => {
    kneelBody(skel, q, 0, { ty: x[0], knee: x[1] })
    const caps = bodyCapsules(skel, fk(skel, q))
    return [(matClearance(caps.filter(LEG)) + SINK) * 100, (matClearance(caps.filter(FOREFOOT)) + SINK / 2) * 100]
  }
  const s = dls(rest, [0.62, 100], { tol: 1e-8, iters: 80 })
  const v0 = { ty: s.x[0], knee: s.x[1] }
  kneelBody(skel, q, 0, v0)
  // pulley ahead of the head so the cable leans towards the stack at the top of the rep
  const f = fk(skel, q)
  const head = toWorld(skel, f, 'head', [0, FIST[1], FIST[2]])
  const carabiner = add(head, [0, ROPE_DROP * 0.9, ROPE_DROP * 0.4])
  const pulley: V3 = [0, PULLEY_Y, carabiner[2] + (PULLEY_Y - carabiner[1]) * Math.tan((CABLE_LEAN * Math.PI) / 180)]
  fists(skel, q)
  const hands = dist(toWorld(skel, fk(skel, q), 'hand_l', skel.data.sites.grip_l.local), toWorld(skel, fk(skel, q), 'hand_r', skel.data.sites.grip_r.local))
  const rope = coreRope({ half: hands / 2, drop: ROPE_DROP })
  // mat under the knees and feet
  const knees = toWorld(skel, f, 'tibia_l', [0, 0, 0])
  const toes = toWorld(skel, f, 'foot_l', skel.data.sites.toe_l.local)
  const matSpec = floorMat({ length: 0.95 })
  const mat: ImplementPose = { id: matSpec.id, pos: [0, 0, (knees[2] + 0.12 + toes[2] - 0.08) / 2], rot: qid() }
  const contacts: Contact[] = [
    { site: 'grip_l', kind: 'grip', target: { implement: rope.id, grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: rope.id, grip: 'r' } },
  ]
  for (const side of ['l', 'r'] as const) for (const site of ['ball', 'toe']) {
    contacts.push({ site: `${site}_${side}`, kind: 'planted', target: { world: toWorld(skel, f, `foot_${side}`, skel.data.sites[`${site}_${side}`].local) } })
  }
  const cables: Cable[] = [{ pulley, implement: rope.id, point: [0, 0, 0], kg: CABLE_KG }]
  const setup: Setup = { implements: [rope, stackSpec(pulley, [0, 0, 1]), matSpec], contacts, tempo, symmetric: true, cables }
  return { kind: 'kneel', tempo, setup, ...v0, rope, pulley, mat }
}

export function sampleKneel(skel: Skeleton, ctx: Kneel, c: number): Pose {
  const q = zeroQ(skel)
  kneelBody(skel, q, c, ctx)
  fists(skel, q)
  return { q, implements: [ropePose(skel, q, ctx), { id: 'stack', pos: [0, 0, 0], rot: qid() }, ctx.mat], contacts: ctx.setup.contacts }
}
