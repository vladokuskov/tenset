import { attachHand } from '../constraints.ts'
import { bodyCapsules, restAgainst, type Capsule } from '../collide.ts'
import { fk, segPos } from '../fk.ts'
import { kneeLever, kneeMachine, KNEE_MACHINE, machineHandles, padBox } from '../implements/legs-knee.ts'
import type { ImplementSpec, Part } from '../implements.ts'
import { add, cross, DEG, neg, norm, qaxis, qconj, qfromBasis, qid, qrot, scale, sub, type Quat, type V3 } from '../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Skeleton } from '../skeleton.ts'
import { setPelvis } from './standing.ts'

// Seated knee machines (leg extension, seated leg curl): the pelvis sits on the seat with the thighs level and the
// knee axis on the machine's pivot, the trunk rests on a back pad set by the hip angle, the hands hold side handles by
// the hips. Seat, back pad and the lever's roller are placed against the measured body (collide.ts restAgainst), so
// the drawn machine fits the figure instead of guessed offsets.

type Box = Extract<Part, { shape: 'box' }>

/** hip joint midpoint: high enough that the feet hang clear of the floor with the knees at 90 deg */
export const SEAT_HIP: V3 = [0, 0.64, 0]
/** seat pan tilt, front edge up (deg) and its front edge behind the knee axis (m): the calves clear it at 90+ deg */
const SEAT = { tilt: 6, length: 0.4, width: 0.4 }
/** seat front edge behind the knee axis: the calves clear it at 90 deg (extension) and at the deep curl */
const SEAT_GAP = { leg_extension: 0.13, leg_curl_seated: 0.21 }
const BACK = { width: 0.36, length: 0.62 }
/** seated curl thigh pad: centre behind the knee axis and depth, m (on the lower thigh, clear of the knee's skin fold) */
const THIGH_PAD = { back: 0.2, depth: 0.14 }
/** roller axle distance from the knee along the shin (just above the ankle) */
export const ROLLER_ALONG = 0.37
/** padding the body sinks into, m */
export const SINK = -0.01
const ARM_DOFS = ['clavicle_*.prot', 'clavicle_*.elev', 'scapula_*.uprot', 'shoulder_*.plane', 'shoulder_*.elev', 'shoulder_*.rot', 'elbow_*.flex', 'forearm_*.pro', 'wrist_*.flex', 'wrist_*.dev', 'grip_*.close']

/** the left arm's DOFs copied to both sides, as [index, value] pairs */
export function mirroredArms(skel: Skeleton, q: Float64Array): [number, number][] {
  return ARM_DOFS.flatMap((k) => {
    const x = q[skel.dof[k.replace('*', 'l')]]
    return [[skel.dof[k.replace('*', 'l')], x], [skel.dof[k.replace('*', 'r')], x]] as [number, number][]
  })
}

/** seated trunk, pelvis and gaze for a hip angle (deg, 90 upright, smaller reclined): thighs level, spine neutral */
export function seatBody(skel: Skeleton, q: Float64Array, hipAngle: number) {
  const tilt = hipAngle - 90
  setDofs(skel, q, { 'hip_*.flex': hipAngle, 'lumbar.flex': 3, 'thorax.flex': 3, 'ankle_*.df': 4, 'clavicle_*.prot': -4, 'grip_*.close': 1 })
  setPelvis(skel, q, SEAT_HIP, tilt)
  const pitch = tilt + 6
  setDofs(skel, q, { 'neck.flex': 4 - 0.45 * pitch, 'head.flex': -0.25 * pitch })
}

/** knee axis (pivot) centre, world */
export function kneeAxis(skel: Skeleton, q: Float64Array): V3 {
  const f = fk(skel, q)
  return scale(add(segPos(skel, f, 'tibia_l'), segPos(skel, f, 'tibia_r')), 0.5)
}

/** lever pose for knee flexion k: the lever turns with the shin about the pivot; `base` 180 for a prone lifter */
export function leverPose(pivot: V3, knee: number, base = 0): ImplementPose {
  return { id: 'lever', pos: pivot, rot: qaxis([1, 0, 0], (base + knee) * DEG) }
}

/**
 * Roller axle height in the lever frame, resting against the shins at ROLLER_ALONG from the knee: `front` on the shin
 * (extension), else behind it (curl). `pose` is the lever pose for the body in `caps`.
 */
export function rollerOnShins(caps: Capsule[], pose: ImplementPose, front: boolean): number {
  const toLever = (p: V3): V3 => qrot(qconj(pose.rot), sub(p, pose.pos))
  const shins = caps.filter((c) => /^(shank|foot)_[lr]$/.test(c.region)).map((c) => ({ ...c, a: toLever(c.a), b: toLever(c.b) }))
  const { r, half } = KNEE_MACHINE.roller
  const roller = restAgainst(shins, { shape: 'cylinder', a: [-half, 0, ROLLER_ALONG], b: [half, 0, ROLLER_ALONG], r, pad: true }, [0, front ? 1 : -1, 0], SINK)
  return roller.a[1]
}

