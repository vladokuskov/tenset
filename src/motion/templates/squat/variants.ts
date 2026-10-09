import { root1d } from '../../constraints.ts'
import { fk, segPos } from '../../fk.ts'
import { lerp, type V3 } from '../../math.ts'
import { zeroQ, type Contact, type Pose, type Skeleton } from '../../skeleton.ts'
import { DEFAULT_TEMPO, phaseAt, type Tempo } from '../../timing.ts'
import type { ParamsOf } from '../schemas.ts'
import type { Setup } from '../types.ts'
import { hackPose, hackSetup, hackTravel, pendulumKnee, pendulumPose, pendulumSetup, plantedOn, SHOULDER_REST, type Facing } from './sled.ts'
import { belt, landmineSquat, pistol, sissy, spanish } from './free.ts'

// Tier C squats (wave 3c) that leave the standing and leg press solves of squat.ts alone: the hack squat (back on the
// pad or, reversed, the chest on it), the pendulum squat, the belt squat, the landmine squat, the band Spanish squat,
// the box pistol and the sissy squat. Each returns its setup and a sampler; squat.ts dispatches here first.

type P = ParamsOf<'squat'>

export type Variant = { tempo: Tempo; setup: Setup; sample: (u: number) => Pose }

/** the tier C squats this module owns, or null (squat.ts handles the rest) */
export function isVariant(p: P): boolean {
  return (p.implement === 'machine' && p.machine !== 'leg_press') || p.implement === 'landmine' || p.implement === 'band' || p.stance === 'single_leg' || !!p.sissy
}

export function variant(p: P, skel: Skeleton): Variant {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  const two = p.stance !== 'single_leg' && !p.box && !p.heelsElevated && p.posture === 'standing'
  if (p.implement === 'machine' && two && !p.sissy) {
    if (p.machine === 'hack_squat') return hack(p, skel, tempo)
    if (p.machine === 'pendulum_squat' && !p.reverse) return pendulum(p, skel, tempo)
    if (p.machine === 'belt_squat' && !p.reverse) return belt(p, skel, tempo)
  }
  if (p.implement === 'landmine' && p.hold === 'goblet' && two && !p.sissy) return landmineSquat(p, skel, tempo)
  if (p.implement === 'band' && two && !p.sissy) return spanish(p, skel, tempo)
  if (p.implement === 'bodyweight' && p.stance === 'single_leg' && p.box && !p.sissy && p.posture === 'standing') return pistol(p, skel, tempo)
  if (p.implement === 'bodyweight' && p.sissy && two) return sissy(p, skel, tempo)
  throw new Error(`squat: variant not implemented yet (${p.implement} ${p.machine ?? ''} ${p.hold} ${p.stance}${p.box ? ' box' : ''}${p.sissy ? ' sissy' : ''})`)
}

// ---------- hack squat ----------

/** knee flexion at the bottom on the hack and pendulum, deg (author judgment: the sled stops above the deep end of a
 * free squat; the reverse hack sits the hips back further for the same knee bend) */
const SLED_KNEE: Record<P['depth'], number> = { quarter: 60, parallel: 95, full: 112 }
const SLED_TOP_KNEE = 5
/**
 * Hack squat: the feet `ahead` of the frame's default plate spot (m; regular: mid-platform about hip width, the hips
 * fold to ~75 deg at the bottom with the heels down; reverse: the plate under the hips, the hips back), the sled
 * `top` m up its rails standing tall. Back flat on the pad; reversed, the head turned up off the pad.
 */
const HACK_FIT: Record<Facing, { ahead: number; spine: Record<string, number>; pole: V3; padTo?: number }> = {
  back: { ahead: 0.27, spine: { 'lumbar.flex': 0, 'thorax.flex': 0, 'neck.flex': 14 }, pole: [0.25, 0, -1] },
  // facing the pad the thighs fold up towards it: the pad stops under the chest, 0.3 m down from the shoulder line
  chest: { ahead: -0.25, spine: { 'lumbar.flex': 0, 'thorax.flex': 0, 'neck.flex': -28, 'head.flex': -12 }, pole: [-0.25, 0, 1], padTo: 0.3 },
}
const HACK_TOP_TRAVEL = 0.68
/** reverse hack: the bottom stops this much less knee bend (deg), where the folding thighs reach the pad's lower end and
 * the ankles ~38 deg of dorsiflexion */
const REVERSE_SHALLOWER = 10
const HACK_TOE_OUT = 10

