import { bodyCapsules } from '../../collide.ts'
import { attachHand, handFrame, implementFromHand, plantFoot, root1d, solveLegs, type FootTarget } from '../../constraints.ts'
import { fk, segPos } from '../../fk.ts'
import { dumbbell, type ImplementSpec } from '../../implements.ts'
import { DRAWN_BENCH, drawnFlatBench } from '../../implements/arms.ts'
import { add, DEG, lerp, norm, qaxis, qfromBasis, qmul, scale, sub, type Quat, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'
import { footContacts, setArm, type Base, type P, type Sampled } from './common.ts'

/**
 * Dumbbell kickback (717). The free side's knee and hand on a flat bench, the working side's foot on the floor, the
 * trunk nearly level (torsoAngle 80) and still. The working upper arm lies along the trunk, raised level with the
 * floor and tucked beside the ribs, and stays there (research kickback: shoulder extended, elbow ~90-120 -> 0); the
 * forearm hangs vertical at the bottom (elbow ~95, the cue's right angle) and the elbow straightens until the arm
 * points straight back with the dumbbell beside the hip. Neutral grip.
 */
const KICK = {
  kg: 8,
  benchTop: 0.44,
  /** knee and hand sink into the bench pad, m */
  sink: 0.005,
  /** the supporting hand's grip centre sits this far past the pad's front edge: the fingers hang over it, m */
  over: 0.03,
  /** the supporting hand tips its fingers down over the edge, which spares the wrist some extension, deg */
  pitch: 20,
  /** kneeling leg knee flexion, deg; the pad's back end stops this far short of its ankle, m */
  knee: 90,
  footOff: 0.03,
  /** working upper arm: out from the ribs, deg; elbow at lockout and at the bottom, deg */
  abd: 10,
  lock: 5,
  bottom: 95,
  /** standing foot: beside the bench, a little behind the hip (m), turned out (deg) */
  foot: { x: 0.35, z: -0.1, toeOut: 15 },
}

type Side = 'l' | 'r'

export type Kickback = Base & {
  kind: 'kickback'
  work: Side
  free: Side
  hip: V3
  tilt: number
  feet: FootTarget[]
  db: ImplementSpec
  benchPose: ImplementPose
  support: { pos: V3; hand: Quat }
  /** working arm flexion against the thorax (negative: extension), deg */
  flex: number
}

const lat = (s: Side) => (s === 'l' ? 1 : -1)

/** flat hand, palm down, fingers forward (+Z) tipped `pitch` deg down over the pad's edge; left, the right mirrored */
function flatHand(side: Side, pitch: number): Quat {
  return qmul(qaxis([1, 0, 0], pitch * DEG), side === 'l' ? qfromBasis([0, 1, 0], [0, 0, -1]) : qfromBasis([0, -1, 0], [0, 0, -1]))
}

function posture(skel: Skeleton, q: Float64Array, v: Pick<Kickback, 'work' | 'free'>, hip: V3, tilt: number) {
  const { work, free } = v
  setDofs(skel, q, {
    'lumbar.flex': 0,
    'thorax.flex': 2,
    'neck.flex': -18,
    'head.flex': -8,
    [`clavicle_${work}.prot`]: -4,
    [`clavicle_${free}.prot`]: 4,
    [`clavicle_${free}.elev`]: 2,
    [`hip_${free}.flex`]: tilt,
    [`hip_${free}.abd`]: 2,
    [`knee_${free}.flex`]: KICK.knee,
    [`ankle_${free}.df`]: -35,
    'grip_*.close': 1,
  })
  setPelvis(skel, q, hip, tilt)
}

function trunkAngle(skel: Skeleton, q: Float64Array) {
  const f = fk(skel, q)
  const hips = scale(add(segPos(skel, f, 'femur_l'), segPos(skel, f, 'femur_r')), 0.5)
  const sh = scale(add(segPos(skel, f, 'humerus_l'), segPos(skel, f, 'humerus_r')), 0.5)
  return (Math.acos(norm(sub(sh, hips))[1]) * 180) / Math.PI
}

/** the body without the arms: kneeling leg, trunk, the standing leg to its planted foot */
function base(skel: Skeleton, v: Kickback) {
  const q = zeroQ(skel)
  posture(skel, q, v, v.hip, v.tilt)
  solveLegs(skel, q, v.feet)
  return q
}

/** supporting arm: the flat hand on the pad, elbow soft and pointing back */
function supportArm(skel: Skeleton, q: Float64Array, v: Pick<Kickback, 'free' | 'support'>) {
  attachHand(skel, q, v.free, { pos: v.support.pos, axis: [1, 0, 0], palm: [0, -1, 0], hand: v.support.hand }, { pole: [lat(v.free) * 0.4, 0.1, -1], planeHint: 90 })
  q[skel.dof[`grip_${v.free}.close`]] = 0
}

function workArm(skel: Skeleton, q: Float64Array, v: Kickback, e: number) {
  const keep = Float64Array.from(q)
  // setArm writes both sides (the left chart, mirrored by the rig): pose it, then restore the free side
  setArm(skel, q, { flex: v.flex, abd: KICK.abd, rot: 0, elbow: e, pro: 0, wrist: 0 })
  for (const k of ['scapula', 'shoulder', 'elbow', 'forearm', 'wrist', 'grip']) {
    for (const [name, i] of Object.entries(skel.dof)) if (name.startsWith(`${k}_${v.free}.`)) q[i] = keep[i]
  }
}

function dbPose(skel: Skeleton, q: Float64Array, v: Kickback): ImplementPose {
  const h = handFrame(skel, fk(skel, q), v.work)
  return { id: v.db.id, pos: h.pos, rot: implementFromHand(h.axis, h.palm) }
}

export function kickbackContext(p: P, skel: Skeleton, tempo: Tempo): Kickback {
  const work: Side = p.side === 'left' ? 'l' : 'r'
  const free: Side = work === 'l' ? 'r' : 'l'
  const sides = { work, free }
  const tilt = root1d((t) => {
    const q = zeroQ(skel)
    posture(skel, q, sides, [0, 1, 0], t)
    return trunkAngle(skel, q) - p.torsoAngle
  }, 30, 100, { tol: 1e-5 }).x
  // hip height: the kneeling shin rests on the pad
  const shinGap = (h: number) => {
    const q = zeroQ(skel)
    posture(skel, q, sides, [0, h, 0], tilt)
    const legs = bodyCapsules(skel, fk(skel, q)).filter((c) => c.region === `shank_${free}` || c.region === `thigh_${free}`)
    return Math.min(...legs.map((c) => Math.min(c.a[1], c.b[1]) - c.r)) - (KICK.benchTop - KICK.sink)
  }
  const hip: V3 = [0, root1d(shinGap, 0.6, 1.3, { tol: 1e-6 }).x, 0]
  const q0 = zeroQ(skel)
  posture(skel, q0, sides, hip, tilt)
  const f0 = fk(skel, q0)
  const knee = segPos(skel, f0, `tibia_${free}`)
  const ankle = segPos(skel, f0, `foot_${free}`)
  const shFree = segPos(skel, f0, `humerus_${free}`)
  // bench along Z under the kneeling knee: the pointed foot hangs off its back end, the supporting hand at its front
  // end with the fingers over the edge
  const benchSpec = drawnFlatBench({ seatHeight: KICK.benchTop })
  const hinge = ankle[2] + KICK.footOff + DRAWN_BENCH.gap + DRAWN_BENCH.back.len
  const benchPose: ImplementPose = { id: benchSpec.id, pos: [knee[0], KICK.benchTop, hinge], rot: [0, 0, 0, 1] }
  const handAt: V3 = [shFree[0], KICK.benchTop, hinge + DRAWN_BENCH.seat.len + KICK.over]
  // supporting palm sunk `sink` into the pad
  const hand = flatHand(free, KICK.pitch)
  const probe = Float64Array.from(q0)
  attachHand(skel, probe, free, { pos: [handAt[0], KICK.benchTop + 0.05, handAt[2]], axis: [1, 0, 0], palm: [0, -1, 0], hand }, { pole: [lat(free) * 0.4, 0.1, -1], planeHint: 90 })
  const palms = bodyCapsules(skel, fk(skel, probe)).filter((c) => c.region === `hand_${free}` && c.name.startsWith('palm'))
  const drop = KICK.benchTop + 0.05 - Math.min(...palms.map((c) => Math.min(c.a[1], c.b[1]) - c.r))
  const supportPos: V3 = [handAt[0], KICK.benchTop - KICK.sink + drop, handAt[2]]
  benchSpec.sites = { ...benchSpec.sites, hand: { pos: sub(supportPos, benchPose.pos), normal: [0, 1, 0] } }
  const feet = [plantFoot(skel, work, [lat(work) * KICK.foot.x, 0, KICK.foot.z], KICK.foot.toeOut)]
  const db = dumbbell({ id: `db_${work}`, mass: KICK.kg })
  const contacts: Contact[] = [
    ...footContacts(skel, feet),
    { site: `grip_${free}`, kind: 'support', target: { implement: benchSpec.id, grip: 'hand' } },
    { site: `grip_${work}`, kind: 'grip', target: { implement: db.id, grip: 'c' } },
  ]
  // the supporting palm rests on the pad
  const setup: Setup = { implements: [db, benchSpec], contacts, tempo, symmetric: false, rests: [{ implement: benchSpec.id, regions: [`hand_${free}`], tol: 15 }] }
  // upper arm level with the floor: extended past the trunk line by the trunk's rise from level
  const flex = -(90 - p.torsoAngle)
  return { kind: 'kickback', tempo, setup, work, free, hip, tilt, feet, db, benchPose, support: { pos: supportPos, hand }, flex }
}

export function sampleKickback(u: number, _p: P, skel: Skeleton, v: Kickback): Sampled {
  const c = phaseAt(u, v.tempo).c
  const q = base(skel, v)
  supportArm(skel, q, v)
  workArm(skel, q, v, lerp(KICK.bottom, KICK.lock, c))
  return { q, implements: [dbPose(skel, q, v), v.benchPose] }
}
