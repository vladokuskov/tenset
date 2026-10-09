import { root1d, solveLegs, type FootTarget } from '../../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { fk } from '../../fk.ts'
import { barbell, siteWorld } from '../../implements.ts'
import { bandPose, gymRings, ringAnchor, ringPose, RING_HEIGHT } from '../../implements/index.ts'
import { add, DEG, dot, qaxis, qid, qmul, qrot, sub, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'
import { ARM_DOFS, ELBOW_LAG, elbowPole, lerp, mirrorArm, monotoneCubic, phases, PROT, reach, scapularLead, shoulderMid, type P } from './common.ts'

// Ring row (322): the inverted row under gymnastic rings hung at about waist height (RING_HEIGHT.row). Heels on the
// floor, the body held in a straight line pivoting about the ankles (as row/inverted.ts). The rings hang straight under
// their straps, so the hands stay put; the palms face the feet at the hang and turn in as the chest comes up between
// the rings (neutral at the top). Shoulders protracted at the hang (elbows ~8 deg), then the scapulae set back and the
// elbows drive the chest up to the rings' level.

const HANG_ELBOW = 8
/** the line between the grips meets the chest this far below the shoulder joints along the trunk at the top, m */
const TOUCH = 0.12
/** grips' line to the chest at the top, m */
const CHEST_GAP = 0.03
const FOOT_PITCH = 62
const FEET_X = 0.1
const TOE_OUT = 5
const HEEL_SINK = 0.002

export type RingRow = {
  kind: 'rings'
  tempo: Tempo
  setup: Setup
  /** grip points (world), left and right */
  grips: [V3, V3]
  anchor: ImplementPose
  feet: FootTarget[]
  ankleMid: V3
  legLen: number
  angle: (c: number) => number
}

function bodyAt(skel: Skeleton, q: Float64Array, v: Pick<RingRow, 'feet' | 'ankleMid' | 'legLen'>, theta: number, s: number) {
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

/** the handle line through the ring: palms towards the feet (handle across) at the hang, turned in (along) at the top */
function handle(t: number): { axis: V3; palm: V3 } {
  const a = t * 90 * DEG
  return { axis: [Math.cos(a), 0, Math.sin(a)], palm: [-Math.sin(a), 0, Math.cos(a)] }
}

function arms(skel: Skeleton, q: Float64Array, p: P, grip: V3, t: number) {
  for (const k of ARM_DOFS) for (const sd of ['l', 'r']) q[skel.dof[k.replace('*', sd)]] = 0
  const h = handle(t)
  reach(skel, q, 'l', { pos: grip, ...h }, { pole: elbowPole(skel, q, 'l', p.elbowFlare, 0.35), planeHint: 90, devBand: [-22, 25] })
  mirrorArm(skel, q)
}

export function ringsContext(p: P, skel: Skeleton, tempo: Tempo): RingRow {
  const half = (p.gripWidth * skel.data.shoulderWidth) / 2
  const y = RING_HEIGHT.row
  const grips: [V3, V3] = [[half, y, 0], [-half, y, 0]]
  // framed by its floor feet only: the rig would shrink the figure, the rings and straps stay in view
  const anchorSpec = ringAnchor({ spread: 2 * half })
  const anchor: ImplementPose = { id: anchorSpec.id, pos: [0, 0, 0], rot: qid() }
  // a virtual bar through the grips, for the chest's reach to the rings' line
  const line = barbell({ gripWidth: 2 * half, plateKg: 0 })
  const linePose: ImplementPose = { id: 'line', pos: [0, y, 0], rot: qid() }
  const pitch = qaxis([1, 0, 0], -FOOT_PITCH * DEG)
  const rotOf = (side: 'l' | 'r') => qmul(pitch, qaxis([0, 1, 0], (side === 'l' ? TOE_OUT : -TOE_OUT) * DEG))
  const heelLow = (side: 'l' | 'r') => {
    const cap = Object.values(skel.data.capsules).find((c) => c.segment === `foot_${side}` && c.region === `foot_${side}` && c.r > 0.04)!
    const rot = rotOf(side)
    return Math.min(qrot(rot, cap.a)[1], qrot(rot, cap.b)[1]) - cap.r
  }
  const ankleY = -HEEL_SINK - heelLow('l')
  const lt = skel.segments[skel.seg.femur_l].length
  const ls = skel.segments[skel.seg.tibia_l].length
  const legLen = Math.sqrt(lt * lt + ls * ls + 2 * lt * ls * Math.cos(3 * DEG))
  let ankleZ = 1.4
  const feetAt = (z: number): FootTarget[] => (['l', 'r'] as const).map((side) => ({ side, rot: rotOf(side), ankle: [side === 'l' ? FEET_X : -FEET_X, ankleY, z] as V3 }))
  const v = { feet: feetAt(ankleZ), ankleMid: [0, ankleY, ankleZ] as V3, legLen }
  const elbowAt = (theta: number, s: number, t: number) => {
    const q = zeroQ(skel)
    bodyAt(skel, q, v, theta, s)
    arms(skel, q, p, grips[0], t)
    return q[skel.dof['elbow_l.flex']]
  }
  const chestGap = (theta: number) => {
    const q = zeroQ(skel)
    bodyAt(skel, q, v, theta, 1)
    const trunk = bodyCapsules(skel, fk(skel, q)).filter((c) => c.region === 'trunk' && c.segment.startsWith('thorax'))
    const shaft = placeParts(line, linePose)[0]
    return Math.min(...trunk.map((c) => capsuleSolidClearance(c, shaft))) - CHEST_GAP
  }
  // ankles placed so the rings' line meets the chest TOUCH below the shoulders at the top
  for (let pass = 0; pass < 8; pass++) {
    const top = root1d(chestGap, 10, 70, { tol: 1e-6 }).x
    const q = zeroQ(skel)
    bodyAt(skel, q, v, top, 1)
    const down = qrot(fk(skel, q).rot[skel.seg.thorax2], [0, -1, 0])
    ankleZ -= (TOUCH - dot(sub(linePose.pos, shoulderMid(skel, q)), down)) / Math.cos(top * DEG)
    v.feet = feetAt(ankleZ)
    v.ankleMid = [0, ankleY, ankleZ]
  }
  const thetaTop = root1d(chestGap, 10, 70, { tol: 1e-6 }).x
  const thetaHang = root1d((t) => elbowAt(t, 0, 0) - HANG_ELBOW, -5, thetaTop, { tol: 1e-6 }).x
  const topElbow = elbowAt(thetaTop, 1, 1)
  const cs = Array.from({ length: 9 }, (_, k) => k / 8)
  const ts = cs.map((c, k) => (k === 0 ? thetaHang : k === 8 ? thetaTop : root1d((t) => elbowAt(t, scapularLead(c), c) - lerp(HANG_ELBOW, topElbow, c ** ELBOW_LAG), thetaHang - 3, thetaTop + 3, { tol: 1e-6 }).x))
  const angle = monotoneCubic(cs, ts)
  const rings = gymRings({ anchor: anchorSpec.id })
  const contacts: Contact[] = [
    { site: 'grip_l', kind: 'grip', target: { implement: 'ring_l', grip: 'grip' } },
    { site: 'grip_r', kind: 'grip', target: { implement: 'ring_r', grip: 'grip' } },
    ...v.feet.map((ft) => ({ site: `heel_${ft.side}`, kind: 'planted' as const, target: { world: add(ft.ankle, qrot(ft.rot, skel.data.sites[`heel_${ft.side}`].local)) } })),
  ]
  const setup: Setup = { implements: [anchorSpec, ...rings], contacts, tempo, symmetric: p.laterality === 'bilateral' }
  return { kind: 'rings', tempo, setup, grips, anchor, feet: v.feet, ankleMid: v.ankleMid, legLen, angle }
}

export function sampleRings(u: number, p: P, skel: Skeleton, v: RingRow): Pose {
  const ph = phases(u, v.tempo)
  const q = zeroQ(skel)
  bodyAt(skel, q, v, v.angle(ph.c), ph.s)
  arms(skel, q, p, v.grips[0], ph.c)
  const anchorSpec = v.setup.implements[0]
  const ringSpecs = v.setup.implements.filter((s) => s.kind === 'gym_ring')
  const tops = (['l', 'r'] as const).map((s) => siteWorld(anchorSpec, v.anchor, `strap_${s}`).pos)
  const h = handle(ph.c)
  const rings = ringSpecs.map((spec, i) => ringPose(spec, v.grips[i], i === 0 ? h.axis : [h.axis[0], h.axis[1], -h.axis[2]], tops[i]))
  return { q, implements: [v.anchor, ...rings, bandPose('strap_l'), bandPose('strap_r')], contacts: v.setup.contacts }
}

