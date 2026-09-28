import { root1d, solveLegs, type FootTarget } from '../../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { fk } from '../../fk.ts'
import { barbell, siteWorld, type ImplementSpec } from '../../implements.ts'
import { rack, RACK_REST } from '../../implements/back.ts'
import { add, DEG, dot, qaxis, qmul, qrot, sub, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'
import { ELBOW_LAG, elbowPole, gripContacts, lerp, mirrorArm, monotoneCubic, phases, PROT, reach, scapularLead, shoulderMid, type P } from './common.ts'

// Inverted row under a bar resting on the J-hooks of a half rack: root driver. The hands stay on the bar and the
// heels on the floor (toes up); the body is held in a straight line and pivots about the ankles. It hangs with the
// shoulders protracted and the elbows ~8 deg, then the scapulae set back and the elbows drive the chest to the bar.
// The body angle is solved from the elbow, which follows a lagging curve while the scapulae lead (as the pull-up).

const BAR_Y: Record<P['barHeight'], number> = { low: 0.85, mid: 1.0, high: 1.15 }
/** an empty bar: plates add nothing to a bodyweight row and hide the chest from the side camera */
const PLATE_KG = 0
const HANG_ELBOW = 8
/** bar to the chest at the top, m */
const CHEST_GAP = 0.012
/** bar below the shoulder joints along the trunk at the top, m (nipple line; the sternum site sits ~0.13) */
const TOUCH = 0.14
/** foot pitch (toes up from horizontal), deg: the feet rest on the back of the heels */
const FOOT_PITCH = 62
const FEET_X = 0.1
const TOE_OUT = 5
const HEEL_SINK = 0.002

export type Inverted = {
  kind: 'inverted'
  tempo: Tempo
  setup: Setup
  bar: ImplementSpec
  barPose: ImplementPose
  rackPose: ImplementPose
  feet: FootTarget[]
  ankleMid: V3
  legLen: number
  /** body angle above horizontal at loop fraction c */
  angle: (c: number) => number
}

function bodyAt(skel: Skeleton, q: Float64Array, v: Pick<Inverted, 'feet' | 'ankleMid' | 'legLen'>, theta: number, s: number) {
  setDofs(skel, q, {
    'lumbar.flex': -1,
    'thorax.flex': lerp(1, -3, s),
    'neck.flex': 6,
    'head.flex': 4,
    'clavicle_*.prot': lerp(PROT.start, PROT.finish, s),
    'clavicle_*.elev': lerp(6, -2, s),
    'grip_*.close': 1,
  })
  const a = theta * DEG
  setPelvis(skel, q, add(v.ankleMid, [0, v.legLen * Math.sin(a), -v.legLen * Math.cos(a)]), theta - 90)
  solveLegs(skel, q, v.feet)
}

function arms(skel: Skeleton, q: Float64Array, p: P, bar: ImplementSpec, pose: ImplementPose) {
  const g = siteWorld(bar, pose, 'l')
  reach(skel, q, 'l', { pos: g.pos, axis: [1, 0, 0], palm: [0, 0, 1] }, { pole: elbowPole(skel, q, 'l', p.elbowFlare, 0.35), planeHint: 90 })
  mirrorArm(skel, q)
}

export function invertedContext(p: P, skel: Skeleton, tempo: Tempo): Inverted {
  const barY = BAR_Y[p.barHeight]
  const bar = barbell({ gripWidth: p.gripWidth * skel.data.shoulderWidth, plateKg: PLATE_KG })
  const barPose: ImplementPose = { id: bar.id, pos: [0, barY, 0], rot: [0, 0, 0, 1] }
  const rackSpec = rack({ hookHeight: barY })
  const rackPose: ImplementPose = { id: rackSpec.id, pos: [0, 0, -RACK_REST.z], rot: [0, 0, 0, 1] }
  // feet: toes up, resting on the backs of the heels
  const pitch = qaxis([1, 0, 0], -FOOT_PITCH * DEG)
  const rotOf = (side: 'l' | 'r') => qmul(pitch, qaxis([0, 1, 0], (side === 'l' ? TOE_OUT : -TOE_OUT) * DEG))
  const heelLow = (side: 'l' | 'r') => {
    const cap = Object.values(skel.data.capsules).find((c) => c.segment === `foot_${side}` && c.region === `foot_${side}` && c.r > 0.04)!
    const rot = rotOf(side)
    // capsule points relative to the ankle joint (the foot segment origin)
    return Math.min(qrot(rot, cap.a)[1], qrot(rot, cap.b)[1]) - cap.r
  }
  const ankleY = -HEEL_SINK - heelLow('l')
  const lt = skel.segments[skel.seg.femur_l].length
  const ls = skel.segments[skel.seg.tibia_l].length
  const legLen = Math.sqrt(lt * lt + ls * ls + 2 * lt * ls * Math.cos(3 * DEG))
  // ankles placed so the chest ends up under the bar at the top: solved below, start with a guess
  let ankleZ = 1.5
  const feetAt = (z: number): FootTarget[] => (['l', 'r'] as const).map((side) => ({ side, rot: rotOf(side), ankle: [side === 'l' ? FEET_X : -FEET_X, ankleY, z] as V3 }))
  const v = { feet: feetAt(ankleZ), ankleMid: [0, ankleY, ankleZ] as V3, legLen }
  const elbowAt = (theta: number, s: number) => {
    const q = zeroQ(skel)
    bodyAt(skel, q, v, theta, s)
    arms(skel, q, p, bar, barPose)
    return q[skel.dof['elbow_l.flex']]
  }
  const chestGap = (theta: number) => {
    const q = zeroQ(skel)
    bodyAt(skel, q, v, theta, 1)
    const trunk = bodyCapsules(skel, fk(skel, q)).filter((c) => c.region === 'trunk' && c.segment.startsWith('thorax'))
    const shaft = placeParts(bar, barPose)[0]
    return Math.min(...trunk.map((c) => capsuleSolidClearance(c, shaft))) - CHEST_GAP
  }
  // place the ankles so that at the top the bar meets the chest (TOUCH below the shoulder joints along the
  // trunk), not the collarbones: the grips then sit below the shoulders and the elbows drive towards the hips
  for (let pass = 0; pass < 8; pass++) {
    const top = root1d(chestGap, 10, 60, { tol: 1e-6 }).x
    const q = zeroQ(skel)
    bodyAt(skel, q, v, top, 1)
    const down = qrot(fk(skel, q).rot[skel.seg.thorax2], [0, -1, 0])
    ankleZ -= (TOUCH - dot(sub(barPose.pos, shoulderMid(skel, q)), down)) / Math.cos(top * DEG)
    v.feet = feetAt(ankleZ)
    v.ankleMid = [0, ankleY, ankleZ]
  }
  const thetaTop = root1d(chestGap, 10, 60, { tol: 1e-6 }).x
  const thetaHang = root1d((t) => elbowAt(t, 0) - HANG_ELBOW, -5, thetaTop, { tol: 1e-6 }).x
  const topElbow = elbowAt(thetaTop, 1)
  // body angle along the rep: the elbows follow a lagging curve while the scapulae lead
  const cs = Array.from({ length: 9 }, (_, k) => k / 8)
  const ts = cs.map((c, k) => (k === 0 ? thetaHang : k === 8 ? thetaTop : root1d((t) => elbowAt(t, scapularLead(c)) - lerp(HANG_ELBOW, topElbow, c ** ELBOW_LAG), thetaHang - 3, thetaTop + 3, { tol: 1e-6 }).x))
  const angle = monotoneCubic(cs, ts)
  const contacts: Contact[] = [
    ...gripContacts(bar.id),
    ...v.feet.map((ft) => ({ site: `heel_${ft.side}`, kind: 'planted' as const, target: { world: add(ft.ankle, qrot(ft.rot, skel.data.sites[`heel_${ft.side}`].local)) } })),
  ]
  const setup: Setup = { implements: [bar, rackSpec], contacts, tempo, symmetric: p.laterality === 'bilateral' }
  return { kind: 'inverted', tempo, setup, bar, barPose, rackPose, feet: v.feet, ankleMid: v.ankleMid, legLen, angle }
}

export function sampleInverted(u: number, p: P, skel: Skeleton, v: Inverted): Pose {
  const ph = phases(u, v.tempo)
  const q = zeroQ(skel)
  bodyAt(skel, q, v, v.angle(ph.c), ph.s)
  arms(skel, q, p, v.bar, v.barPose)
  return { q, implements: [v.barPose, v.rackPose], contacts: v.setup.contacts }
}
