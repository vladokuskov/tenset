import { root1d } from '../constraints.ts'
import { fk, localToWorld } from '../fk.ts'
import { siteWorld, type ImplementSpec } from '../implements.ts'
import { chestPressArms, chestPressFrame } from '../implements/press-horizontal.ts'
import { inclinePressLever } from '../implements/stations.ts'
import { add, DEG, lerp, qaxis, qid, qrot, scale, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { phaseAt, type Tempo } from '../timing.ts'
import { LOCK_ELBOW, TOUCH_Y } from './press-bench.ts'
import { flarePole, plantFeet, poleAt, restHead, seatOnPads, solidOf, solveLeftArm, trunkPose, wristSchedule, type ArmRig, type Posture } from './press-body.ts'
import type { ParamsOf } from './schemas.ts'
import type { Setup } from './types.ts'

// Seated chest press machine: the lifter sits with the back and head on a slightly reclined pad, feet planted; the
// vertical (neutral grip) handles ride on lever arms pivoting on a transverse axis near the floor in front, so the
// handles travel forward on a flat arc (the pivot sits under mid-stroke). The seat is set so the handles line up
// with mid-chest; the stroke runs from the hands level with the front of the chest to soft elbows. The elbow
// pole sets `elbowFlare` at the start, as on the bench.
// Incline machine (incline-press, implement machine): the same machine with the back pad reclined further and the
// lever pivot moved forward and down (implements/stations.ts inclinePressLever), so the handles start at the upper
// chest and travel up and forward on an arc whose mid-stroke tangent rises at `benchAngle` above horizontal.

type P = ParamsOf<'horizontal-press'> | ParamsOf<'incline-press'>

const SEAT_H = 0.46
/** back pad lean from vertical, deg */
const RECLINE = 12
const SINK = 0.01
const POSTURE: Posture = { tilt: -RECLINE + 4, lumbar: -4, thorax: -2, clavicle: { prot: -12, elev: -3 } }
/** handles at the start this far behind the front of the chest, m (further back takes the upper arm past ~40 deg of horizontal abduction) */
const START_BEHIND = 0.01
/** lever pivot height, m */
const PIVOT_Y = 0.12
const KNEE = 85
const FEET_HALF = 0.2
/** neutral wrists on the vertical handles */
const WRIST_EXT = 3
/**
 * Incline machine: back pad lean from vertical, deg, and the posture on it; the handles start this far up the chest
 * (thorax2 frame, as TOUCH_Y) and this far behind its front, m; lever length from the pivot to the handles, m
 */
const INCLINE = { recline: 20, posture: { tilt: -16, lumbar: -4, thorax: -2, clavicle: { prot: -12, elev: -3 } } as Posture, touch: 0.02, behind: 0.02, reach: 1.0 }

export type MachineCtx = {
  kind: 'machine'
  tempo: Tempo
  setup: Setup
  base: Float64Array
  arms: ImplementSpec
  pivot: V3
  /** lever angle from vertical at the start and the end of the press, deg (+ towards the feet) */
  swing: [number, number]
  rig: ArmRig
}

export function unsupportedMachine(p: P): string | null {
  if (p.machine !== 'chest_press_machine') return `machine ${p.machine}`
  if (p.posture !== 'seated') return `machine ${p.posture}`
  if (p.grip !== 'neutral') return `machine grip ${p.grip}`
  if (p.laterality !== 'bilateral') return p.laterality
  return null
}

/** the lever pair turned `deg` about the pivot axis: origin between the handles, `reach` up the levers */
function armPose(ctx: Pick<MachineCtx, 'pivot' | 'arms'>, deg: number): ImplementPose {
  const rot = qaxis([1, 0, 0], deg * DEG)
  return { id: 'handles', pos: add(ctx.pivot, qrot(rot, [0, -ctx.arms.sites.pivot.pos[1], 0])), rot }
}

function gripOn(arms: ImplementSpec, pose: ImplementPose) {
  const s = siteWorld(arms, pose, 'l')
  return { pos: s.pos, axis: s.axis! }
}

export function machineContext(p: P, skel: Skeleton, tempo: Tempo, o: { incline?: number } = {}): MachineCtx {
  const inc = o.incline
  const posture = inc === undefined ? POSTURE : INCLINE.posture
  const frame = chestPressFrame({ seatHeight: SEAT_H, recline: inc === undefined ? RECLINE : INCLINE.recline, backBottom: [0, SEAT_H + 0.03, 0] })
  const framePose: ImplementPose = { id: 'machine', pos: [0, 0, 0], rot: qid() }
  const hip = seatOnPads(skel, posture, solidOf(frame, framePose, 0), solidOf(frame, framePose, 1), [SEAT_H + 0.09, 0.12], SINK)
  const base = zeroQ(skel)
  trunkPose(skel, base, hip, posture)
  // head up with a level gaze, just in front of the pad (resting it there tips the face up to the ceiling); on the
  // incline machine the head rests on the pad (cue)
  const pitch = posture.tilt + posture.lumbar + posture.thorax
  if (inc === undefined) setDofs(skel, base, { 'neck.flex': -pitch / 1.4, 'head.flex': (-pitch / 1.4) * 0.4 })
  else restHead(skel, base, solidOf(frame, framePose, 1))
  const legs = plantFeet(skel, base, hip, KNEE, FEET_HALF)
  const f0 = fk(skel, base)
  // handles level with mid-chest (the nipple line), starting level with the front of the chest (incline: the upper chest)
  const chest = localToWorld(skel, f0, 'thorax2', [0, inc === undefined ? TOUCH_Y.flat : INCLINE.touch, 0.22])
  const g = (p.gripWidth * skel.data.shoulderWidth) / 2
  const rig: ArmRig = { pole: poleAt(40, 0.6, -1), palm: [-1, 0, 0], wristBias: WRIST_EXT }
  const hand = (pos: V3, pole = rig.pole) => {
    const q = Float64Array.from(base)
    solveLeftArm(skel, q, { pos, axis: [0, 1, 0] }, { ...rig, pole })
    return q
  }
  const start: V3 = [g, chest[1], chest[2] - (inc === undefined ? START_BEHIND : INCLINE.behind)]
  // flare at the start: the pole leans from straight back (0) out to the side (90)
  rig.pole = flarePole(skel, p.elbowFlare, (pole) => hand(start, pole), (th) => poleAt(th, 0.6, -1), [5, 120])
  let reach: number, swing: number, pivot: V3
  if (inc === undefined) {
    const endZ = root1d((z) => hand([g, start[1], z])[skel.dof['elbow_l.flex']] - LOCK_ELBOW, start[2], start[2] + 0.8, { tol: 1e-6 }).x
    // the pivot sits under mid-stroke, so both ends of the arc are at handle height
    const half = (endZ - start[2]) / 2
    reach = Math.hypot(start[1] - PIVOT_Y, half)
    swing = (Math.atan2(half, start[1] - PIVOT_Y) / DEG)
    pivot = [0, PIVOT_Y, start[2] + half]
  } else {
    // a straight press up the incline sets the stroke; the lever pivot sits below and in front of its middle
    const dir: V3 = [0, Math.sin(inc * DEG), Math.cos(inc * DEG)]
    const d = root1d((s) => hand(add(start, scale(dir, s)))[skel.dof['elbow_l.flex']] - LOCK_ELBOW, 0, 0.8, { tol: 1e-6 }).x
    const lever = inclinePressLever({ mid: add(start, scale(dir, d / 2)), incline: inc, reach: INCLINE.reach, stroke: d })
    reach = INCLINE.reach
    pivot = [0, lever.pivot[1], lever.pivot[2]]
    // armPose turns the lever by -swing at the start
    swing = -lever.swing[0]
  }
  const arms = chestPressArms({ gripHalf: g, reach })
  // second pass on the real levers (the handles lean with them): flare at the start, soft elbows at the end
  const lever = { pivot, arms }
  const onLever = (deg: number, pole = rig.pole) => {
    const q = Float64Array.from(base)
    solveLeftArm(skel, q, gripOn(arms, armPose(lever, deg)), { ...rig, pole })
    return q
  }
  rig.pole = flarePole(skel, p.elbowFlare, (pole) => onLever(-swing, pole), (th) => poleAt(th, 0.6, -1), [5, 120])
  const range: [number, number] = inc === undefined ? [0, 2 * swing + 10] : [-swing, 60 - swing]
  const end = root1d((deg) => onLever(deg)[skel.dof['elbow_l.flex']] - LOCK_ELBOW, range[0], range[1], { tol: 1e-6 }).x
  rig.oblique = wristSchedule((c, o) => {
    const q = Float64Array.from(base)
    solveLeftArm(skel, q, gripOn(arms, armPose(lever, lerp(-swing, end, c))), { ...rig, oblique: () => o }, c, true)
    return q[skel.dof['wrist_l.dev']]
  })
  const contacts: Contact[] = [
    ...legs.contacts,
    { site: 'grip_l', kind: 'grip', target: { implement: 'handles', grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: 'handles', grip: 'r' } },
  ]
  const setup: Setup = { implements: [arms, frame], contacts, tempo, symmetric: true }
  return { kind: 'machine', tempo, setup, base, arms, pivot, swing: [-swing, end], rig }
}

export function sampleMachine(u: number, skel: Skeleton, ctx: MachineCtx): Pose {
  const c = phaseAt(u, ctx.tempo).c
  const pose = armPose(ctx, lerp(ctx.swing[0], ctx.swing[1], c))
  const q = Float64Array.from(ctx.base)
  solveLeftArm(skel, q, gripOn(ctx.arms, pose), ctx.rig, c)
  return { q, implements: [pose, { id: 'machine', pos: [0, 0, 0], rot: qid() }], contacts: ctx.setup.contacts }
}