export type SeatedMachine = {
  machine: ImplementSpec
  lever: ImplementSpec
  handles: ImplementSpec
  pivot: V3
  /** arm DOFs, solved once (left) and mirrored */
  arms: [number, number][]
  contacts: Contact[]
}

/**
 * Seat, back pad, lever roller and handles for a seated knee machine, fitted to the body at hip angle `hipAngle`.
 * `side` puts the roller on the front of the shins (extension) or behind them (curl); `thighPad` adds the seated
 * curl's pad over the knees.
 */
export function seatedMachine(skel: Skeleton, o: { hipAngle: number; kind: 'leg_extension' | 'leg_curl_seated'; knee: number }): SeatedMachine {
  const q = zeroQ(skel)
  seatBody(skel, q, o.hipAngle)
  setDofs(skel, q, { 'knee_*.flex': o.knee })
  const f = fk(skel, q)
  const caps = bodyCapsules(skel, f)
  const pivot = kneeAxis(skel, q)
  const pads: Record<string, Box> = {}

  // seat pan: under the glutes and thighs, front edge behind the knee crease
  const t = SEAT.tilt * DEG
  const seatRot: Quat = [Math.sin(-t / 2), 0, 0, Math.cos(t / 2)]
  const nSeat = qrot(seatRot, [0, 1, 0])
  const front = pivot[2] - SEAT_GAP[o.kind]
  const seatGuess: V3 = [0, SEAT_HIP[1] - 0.2, front - (SEAT.length / 2) * Math.cos(t)]
  const under = caps.filter((c) => /^thigh_/.test(c.region) || (c.region === 'trunk' && c.segment === 'pelvis'))
  pads.seat = restAgainst(under, padBox(seatGuess, [SEAT.width, KNEE_MACHINE.pad.thick, SEAT.length], seatRot), neg(nSeat), SINK)

  // back pad behind the trunk, along it from the lower back up
  const pel = segPos(skel, f, 'pelvis'), neck = segPos(skel, f, 'neck1')
  const up = norm(sub(neck, pel))
  const behind = norm(cross(up, [1, 0, 0]))
  const backRot = qfromBasis([1, 0, 0], neg(behind))
  const backGuess = add(add(pel, scale(up, 0.08 + BACK.length / 2)), scale(behind, 0.16))
  const trunk = caps.filter((c) => c.region === 'trunk' && c.segment !== 'pelvis')
  pads.back = restAgainst(trunk, padBox(backGuess, [BACK.width, KNEE_MACHINE.pad.thick, BACK.length], backRot), behind, SINK)

  if (o.kind === 'leg_curl_seated') {
    // pad over the lower thighs just above the knees, pressing down
    const thighs = caps.filter((c) => /^thigh_/.test(c.region))
    pads.thigh = restAgainst(thighs, padBox([0, pivot[1] + 0.12, pivot[2] - THIGH_PAD.back], [0.44, KNEE_MACHINE.pad.thick, THIGH_PAD.depth]), [0, 1, 0], SINK)
  }

  // roller on the shins, placed in the lever frame (the lever turns with the shin, so any knee angle fits)
  const lever = kneeLever({ roller: [0, rollerOnShins(caps, leverPose(pivot, o.knee), o.kind === 'leg_extension'), ROLLER_ALONG] })

  // hands on short bars by the hips; the left arm is solved and mirrored
  // handles low beside the seat: the arms hang nearly straight with the elbows back
  const seatTop = pads.seat.center[1] + KNEE_MACHINE.pad.thick / 2
  const hold = (s: 1 | -1) => ({ pos: [s * 0.27, seatTop + 0.03, SEAT_HIP[2] + 0.12] as V3, axis: norm([0, 0.25, 1]) })
  const handles = machineHandles({ l: hold(1), r: hold(-1) })
  attachHand(skel, q, 'l', { pos: hold(1).pos, axis: hold(1).axis, palm: [-1, 0, 0] }, { pole: [0.35, -0.3, -1], planeHint: 20, wristBias: 5 })
  const arms = mirroredArms(skel, q)

  const machine = kneeMachine({ kind: o.kind, pads, pivot, stack: [0.62, 0, pivot[2] - 0.42] })
  const contacts: Contact[] = [
    { site: 'grip_l', kind: 'grip', target: { implement: 'handles', grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: 'handles', grip: 'r' } },
  ]
  return { machine, lever, handles, pivot, arms, contacts }
}

/** seated knee machine pose: body, arms on the handles, knee flexion; returns the implement poses */
export function seatedPose(skel: Skeleton, m: SeatedMachine, hipAngle: number, knee: number, q: Float64Array): ImplementPose[] {
  seatBody(skel, q, hipAngle)
  for (const [i, x] of m.arms) q[i] = x
  setDofs(skel, q, { 'knee_*.flex': knee })
  const fixed = { pos: [0, 0, 0] as V3, rot: qid() }
  return [{ id: m.machine.id, ...fixed }, leverPose(m.pivot, knee), { id: m.handles.id, ...fixed }]
}
