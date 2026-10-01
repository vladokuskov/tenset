import { bodyCapsules, capsuleSolidClearance, placeParts, solidClearance } from '../../collide.ts'
import { DEV_BAND, plantFoot, root1d, softBand, solveLegs, type FootTarget } from '../../constraints.ts'
import { fk, sitePos } from '../../fk.ts'
import { bench, dumbbell, type ImplementSpec } from '../../implements.ts'
import { cross, DEG, dot, eulerFrom, lerp, norm, qconj, qfromBasis, qid, qmul, qrot, RAD, scale, sub, type Quat, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type ImplementPose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'
import { armDir, footContacts, lowest, mirrorArm, setOverheadShoulder, type Base, type P, type Sampled } from './common.ts'

/**
 * Seated overhead dumbbell extension (716). Upright against the bench's back pad, feet flat. One dumbbell in both
 * hands, palms flat under the top head either side of the handle, fingers back (the diamond hold). The upper arms stay
 * put at shoulderFlexion (research overhead ~170), drawn in so the elbows sit beside the head; only the elbows move,
 * from lockout to ~110-135 deg with the forearms folding behind the head. The dumbbell leans back a little (lower
 * end behind the head, clear of the forearms) and hangs more upright at the stretch. Each frame the humerus keeps its
 * direction; its roll (the elbows' bend plane) is solved so both hands stay on the one dumbbell, and the forearm turn
 * and wrist follow the dumbbell's lean.
 */
const SEATED = {
  hip: [0, 0.56, 0] as V3,
  sink: 0.006,
  tilt: -4,
  kg: 14,
  lock: 5,
  maxElbow: 135,
  /**
   * humerus flexion against the thorax past the record's value, and its inward tilt, deg: the elbows point up beside
   * the head and the straight arms meet under the plate. Elevation stays past 160 deg, where the humeral twist is
   * a chart artefact (gates.ts POLE_ELEV)
   */
  lift: 6,
  inward: 18,
  /** dumbbell lean from vertical (lower end back) at lockout and at the stretch, deg */
  lean: [22, 10],
  /** smallest gap of the dumbbell and hands to the pad, head, neck and upper back at the stretch, m */
  clear: 0.012,
}
/** dumbbell frame: X up the handle, Y forward, Z to the lifter's left; the left hand flat under the top head */
const PLATE = { site: [0.035, -0.02, 0.06] as V3, fingers: [0.25, -1, 0.2] as V3, palm: [1, 0, -0.45] as V3 }

export type Seated = Base & {
  kind: 'seated'
  elbow: readonly [number, number]
  feet: FootTarget[]
  /** humerus direction in the thorax frame (left) */
  u: V3
  db: ImplementSpec
  benchPose: ImplementPose
}

/** the left hand in the dumbbell frame: pinky-to-index line and palm */
function plateHand(): { axis: V3; palm: V3 } {
  const f = norm(PLATE.fingers)
  const p0 = norm(PLATE.palm)
  const palm = norm(sub(p0, scale(f, dot(p0, f))))
  return { axis: cross(palm, f), palm }
}

/** the left hand's grip frame (axis, palm) in the dumbbell frame */
const HAND_IN_DB: Quat = (() => {
  const { axis, palm } = plateHand()
  return qfromBasis(axis, palm)
})()

function seatedBase(skel: Skeleton, feet?: FootTarget[]) {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': 2, 'thorax.flex': 1, 'neck.flex': 8, 'head.flex': 2, 'clavicle_*.prot': 2, 'clavicle_*.elev': 6, 'grip_*.close': 1 })
  setPelvis(skel, q, SEATED.hip, SEATED.tilt)
  if (feet) solveLegs(skel, q, feet)
  return q
}

/** dumbbell rotation leaning `lean` deg from vertical, lower end back (local Z on the lifter's left) */
function dbRotation(lean: number): Quat {
  const up: V3 = [0, Math.cos(lean * DEG), Math.sin(lean * DEG)]
  return qfromBasis(up, cross([1, 0, 0], up))
}

/** forearm turn and wrist angles (deg) that bring the left hand's grip frame onto `grip`, inside the joint limits */
function wristTo(skel: Skeleton, q: Float64Array, grip: Quat) {
  const names = ['forearm_l.pro', 'wrist_l.flex', 'wrist_l.dev']
  for (const n of names) q[skel.dof[n]] = 0
  const f = fk(skel, q)
  const site = skel.data.sites.grip_l
  const hand = qmul(grip, qconj(qfromBasis(site.axis!, site.normal!)))
  const e = eulerFrom(qmul(qconj(f.rot[skel.seg.forearm_l]), hand), 1, 2, 0)
  const axes = [1, 2, 0]
  names.forEach((n, i) => {
    const d = skel.dofs[skel.dof[n]]
    // saturate smoothly inside the range (deviation inside its comfortable band), so frames stay smooth
    q[skel.dof[n]] = softBand((e[i] * RAD) / d.axis[axes[i]], i === 2 ? DEV_BAND : [d.min + 2, d.max - 2])
  })
}

/** both arms (mirrored): humerus on u with its roll, the elbow, and the hand turned onto the grip frame */
function arms(skel: Skeleton, q: Float64Array, u: V3, roll: number, elbow: number, grip: Quat) {
  setOverheadShoulder(skel, q, u, roll)
  q[skel.dof['elbow_l.flex']] = elbow
  wristTo(skel, q, grip)
  mirrorArm(skel, q)
}

function seatedFrame(skel: Skeleton, v: Seated, base: Float64Array, c: number, elbow = v.elbow) {
  const e = lerp(elbow[1], elbow[0], c)
  const rot = dbRotation(lerp(SEATED.lean[1], SEATED.lean[0], c))
  const grip = qmul(rot, HAND_IN_DB)
  const q = Float64Array.from(base)
  const gripAt = (roll: number) => {
    q.set(base)
    arms(skel, q, v.u, roll, e, grip)
    return sitePos(skel, fk(skel, q), 'grip_l')
  }
  // the roll that puts the left grip on the site's lateral offset: the right mirrors onto the other site
  const roll = root1d((r) => gripAt(r)[0] - PLATE.site[2], -40, 90, { tol: 1e-7, scan: 13 }).x
  const g = gripAt(roll)
  const pos = sub([0, g[1], g[2]], qrot(rot, [PLATE.site[0], PLATE.site[1], 0]))
  return { q, pose: { id: 'db', pos, rot } as ImplementPose }
}

export function seatedContext(p: P, skel: Skeleton, tempo: Tempo): Seated {
  const half = skel.segments[skel.seg.femur_l].offset[0] + 0.06
  const z = SEATED.hip[2] + skel.segments[skel.seg.femur_l].length + 0.08
  const feet = [plantFoot(skel, 'l', [half, 0, z], 12), plantFoot(skel, 'r', [-half, 0, z], 12)]
  const q0 = seatedBase(skel, feet)
  const caps = bodyCapsules(skel, fk(skel, q0))
  const trunk = caps.filter((k) => k.region === 'trunk')
  // seat under the buttocks, back pad against the back (both sunk `sink` into the padding)
  const seatTop = lowest(caps, ['trunk']) + SEATED.sink
  const back = Math.min(...trunk.map((k) => Math.min(k.a[2], k.b[2]) - k.r)) + SEATED.sink
  // the drawn bench's back pad top sits 0.745 m above its seat top (props sockets BENCH)
  const benchSpec = bench({ backAngle: 90, seatHeight: seatTop, backLength: 0.745 })
  const benchPose: ImplementPose = { id: benchSpec.id, pos: [0, seatTop, back], rot: qid() }
  const db = dumbbell({ id: 'db', mass: SEATED.kg })
  const { axis } = plateHand()
  const [cx, cy, cz] = PLATE.site
  db.sites.cup_l = { pos: [cx, cy, cz], axis }
  db.sites.cup_r = { pos: [cx, cy, -cz], axis: [axis[0], axis[1], -axis[2]] }
  const contacts = footContacts(skel, feet)
  contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: 'db', grip: 'cup_l' } }, { site: 'grip_r', kind: 'grip', target: { implement: 'db', grip: 'cup_r' } })
  // the palms press on the top head
  const setup: Setup = { implements: [db, benchSpec], contacts, tempo, symmetric: true, rests: [{ implement: 'db', regions: ['hand_l', 'hand_r'], tol: 15 }] }
  const v: Seated = { kind: 'seated', tempo, setup, elbow: [SEATED.lock, SEATED.maxElbow], feet, u: [0, 1, 0], db, benchPose }
  v.u = armDir(p.shoulderFlexion + SEATED.lift, -SEATED.inward)
  // lower the dumbbell until it and the hands come within `clear` of the back pad, the head, the neck or the upper back
  const pad = placeParts(benchSpec, benchPose)[1]
  const gap = (e: number) => {
    const { q, pose } = seatedFrame(skel, v, q0, 0, [SEATED.lock, e])
    const all = bodyCapsules(skel, fk(skel, q))
    const arms_ = all.filter((k) => /^(hand|forearm)_/.test(k.region))
    const body = all.filter((k) => k.region === 'head' || k.region === 'neck' || k.region === 'trunk')
    const solids = placeParts(db, pose)
    return Math.min(
      ...solids.map((sd) => solidClearance(sd, pad)),
      ...arms_.map((k) => capsuleSolidClearance(k, pad)),
      ...solids.flatMap((sd) => body.map((k) => capsuleSolidClearance(k, sd))),
    ) - SEATED.clear
  }
  if (gap(SEATED.maxElbow) < 0) v.elbow = [SEATED.lock, root1d(gap, 80, SEATED.maxElbow, { tol: 1e-4 }).x]
  return v
}

export function sampleSeated(u: number, _p: P, skel: Skeleton, v: Seated): Sampled {
  const { q, pose } = seatedFrame(skel, v, seatedBase(skel, v.feet), phaseAt(u, v.tempo).c)
  return { q, implements: [pose, v.benchPose] }
}
