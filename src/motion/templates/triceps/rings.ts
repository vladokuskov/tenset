import { bodyCapsules } from '../../collide.ts'
import { attachHand, root1d } from '../../constraints.ts'
import { fk, sitePos } from '../../fk.ts'
import { RING_HEIGHT } from '../../implements/index.ts'
import { lerp, norm, qrot, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { ringContacts, ringPoses, ringRig, ringSpread, type RingRig } from '../rings.ts'
import type { Setup } from '../types.ts'
import { mirrorArm, type Base, type P, type Sampled } from './common.ts'

/**
 * Ring triceps extension (743): standing, leaning into gymnastic rings held at chest height (RING_HEIGHT), the body a
 * rigid plank from the balls of the feet to the head, as in the push-up. The hands stay on the rings, palms down and
 * forwards, and the elbows bend towards the floor in front so the body tips forward until the forehead passes between
 * the rings (elbow ~115-125); the elbows straighten again to lockout with the body back at its lean. Only the elbows and
 * the body's lean change, the upper arms staying beside the head (a standing skull crusher against body weight).
 * Feet: flat while the lean is under `RING_EXT.flat` deg from vertical, beyond that the heels lift.
 */
export const RING_EXT = {
  /** body lean at lockout, deg above horizontal (the line balls of the feet to shoulders) */
  topPitch: 52,
  /** elbow flexion at lockout, deg (softer than the push-up's: near straight the lean barely moves the elbow) */
  lock: 10,
  /** at the bottom the forehead's front reaches this far past the grips' line, m */
  forehead: 0.02,
  /** foot flat up to this lean, deg from vertical */
  flat: 38,
  /** elbow pole in the thorax frame: towards the head and out of the chest, a little out to the side */
  pole: [0.4, -0.4, 1] as V3,
  /** palms down and a little forwards, the ring's bar across the hand (with the arms forward, a neutral grip would lay
   * the bar along the forearm) */
  palm: norm([0, -1, 0.3]),
  axis: [1, 0, 0] as V3,
  /** floor allowance for the forefoot capsule with the heels up, mm */
  footSink: 30,
  /** neck and head flexion: eyes towards the floor ahead, deg */
  neck: [-8, 0],
}

export type RingExt = Base & {
  kind: 'ring-ext'
  balls: [V3, V3]
  grip: V3
  rig: RingRig
  pitch: (c: number) => number
}

/** the plank at `pitch` (deg above horizontal), rooted with the left ball of the foot on its target, toes flat */
function plank(skel: Skeleton, q: Float64Array, balls: [V3, V3], pitch: number) {
  const lean = 90 - pitch
  setDofs(skel, q, {
    'lumbar.flex': 0,
    'thorax.flex': 0,
    'neck.flex': RING_EXT.neck[0],
    'head.flex': RING_EXT.neck[1],
    'hip_*.flex': 0,
    'knee_*.flex': 2,
    'ankle_*.df': Math.min(lean, RING_EXT.flat),
    'grip_*.close': 1,
  })
  q[skel.dof['pelvis.tilt']] = lean
  const d = (() => {
    const b = sitePos(skel, fk(skel, q), 'ball_l')
    return [balls[0][0] - b[0], balls[0][1] - b[1], balls[0][2] - b[2]]
  })()
  q[skel.dof['pelvis.tx']] += d[0]
  q[skel.dof['pelvis.ty']] += d[1]
  q[skel.dof['pelvis.tz']] += d[2]
  // the toes stay flat on the floor
  const toe = root1d((t) => {
    q[skel.dof['toe_l.flex']] = t
    return qrot(fk(skel, q).rot[skel.seg.toes_l], [0, 0, 1])[1]
  }, -60, 40, { tol: 1e-6, scan: 9 }).x
  q[skel.dof['toe_l.flex']] = q[skel.dof['toe_r.flex']] = toe
}

function frame(skel: Skeleton, v: Pick<RingExt, 'balls' | 'grip'>, pitch: number): Float64Array {
  const q = zeroQ(skel)
  plank(skel, q, v.balls, pitch)
  const thorax = fk(skel, q).rot[skel.seg.thorax2]
  attachHand(skel, q, 'l', { pos: v.grip, axis: RING_EXT.axis, palm: RING_EXT.palm }, { pole: qrot(thorax, norm(RING_EXT.pole)), planeHint: 90 })
  mirrorArm(skel, q)
  return q
}

const elbowOf = (skel: Skeleton, q: Float64Array) => q[skel.dof['elbow_l.flex']]

export function ringExtContext(p: P, skel: Skeleton, tempo: Tempo): RingExt {
  const f0 = fk(skel, zeroQ(skel))
  const bx = sitePos(skel, f0, 'ball_l')[0]
  const balls: [V3, V3] = [[bx, 0, 0], [-bx, 0, 0]]
  const half = (p.gripWidth * skel.data.shoulderWidth) / 2
  const h = RING_HEIGHT.triceps_extension
  const v = { balls, grip: [half, h, 1] as V3 }
  // the grips where the arms are straight at the lockout lean
  v.grip = [half, h, root1d((z) => {
    v.grip = [half, h, z]
    return elbowOf(skel, frame(skel, v, RING_EXT.topPitch)) - RING_EXT.lock
  }, 0.4, 1.6, { tol: 1e-6, scan: 12 }).x]
  // bottom: the lean at which the forehead passes between the rings
  const head = (a: number) => {
    const caps = bodyCapsules(skel, fk(skel, frame(skel, v, a))).filter((k) => k.region === 'head')
    return Math.max(...caps.map((k) => Math.max(k.a[2], k.b[2]) + k.r)) - (v.grip[2] + RING_EXT.forehead)
  }
  const bottomPitch = root1d(head, RING_EXT.topPitch, 5, { tol: 1e-6, scan: 20 }).x
  // the lean changes linearly in contraction (an elbow schedule would put the lean's steepest change at lockout, where the
  // elbow barely moves the body)
  const pitch = (c: number) => lerp(bottomPitch, RING_EXT.topPitch, c)
  const rig = ringRig({ z: v.grip[2], spread: ringSpread(half), mount: 'beam' })
  const contacts: Contact[] = [
    { site: 'ball_l', kind: 'planted', target: { world: balls[0] } },
    { site: 'ball_r', kind: 'planted', target: { world: balls[1] } },
    ...ringContacts(),
  ]
  // with the heels up at the bottom the rigid forefoot capsule sinks into the floor where the toes bend (the push-up's
  // forefoot allowance, smaller here): a lead decision
  const setup: Setup = { implements: rig.implements, contacts, tempo, symmetric: true, tolerances: { floor: RING_EXT.footSink } }
  return { kind: 'ring-ext', tempo, setup, balls, grip: v.grip, rig, pitch }
}

export function sampleRingExt(u: number, _p: P, skel: Skeleton, v: RingExt): Sampled {
  const c = phaseAt(u, v.tempo).c
  const q = frame(skel, v, v.pitch(c))
  return { q, implements: ringPoses(skel, fk(skel, q), v.rig, [0, 0, 1]) }
}
