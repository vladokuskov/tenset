import { lerp, smoothstep } from '../../math.ts'
import { setDofs, setScapula, zeroQ, type ImplementPose, type Pose, type Side, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { templeHand } from '../crunch.ts'
import { restHead, restOnMat } from '../core/floor.ts'
import type { ParamsOf } from '../schemas.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'
import { lyingTilt, LYING, matUnder, TRUNK } from './common.ts'

// Supine floor drills on the mat (head towards -Z, feet towards +Z). Thigh elevation above the mat is hip flexion
// plus the pelvis's turn from lying flat (tilt about -90), as on the hollow hold.
//
// Dead bug (813): arms straight up over the shoulders, hips and knees at 90 (tabletop), the lower back pressed into
// the mat (a little posterior tilt). The working arm reaches overhead to just above the mat as the opposite leg
// straightens out to just above the mat (slow eccentric), then both come back (quick concentric); one working side per
// loop. Bicycle (820): the shoulders curled off the mat (the crunch's thoracic flexion), fingertips at the temples;
// the trunk turns one shoulder towards the opposite knee as that knee comes in and the other leg extends, then turns
// across to the other side (one loop sweeps from the far side to the working side and back). V-up (837): from a long
// hollow (arms overhead, legs straight, shoulders and heels just off the mat) both ends rise together and the hips
// fold until the hands reach towards the shins, balanced on the seat. Research (motion-authoring): anti-extension work
// keeps the lumbar spine flat; hip flexion 0 -> 90+ deg for the V; the angles are author judgment.

type P = ParamsOf<'floor-core'>

/** dead bug, deg: thigh elevation and knee flexion in the tabletop, the extended leg's thigh elevation, the reaching
 * arm's shoulder elevation (flexion plane), posterior tilt and lumbar flexion holding the back down */
export const DEAD_BUG = { table: 90, knee: 90, low: 14, reach: 170, up: 90, tilt: 5, lumbar: 3, ankle: -15 } as const
/** bicycle, deg: thoracic and lumbar flexion (shoulders off the mat), turn either side (thoracic, lumbar), the knee-in
 * leg's thigh elevation and knee, the extended leg's */
export const BICYCLE = { thorax: 32, lumbar: 10, rot: [18, 4], tilt: 6, inn: { elev: 72, knee: 105 }, out: { elev: 26, knee: 8 }, neck: 16 } as const
/** V-up bottom -> top, deg: pelvis tilt from lying flat (pressed back a little at the bottom, rolled up onto the seat
 * at the top),
 * lumbar and thoracic flexion, thigh elevation above the mat, shoulder elevation (overhead -> reaching to the shins) */
export const V_UP = { tilt: [-4, 30], lumbar: [4, 16], thorax: [6, 14], legs: [9, 64], arms: [172, 98], knee: [3, 8], neck: [8, 22] } as const

export type Supine = {
  kind: 'supine'
  sub: 'dead_bug' | 'bicycle' | 'v_up'
  tempo: Tempo
  setup: Setup
  /** working side: the reaching arm (dead bug), the shoulder that turns across (bicycle) */
  work: Side
  /** lying pelvis tilt, deg */
  tilt0: number
  neck0: number
  /** extended leg's knee flexion, deg */
  knee: number
  mat: ImplementPose
}

const other = (s: Side): Side => (s === 'l' ? 'r' : 'l')

function arm(skel: Skeleton, q: Float64Array, s: Side, elev: number) {
  setDofs(skel, q, { [`shoulder_${s}.plane`]: 90, [`shoulder_${s}.elev`]: elev, [`shoulder_${s}.rot`]: 0, [`elbow_${s}.flex`]: 5, [`forearm_${s}.pro`]: 10, [`wrist_${s}.flex`]: 0, [`wrist_${s}.dev`]: 0 })
  setScapula(skel, q, s)
}

function leg(skel: Skeleton, q: Float64Array, s: Side, tilt: number, elev: number, knee: number, ankle: number) {
  setDofs(skel, q, { [`hip_${s}.flex`]: elev + 90 + tilt, [`hip_${s}.abd`]: 0, [`hip_${s}.rot`]: 0, [`knee_${s}.flex`]: knee, [`ankle_${s}.df`]: ankle })
}

function deadBug(skel: Skeleton, q: Float64Array, v: Supine, c: number) {
  const k = 1 - c
  const tilt = v.tilt0 - DEAD_BUG.tilt
  setDofs(skel, q, { 'lumbar.flex': DEAD_BUG.lumbar, 'thorax.flex': 0, 'clavicle_*.prot': 4, 'clavicle_*.elev': 2, 'grip_*.close': 0, 'neck.flex': v.neck0, 'head.flex': v.neck0 * 0.3 })
  const w = v.work, o = other(w)
  arm(skel, q, w, lerp(DEAD_BUG.up, DEAD_BUG.reach, k))
  arm(skel, q, o, DEAD_BUG.up)
  leg(skel, q, w, tilt, DEAD_BUG.table, DEAD_BUG.knee, DEAD_BUG.ankle)
  // the leg straightens a little ahead of lowering, so the foot travels out rather than down
  leg(skel, q, o, tilt, lerp(DEAD_BUG.table, DEAD_BUG.low, k), lerp(DEAD_BUG.knee, v.knee, smoothstep(Math.min(1, k * 1.25))), lerp(DEAD_BUG.ankle, -25, k))
  setPelvis(skel, q, [0, 0.3, 0], tilt)
  restOnMat(skel, q, LYING)
}

function bicycle(skel: Skeleton, q: Float64Array, v: Supine, c: number) {
  // +1: turned towards the working side's far knee (the working shoulder across), -1: the other way
  const s = v.work === 'r' ? 1 : -1
  const turn = lerp(-1, 1, c)
  const tilt = v.tilt0 - BICYCLE.tilt
  setDofs(skel, q, {
    'lumbar.flex': BICYCLE.lumbar,
    'thorax.flex': BICYCLE.thorax,
    // + turns left: the right shoulder comes across towards the left knee
    'thorax.rot': s * BICYCLE.rot[0] * turn,
    'lumbar.rot': s * BICYCLE.rot[1] * turn,
    'neck.flex': BICYCLE.neck,
    'head.flex': 2,
    'grip_*.close': 0,
  })
  // the leg opposite the working shoulder comes in at the top
  const inn = v.work === 'r' ? 'l' : 'r'
  const t = (turn + 1) / 2
  for (const [side, k] of [[inn, t], [other(inn), 1 - t]] as const) {
    leg(skel, q, side, tilt, lerp(BICYCLE.out.elev, BICYCLE.inn.elev, k), lerp(v.knee, BICYCLE.inn.knee, k), -20)
  }
  setPelvis(skel, q, [0, 0.3, 0], tilt)
  restOnMat(skel, q, TRUNK)
  templeHand(skel, q)
}

function vUp(skel: Skeleton, q: Float64Array, v: Supine, c: number) {
  const tilt = v.tilt0 + lerp(V_UP.tilt[0], V_UP.tilt[1], c)
  setDofs(skel, q, {
    'lumbar.flex': lerp(V_UP.lumbar[0], V_UP.lumbar[1], c),
    'thorax.flex': lerp(V_UP.thorax[0], V_UP.thorax[1], c),
    'neck.flex': lerp(V_UP.neck[0], V_UP.neck[1], c),
    'head.flex': 2,
    'clavicle_*.prot': lerp(0, 8, c),
    'grip_*.close': 0,
  })
  for (const s of ['l', 'r'] as const) {
    arm(skel, q, s, lerp(V_UP.arms[0], V_UP.arms[1], c))
    leg(skel, q, s, tilt, lerp(V_UP.legs[0], V_UP.legs[1], c), lerp(V_UP.knee[0], V_UP.knee[1], c), -30)
  }
  setPelvis(skel, q, [0, 0.3, 0], tilt)
  restOnMat(skel, q, TRUNK)
}

function body(skel: Skeleton, q: Float64Array, v: Supine, c: number) {
  if (v.sub === 'dead_bug') deadBug(skel, q, v, c)
  else if (v.sub === 'bicycle') bicycle(skel, q, v, c)
  else vUp(skel, q, v, c)
}

export function supineContext(p: P, skel: Skeleton, tempo: Tempo): Supine {
  const sub = p.kind as Supine['sub']
  const lumbar = sub === 'dead_bug' ? DEAD_BUG.lumbar : sub === 'bicycle' ? BICYCLE.lumbar : V_UP.lumbar[0]
  const tilt0 = lyingTilt(skel, lumbar)
  const v: Supine = { kind: 'supine', sub, tempo, setup: undefined as unknown as Setup, work: p.side === 'left' ? 'l' : 'r', tilt0, neck0: 0, knee: p.kneeAngle ?? (sub === 'bicycle' ? BICYCLE.out.knee : 4), mat: undefined as unknown as ImplementPose }
  // the head resting on the mat (dead bug: lying flat); the bicycle and the V-up hold the head up with the trunk
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': lumbar })
  setPelvis(skel, q, [0, 0.3, 0], tilt0 - DEAD_BUG.tilt)
  restOnMat(skel, q, LYING)
  v.neck0 = Math.max(-8, restHead(skel, q))
  const poses = [0, 0.5, 1].map((c) => {
    const qq = zeroQ(skel)
    body(skel, qq, v, c)
    return qq
  })
  const mat = matUnder(skel, poses, 0.12)
  v.mat = mat.pose
  v.setup = { implements: [mat.spec], contacts: [], tempo, symmetric: sub === 'v_up' }
  return v
}

export function sampleSupine(skel: Skeleton, v: Supine, c: number): Pose {
  const q = zeroQ(skel)
  body(skel, q, v, c)
  return { q, implements: [v.mat], contacts: v.setup.contacts }
}
