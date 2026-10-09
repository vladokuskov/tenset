import { root1d, type FootTarget } from '../../constraints.ts'
import { hackSled, hackSquat, sledPose, HACK } from '../../implements/stations.ts'
import { add, DEG, lerp, qaxis, qmul, qrot, sub, type V3 } from '../../math.ts'
import { zeroQ, type Contact, type ImplementPose, type Pose, type Side, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import type { Setup } from '../types.ts'
import { hackCarriage, HANDLE_DROP, lowerHandles, registerRider, rideLegs, ridePelvis, SHOULDER_REST, type Rider } from '../squat/sled.ts'

// Calf raise on the hack squat (608): back on the sled's pad, shoulders under its pads, the balls of the feet on the
// foot plate's low (rear) edge with the heels hanging off behind it. The knees stay nearly straight, so the sled rides
// up the rails as the heels rise: each frame the foot pitches about the balls for the keyed ankle angle and the sled
// travels to where the knees sit at `knee`.

/**
 * ankle dorsiflexion at the stretch and at the top, deg (as the standing calf machine: a long stretch below the plate's
 * edge, a high raise), knee bend held, the balls this far in from the plate's rear edge (m), the feet about hip width
 * and turned out a little, the plate `ahead` of and `rise` above the frame's default spot (m: the legs in line with the
 * trunk on the pad, the heels clear of the floor at the stretch) and the sled `travel` m up its rails with the feet flat
 */
export const HACK_CALF = { df: { stretch: 22, top: -32 }, knee: 4, ballIn: 0.03, width: 0.25, toeOut: 3, ahead: 0.6, rise: 0.15, travel: 0.45, spine: { 'lumbar.flex': 0, 'thorax.flex': 0, 'neck.flex': 14 } as Record<string, number> }
/** the forefoot capsule is rigid with the pitched foot and dips into the plate where the real toes lie flat (as the
 * calf raise's FOREFOOT_REST, mm) */
const FOREFOOT_REST = 42

type HackCalf = { frame: ReturnType<typeof hackSquat>; sled: ReturnType<typeof hackSled>; rider: Rider; balls: { side: Side; ball: V3 }[]; plateRot: ReturnType<typeof qaxis> }

function footAt(skel: Skeleton, h: HackCalf, side: Side, ball: V3, pitch: number): FootTarget {
  const yaw = (side === 'l' ? HACK_CALF.toeOut : -HACK_CALF.toeOut) * DEG
  const rot = qmul(h.plateRot, qmul(qaxis([0, 1, 0], yaw), qaxis([1, 0, 0], pitch * DEG)))
  return { side, rot, ankle: sub(ball, qrot(rot, skel.data.sites[`ball_${side}`].local)) }
}

/** sled travel for the knee bend with the feet pitched `pitch` (heel up +) */
function travelFor(skel: Skeleton, q: Float64Array, h: HackCalf, frame: ReturnType<typeof hackSquat>, pitch: number) {
  const feet = h.balls.map((b) => footAt(skel, h, b.side, b.ball, pitch))
  return root1d((s) => {
    ridePelvis(skel, q, h.rider, hackCarriage(frame, s))
    return rideLegs(skel, q, feet)[0].knee - HACK_CALF.knee
  }, HACK.travel + 0.6, -0.4, { tol: 1e-9, scan: 40 }).x
}

/** foot pitch and sled travel for the keyed ankle dorsiflexion (nested 1-D root finds); leaves the pose in q */
function solve(skel: Skeleton, q: Float64Array, h: HackCalf, df: number): { s: number; pitch: number } {
  const pitch = root1d((pitch) => {
    travelFor(skel, q, h, h.frame, pitch)
    return q[skel.dof['ankle_l.df']] - df
  }, -45, 70, { tol: 1e-9 }).x
  const s = travelFor(skel, q, h, h.frame, pitch)
  for (const b of h.balls) q[skel.dof[`toe_${b.side}.flex`]] = Math.max(-55, Math.min(38, -pitch))
  return { s, pitch }
}

export function hackCalf(skel: Skeleton, tempo: Tempo): { tempo: Tempo; setup: Setup; sample: (c: number) => Pose } {
  const sled = lowerHandles(hackSled(), [0, 0, HANDLE_DROP])
  const rider = registerRider(skel, { facing: 'back', tilt: 0, spine: HACK_CALF.spine, carriage: sled, pole: [0.25, 0, -1] })
  const plateRot = qaxis([1, 0, 0], -HACK.plateTilt * DEG)
  const plate = add(HACK.plate.at, [0, HACK_CALF.rise, HACK_CALF.ahead])
  const balls = (['l', 'r'] as const).map((side) => ({ side, ball: add(plate, qrot(plateRot, [(side === 'l' ? 1 : -1) * HACK_CALF.width / 2, 0, -HACK.plate.depth / 2 + HACK_CALF.ballIn])) }))
  const frameAt = (k: number) => hackSquat({ plate, bottom: add(HACK.bottom, [0, k, 0]) })
  const probe: HackCalf = { frame: frameAt(0), sled, rider, balls, plateRot }
  const q = zeroQ(skel)
  // the rails move up or down until the sled stands `travel` up them with the feet flat on the plate
  const k = root1d((k) => travelFor(skel, q, probe, frameAt(k), 0) - HACK_CALF.travel, -0.6, 0.6, { tol: 1e-7, scan: 12 }).x
  const h: HackCalf = { ...probe, frame: frameAt(k) }
  const contacts: Contact[] = [
    ...balls.map((b): Contact => ({ site: `ball_${b.side}`, kind: 'planted', target: { world: b.ball } })),
    { site: 'grip_l', kind: 'grip', target: { implement: sled.id, grip: 'handle_l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: sled.id, grip: 'handle_r' } },
  ]
  const setup: Setup = {
    implements: [h.frame, sled],
    contacts,
    tempo,
    symmetric: true,
    rests: [{ implement: sled.id, regions: ['girdle_l', 'girdle_r'], tol: SHOULDER_REST }, { implement: h.frame.id, regions: ['foot_l', 'foot_r'], tol: FOREFOOT_REST }],
  }
  return {
    tempo,
    setup,
    sample: (c) => {
      const pose = zeroQ(skel)
      const { s } = solve(skel, pose, h, lerp(HACK_CALF.df.stretch, HACK_CALF.df.top, c))
      const implements_: ImplementPose[] = [{ id: h.frame.id, pos: [0, 0, 0], rot: [0, 0, 0, 1] }, sledPose(sled.id, h.frame, s)]
      return { q: pose, implements: implements_, contacts }
    },
  }
}
