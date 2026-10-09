import { bodyCapsules } from '../../collide.ts'
import { attachHand, handFrame, implementFromHand, plantFoot, solveLegs, type FootTarget } from '../../constraints.ts'
import { fk, segPos } from '../../fk.ts'
import { bench, dumbbell, type ImplementSpec } from '../../implements.ts'
import { add, clamp, lerp, norm, qconj, qid, qrot, RAD, reject, scale, sub, type V3 } from '../../math.ts'
import { setDofs, setScapula, zeroQ, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { footContacts } from '../isolation.ts'
import type { ParamsOf } from '../schemas.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'

// Concentration curl (724): seated at the end of a flat bench, feet planted wide, trunk leaning forward over the
// thighs. The working upper arm hangs straight down from the shoulder with its lower end braced against the inner
// thigh just above the knee, and only the elbow moves (~10 -> 135 deg, the forearm folding onto the upper arm). The
// free hand rests on the other thigh. Brace and hang are what the cues ask for; the angles are coaching standard.

type P = ParamsOf<'curl'>
type S = 'l' | 'r'

const CONC = {
  kg: 12,
  sink: 0.006,
  /** pelvis tilt and spine flexion that lean the trunk ~40 deg over the thighs, deg */
  tilt: 22,
  lumbar: 14,
  thorax: 14,
  neck: -22,
  head: -8,
  /** feet: half spacing, distance ahead of the hips, toe-out (knees wide apart) */
  feet: { x: 0.36, z: 0.56, toeOut: 22 },
  elbow: [10, 135] as const,
  /** elbow against the inner thigh: this far from the hip along it, gap to the thigh capsule (- presses in) and raise, m */
  brace: { along: 0.8, gap: 0.02, up: 0.02 },
  pro: -80,
  /** humeral internal rotation, deg: the forearm folds up towards the face, the dumbbell clear of the head (20 reaches it) */
  rot: 10,
  /** free hand on the other thigh, this far from the hip along it and above its surface, m */
  rest: { along: 1.0, above: 0.04 },
}
const HIP: V3 = [0, 0.56, 0]

export type Concentration = {
  tempo: Tempo
  setup: Setup
  work: S
  feet: FootTarget[]
  /** humerus direction in the world (constant), and the free arm's resolved pose */
  dir: V3
  free: Float64Array
  db: ImplementSpec
  benchPose: ImplementPose
}

function trunk(skel: Skeleton, feet?: FootTarget[]) {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': CONC.lumbar, 'thorax.flex': CONC.thorax, 'neck.flex': CONC.neck, 'head.flex': CONC.head, 'grip_*.close': 1 })
  setPelvis(skel, q, HIP, CONC.tilt)
  if (feet) solveLegs(skel, q, feet)
  return q
}

/** working arm: humerus along world `dir`, the elbow at e, palm up */
function workArm(skel: Skeleton, q: Float64Array, s: S, dir: V3, e: number) {
  const thorax = fk(skel, q).rot[skel.seg.thorax2]
  const d = qrot(qconj(thorax), dir)
  const m: V3 = s === 'l' ? d : [-d[0], d[1], d[2]]
  const elev = Math.acos(clamp(-m[1], -1, 1)) * RAD
  setDofs(skel, q, {
    [`shoulder_${s}.plane`]: Math.atan2(m[2], m[0]) * RAD,
    [`shoulder_${s}.elev`]: elev,
    [`shoulder_${s}.rot`]: CONC.rot,
    [`elbow_${s}.flex`]: e,
    [`forearm_${s}.pro`]: CONC.pro,
    [`wrist_${s}.flex`]: 0,
    [`clavicle_${s}.prot`]: 4,
    [`grip_${s}.close`]: 1,
  })
  setScapula(skel, q, s)
}

export function concentrationContext(p: P, skel: Skeleton, tempo: Tempo): Concentration {
  const work: S = p.side === 'left' ? 'l' : 'r'
  const free: S = work === 'l' ? 'r' : 'l'
  const { x, z, toeOut } = CONC.feet
  const feet = [plantFoot(skel, 'l', [x, 0, HIP[2] + z], toeOut), plantFoot(skel, 'r', [-x, 0, HIP[2] + z], toeOut)]
  const q0 = trunk(skel, feet)
  const caps0 = bodyCapsules(skel, fk(skel, q0))
  // seat under the buttocks; the bench runs back from the lifter, its seat end under the thighs
  const seatTop = Math.min(...caps0.filter((k) => k.region === 'trunk').map((k) => Math.min(k.a[1], k.b[1]) - k.r)) + CONC.sink
  const benchSpec = bench({ backAngle: 0, seatHeight: seatTop })
  const benchPose: ImplementPose = { id: benchSpec.id, pos: [0, seatTop, HIP[2] - 0.3], rot: qid() }
  // the elbow against the inner face of the thigh near the knee: the humerus points from the shoulder to it
  const f0 = fk(skel, q0)
  const hipW = segPos(skel, f0, `femur_${work}`), kneeW = segPos(skel, f0, `tibia_${work}`)
  const thighW = bodyCapsules(skel, f0).find((k) => k.region === `thigh_${work}`)!
  const axis = norm(sub(kneeW, hipW))
  const inward = norm(reject([work === 'l' ? -1 : 1, 0, 0], axis))
  const armR = 0.045
  const elbowAt = add(add(add(hipW, scale(sub(kneeW, hipW), CONC.brace.along)), scale(inward, thighW.r + armR + CONC.brace.gap)), [0, CONC.brace.up, 0])
  const qs = trunk(skel, feet)
  setDofs(skel, qs, { [`clavicle_${work}.prot`]: 4 })
  const dir = norm(sub(elbowAt, segPos(skel, fk(skel, qs), `humerus_${work}`)))
  // the free hand flat on its thigh near the knee
  const freeQ = trunk(skel, feet)
  const f = fk(skel, freeQ)
  const hip = segPos(skel, f, `femur_${free}`), knee = segPos(skel, f, `tibia_${free}`)
  const thighCap = bodyCapsules(skel, f).find((k) => k.region === `thigh_${free}`)!
  const along = norm(sub(knee, hip))
  const at = add(add(hip, scale(sub(knee, hip), CONC.rest.along)), [0, thighCap.r + CONC.rest.above, 0])
  attachHand(skel, freeQ, free, { pos: at, axis: norm([along[2], 0, -along[0]]), palm: [0, -1, 0] }, { pole: [free === 'l' ? 1 : -1, 0, -0.3], planeHint: 60 })
  setDofs(skel, freeQ, { [`grip_${free}.close`]: 0.2 })
  const db = dumbbell({ id: `db_${work}`, mass: CONC.kg })
  const setup: Setup = {
    implements: [db, benchSpec],
    contacts: [...footContacts(skel, feet), { site: `grip_${work}`, kind: 'grip', target: { implement: db.id, grip: 'c' } }],
    tempo,
    symmetric: false,
  }
  return { tempo, setup, work, feet, dir, free: freeQ, db, benchPose }
}

const FREE_DOFS = ['scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev', 'clavicle_*.prot', 'clavicle_*.elev', 'grip_*.close']

export function sampleConcentration(u: number, skel: Skeleton, v: Concentration): Pose {
  const q = trunk(skel, v.feet)
  const s = v.work === 'l' ? 'r' : 'l'
  for (const k of FREE_DOFS) q[skel.dof[k.replace('*', s)]] = v.free[skel.dof[k.replace('*', s)]]
  workArm(skel, q, v.work, v.dir, lerp(CONC.elbow[0], CONC.elbow[1], phaseAt(u, v.tempo).c))
  const h = handFrame(skel, fk(skel, q), v.work)
  return { q, implements: [{ id: v.db.id, pos: h.pos, rot: implementFromHand(h.axis, h.palm) }, v.benchPose], contacts: v.setup.contacts }
}