function hack(p: P, skel: Skeleton, tempo: Tempo): Variant {
  const facing: Facing = p.reverse ? 'chest' : 'back'
  const fit = HACK_FIT[facing]
  const h = hackSetup(skel, { facing, tilt: 0, spine: fit.spine, pole: fit.pole, width: skel.data.hipWidth + 0.03, toeOut: Math.min(p.toeOut, HACK_TOE_OUT), along: 0, ahead: fit.ahead, topKnee: SLED_TOP_KNEE, topTravel: HACK_TOP_TRAVEL, padTo: fit.padTo })
  const bottom = hackTravel(skel, h, SLED_KNEE[p.depth] - (facing === 'chest' ? REVERSE_SHALLOWER : 0)).x
  const ride = { ...h, travel: [bottom, HACK_TOP_TRAVEL] as [number, number] }
  // facing the machine (turned round) the left hand holds the sled's handle_r
  const contacts: Contact[] = [...plantedOn(skel, h.feet), ...grips(h.sled.id, facing === 'chest')]
  const setup: Setup = {
    implements: [h.frame, h.sled],
    contacts,
    tempo,
    symmetric: true,
    rests: [{ implement: h.sled.id, regions: ['girdle_l', 'girdle_r'], tol: SHOULDER_REST }],
  }
  return {
    tempo,
    setup,
    sample: (u) => {
      const c = phaseAt(u, tempo).c
      const pose = hackPose(skel, ride, lerp(ride.travel[0], ride.travel[1], c))
      return { ...pose, contacts }
    },
  }
}

function grips(id: string, swap = false): Contact[] {
  const [l, r] = swap ? ['handle_r', 'handle_l'] : ['handle_l', 'handle_r']
  return [
    { site: 'grip_l', kind: 'grip', target: { implement: id, grip: l } },
    { site: 'grip_r', kind: 'grip', target: { implement: id, grip: r } },
  ]
}

// ---------- pendulum squat ----------

/**
 * Pendulum squat: the lifter leans back `lean` deg on the pad standing tall with the feet well ahead on a platform
 * tilted toes-up `platform`; the arm pivots `reach` m behind the shoulder line, `pitch` deg below it, so the pad swings
 * down and back to about upright at the bottom while the knees travel far forward. The bottom is where the hip joints
 * sit PEND_BELOW m below the knees (full: the hips ~100 at a knee bend of ~109, the ankles ~30 deg of dorsiflexion).
 * A pivot level with or above the shoulders keeps the knees behind the toes and stops them short of ~100 deg (author
 * judgment).
 */
const PEND = { ahead: 0.5, lean: 20, pitch: -15, reach: 1.0, platform: 15, spine: { 'lumbar.flex': 0, 'thorax.flex': 0, 'neck.flex': 6 } as Record<string, number> }
/** pendulum squat: hip joints below the knee joints at the bottom, m (negative: above) */
const PEND_BELOW: Record<P['depth'], number> = { quarter: -0.25, parallel: 0, full: 0.04 }

function pendulum(p: P, skel: Skeleton, tempo: Tempo): Variant {
  const s = pendulumSetup(skel, { tilt: 0, spine: PEND.spine, pole: [0.25, 0, -1], width: skel.data.hipWidth + 0.03, toeOut: Math.min(p.toeOut, HACK_TOE_OUT), lean: PEND.lean, reach: PEND.reach, pitch: PEND.pitch, platformTilt: PEND.platform, topKnee: SLED_TOP_KNEE, feetAhead: PEND.ahead })
  const q = zeroQ(skel)
  const below = (deg: number) => {
    pendulumKnee(skel, q, s, deg)
    const f = fk(skel, q)
    return segPos(skel, f, 'tibia_l')[1] - segPos(skel, f, 'femur_l')[1]
  }
  const bottom = root1d((deg) => below(deg) - PEND_BELOW[p.depth], 0, 35, { tol: 1e-7, scan: 35 }).x
  const ride = { ...s, swing: [bottom, 0] as [number, number] }
  const contacts: Contact[] = [...plantedOn(skel, s.feet), ...grips(s.arm.id)]
  const setup: Setup = {
    implements: [s.frame, s.arm],
    contacts,
    tempo,
    symmetric: true,
    rests: [{ implement: s.arm.id, regions: ['girdle_l', 'girdle_r'], tol: SHOULDER_REST }],
  }
  return {
    tempo,
    setup,
    sample: (u) => {
      const c = phaseAt(u, tempo).c
      const pose = pendulumPose(skel, ride, lerp(ride.swing[0], ride.swing[1], c))
      return { ...pose, contacts }
    },
  }
}
