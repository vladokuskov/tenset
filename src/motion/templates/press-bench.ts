import { handFrame, implementFromHand, root1d } from '../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../collide.ts'
import { fk, localToWorld, segPos } from '../fk.ts'
import { barbell, dumbbell, type ImplementSpec, type Part } from '../implements.ts'
import { benchRack, pressBench, PRESS_BENCH } from '../implements/press-horizontal.ts'
import { dls } from '../ik.ts'
import { add, lerp, norm, qid, scale, type V3 } from '../math.ts'
import { zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { phaseAt, type Tempo } from '../timing.ts'
import {
  BACK_CAPS, flarePole, minClear, plantFeet, poleAt, restHead, SEAT_CAPS, seatedCaps, seatOnPads, solidOf, solveLeftArm, trunkPose, wristSchedule,
  type ArmRig, type Posture,
} from './press-body.ts'
import type { ParamsOf } from './schemas.ts'
import type { Setup } from './types.ts'

// Bench press lying on a flat bench or reclined on an incline: implement driver. The body is still (feet planted,
// butt and upper back on the pads with a moderate arch, scapulae retracted and depressed); the bar or the dumbbells
// follow a J-curve from the chest to over the shoulders (Madsen & McLaughlin 1984): vertical near lockout, curving
// towards the feet at the bottom, where most of the horizontal travel happens early in the press. Flat: touch on
// the lower chest; incline: the touch point moves up the chest towards the clavicles. The arms are solved to the
// grips each frame with the elbow pole set so the upper arm sits at `elbowFlare` from the torso (frontal-plane
// abduction) at the bottom. Grip 1.0-1.7 x biacromial keeps abduction under ~45-75 deg (Larsen 2021; Green &
// Comfort 2007). With the bar on the chest the elbows fold to ~135-150 deg: this rig's grip site sits mid-palm.

export type PressParams = ParamsOf<'horizontal-press'> | ParamsOf<'incline-press'>

const SEAT_H = 0.44
/** pad sink of the butt and upper back, m */
const SINK = 0.01
/** arch: pelvis anterior tilt from the pad, lumbar and thoracic extension (moderate, feet-planted bench) */
const ARCH = { pelvis: 8, lumbar: -10, thorax: -6 }
/** scapulae retracted and depressed, held through the rep */
const CLAVICLE = { prot: -16, elev: -4 }
/** elbow flexion at lockout, deg (soft lockout; 0-5 in the literature) */
export const LOCK_ELBOW = 6
/** wrist extension with the bar low in the palm, deg */
const WRIST_EXT = 15
/** touch point along the torso (thorax2 frame, y up the spine): flat = lower chest, incline = upper chest */
export const TOUCH_Y = { flat: -0.05, incline: 0.04 }
/** J-curve: fore-aft offset from lockout = full offset x (1 - h)^J_EXP at press height fraction h */
const J_EXP = 2
/** the bar sinks this far into the chest at the touch (soft tissue), m */
const BAR_SINK = 0.004
/** flat bench: the seat's front edge sits this far past the hip joints so the thighs leave the bench there, m */
const SEAT_FRONT = 0.1
const DB_KG = 18
/** dumbbells: handle centres at lockout, |x| (inner heads ~4 cm apart), and their clearance off the chest and arms at the bottom */
const DB_TOP_X = 0.17
const DB_CLEAR = 0.012
/** dumbbell handles at the bottom this far below the top of the chest (deeper takes the upper arm past ~40 deg of horizontal abduction), m */
const DB_BELOW = 0.01
/** J-cups: the racked bar sits this far below and towards the head from the lockout, m */
const RACK_DROP = 0.05
const RACK_BACK = 0.1
/** shins about vertical; on the incline the front stabiliser caps it */
const KNEE = { flat: 90, incline: 80 }
/** feet planted a little wider than the shoulders, m from the midline (in front of the bench's front stabiliser) */
const FEET_HALF = 0.3

export type Hold = 'barbell' | 'dumbbell' | 'smith'

export type BenchCtx = {
  kind: 'bench'
  tempo: Tempo
  setup: Setup
  hold: Hold
  /** static body: pelvis, spine, legs, head; the arms are solved per frame */
  base: Float64Array
  bar?: ImplementSpec
  /** bar centre or left dumbbell handle path: lockout, touch */
  top: V3
  bottom: V3
  rig: ArmRig
  fixed: ImplementPose[]
}

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })

export function unsupportedBench(p: PressParams): string | null {
  if (p.posture !== 'lying_supine') return `${p.implement}/${p.posture}`
  if (p.implement === 'machine') return 'machine lying'
  if (p.benchAngle < 0) return `decline ${p.benchAngle}`
  if (p.benchAngle > 0 && p.benchAngle < 10) return `bench angle ${p.benchAngle}`
  if (p.implement === 'dumbbell' && p.grip !== 'pronated') return `dumbbell grip ${p.grip}`
  if (p.laterality !== 'bilateral') return p.laterality
  return null
}

// ---------- body on the bench ----------

function posture(a: number): Posture {
  // the upper back lies along the back pad, the arch lifts the lower back and tilts the pelvis forward
  return { tilt: -(90 - a) + ARCH.pelvis, lumbar: ARCH.lumbar, thorax: ARCH.thorax, clavicle: CLAVICLE }
}

/**
 * Flat: the pelvis tilt and body height that put both the butt and the upper back on the pad (the lumbar arch
 * clears it), the hips SEAT_FRONT behind the seat's front edge. Incline: height and fore-aft position that seat the
 * butt on the seat and the upper back on the pad.
 */
function placeBody(skel: Skeleton, a: number, bench: ImplementSpec, pose: ImplementPose): { hip: V3; s: Posture } {
  const s0 = posture(a)
  const seat = solidOf(bench, pose, 0)
  const back = solidOf(bench, pose, 1)
  if (a !== 0) return { hip: seatOnPads(skel, s0, seat, back, [pose.pos[1] + 0.09, pose.pos[2] + 0.1], SINK), s: s0 }
  const seatPart = bench.parts[0] as Extract<Part, { shape: 'box' }>
  const z = pose.pos[2] + seatPart.center[2] + PRESS_BENCH.seat.len / 2 - SEAT_FRONT
  const res = (x: number[]) => {
    const c = seatedCaps(skel, [0, x[0], z], { ...s0, tilt: x[1] })
    const up = c.filter(BACK_CAPS)
    return [(minClear(c.filter(SEAT_CAPS), seat) + SINK) * 100, (Math.min(minClear(up, back), minClear(up, seat)) + SINK) * 100]
  }
  const r = dls(res, [pose.pos[1] + 0.09, s0.tilt], { tol: 1e-7, iters: 60 })
  return { hip: [0, r.x[0], z], s: { ...s0, tilt: r.x[1] } }
}

// ---------- path ----------

/**
 * J-curve point at press height fraction h (0 touch, 1 lockout): the fore-aft offset goes early in the press, the
 * dumbbells' lateral offset late (they rise clear of the chest, then converge over the shoulders)
 */
export function jCurve(top: V3, bottom: V3, h: number): V3 {
  return [lerp(top[0], bottom[0], 1 - h * h), lerp(bottom[1], top[1], h), top[2] + (bottom[2] - top[2]) * (1 - h) ** J_EXP]
}

function gripOf(ctx: Pick<BenchCtx, 'hold' | 'bar'>, center: V3) {
  return { pos: ctx.hold === 'dumbbell' ? center : add(center, ctx.bar!.sites.l.pos), axis: [1, 0, 0] as V3 }
}

// ---------- context ----------

export function benchContext(p: PressParams, skel: Skeleton, tempo: Tempo): BenchCtx {
  const a = p.benchAngle
  const hold = p.implement as Hold
  const incline = a >= 10
  const bench = pressBench({ backAngle: a, seatHeight: SEAT_H })
  const benchPose: ImplementPose = { id: 'bench', pos: [0, SEAT_H, 0], rot: qid() }
  const { hip, s } = placeBody(skel, a, bench, benchPose)
  const base = zeroQ(skel)
  trunkPose(skel, base, hip, s)
  restHead(skel, base, solidOf(bench, benchPose, 1))
  const legs = plantFeet(skel, base, hip, incline ? KNEE.incline : KNEE.flat, FEET_HALF)
  const f0 = fk(skel, base)
  const gh = scale(add(segPos(skel, f0, 'humerus_l'), segPos(skel, f0, 'humerus_r')), 0.5)
  const touch = localToWorld(skel, f0, 'thorax2', [0, incline ? TOUCH_Y.incline : TOUCH_Y.flat, 0.1])

  const implements_: ImplementSpec[] = []
  const contacts: Contact[] = [...legs.contacts]
  const fixed: ImplementPose[] = [benchPose]
  let bar: ImplementSpec | undefined
  if (hold === 'dumbbell') {
    implements_.push(dumbbell({ id: 'db_l', mass: DB_KG }), dumbbell({ id: 'db_r', mass: DB_KG }))
    contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: 'db_l', grip: 'c' } }, { site: 'grip_r', kind: 'grip', target: { implement: 'db_r', grip: 'c' } })
  } else {
    bar = barbell({ gripWidth: p.gripWidth * skel.data.shoulderWidth, plateKg: hold === 'smith' ? 20 : 40 })
    implements_.push(bar)
    contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: bar.id, grip: 'l' } }, { site: 'grip_r', kind: 'grip', target: { implement: bar.id, grip: 'r' } })
  }
  implements_.push(bench)
  // palms face the feet, knuckles up; the bar sits low in the palm over a slightly extended wrist
  const rig: ArmRig = { pole: poleAt(60), palm: norm(incline ? [0, 0.2, 1] : [0, 0.35, 1]), wristBias: WRIST_EXT }
  const arm = (center: V3, pole = rig.pole) => {
    const q = Float64Array.from(base)
    solveLeftArm(skel, q, gripOf({ hold, bar }, center), { ...rig, pole })
    return q
  }

  // touch point: the bar comes straight down onto the chest there (a light touch); dumbbells stop level with the chest
  const probe = bar ?? barbell({ gripWidth: 0.6 })
  const trunkCaps = bodyCapsules(skel, f0).filter((c) => c.region === 'trunk')
  const surface = root1d((y) => minClear(trunkCaps, placeParts(probe, { id: 'bar', pos: [0, y, touch[2]], rot: qid() })[0]) + BAR_SINK, touch[1] - 0.1, touch[1] + 0.25, { tol: 1e-6 }).x
  let bottom: V3 = bar ? [0, surface, touch[2]] : [0.3, surface - DB_BELOW, touch[2]]
  if (hold === 'dumbbell') {
    // dumbbells beside the chest, just clear of it, of the upper arms and of the head
    const db = implements_[0]
    const gap = (c: V3) => {
      const f = fk(skel, arm(c))
      const h = handFrame(skel, f, 'l')
      const solids = placeParts(db, { id: 'db_l', pos: h.pos, rot: implementFromHand(h.axis, h.palm) })
      const body = bodyCapsules(skel, f).filter((k) => ['trunk', 'upperarm_l', 'head', 'neck'].includes(k.region))
      return Math.min(...solids.flatMap((sd) => body.map((k) => capsuleSolidClearance(k, sd)))) - DB_CLEAR
    }
    for (let pass = 0; pass < 3; pass++) {
      bottom = [root1d((x) => gap([x, bottom[1], bottom[2]]), 0.2, 0.5, { tol: 1e-5 }).x, bottom[1], bottom[2]]
      rig.pole = flarePole(skel, p.elbowFlare, (pole) => arm(bottom, pole))
    }
  } else rig.pole = flarePole(skel, p.elbowFlare, (pole) => arm(bottom, pole))
  // lockout over the shoulder joints (the Smith bar stays on its rail over the touch point), elbows soft
  const topZ = hold === 'smith' ? bottom[2] : gh[2]
  const topX = hold === 'dumbbell' ? DB_TOP_X : 0
  const topY = root1d((y) => arm([topX, y, topZ])[skel.dof['elbow_l.flex']] - LOCK_ELBOW, bottom[1], bottom[1] + 0.8, { tol: 1e-6 }).x
  const top: V3 = [topX, topY, topZ]
  rig.oblique = wristSchedule((c, o) => {
    const q = Float64Array.from(base)
    solveLeftArm(skel, q, gripOf({ hold, bar }, jCurve(top, bottom, c)), { ...rig, oblique: () => o }, c, true)
    return q[skel.dof['wrist_l.dev']]
  })

  const setup: Setup = { implements: implements_, contacts, tempo, symmetric: true }
  if (bar) setup.rests = [{ implement: bar.id, regions: ['trunk'], tol: 10 }]
  if (hold === 'smith') {
    // the rails as the drawn Smith machine has them (props/smith.ts: 7.5 cm behind the bar line)
    implements_.splice(1, 0, {
      id: 'smith',
      kind: 'bench',
      mass: 0,
      com: [0, 0, 0],
      parts: [cyl([0.6, 0, -0.075], [0.6, 2.25, -0.075], 0.025), cyl([-0.6, 0, -0.075], [-0.6, 2.25, -0.075], 0.025), cyl([-0.6, 2.25, -0.075], [0.6, 2.25, -0.075], 0.03)],
      sites: {},
    })
    fixed.push({ id: 'smith', pos: [0, 0, bottom[2]], rot: qid() })
  }
  if (hold === 'barbell') {
    // uprights beside the head: the cups over the eyes, just below the locked-out bar
    const rack = benchRack({ hookHeight: top[1] - RACK_DROP })
    implements_.push(rack)
    fixed.push({ id: 'rack', pos: [0, 0, top[2] - RACK_BACK - rack.sites.l.pos[2]], rot: qid() })
  }
  return { kind: 'bench', tempo, setup, hold, base, bar, top, bottom, rig, fixed }
}

export function sampleBench(u: number, skel: Skeleton, ctx: BenchCtx): Pose {
  const c = phaseAt(u, ctx.tempo).c
  const q = Float64Array.from(ctx.base)
  const center = jCurve(ctx.top, ctx.bottom, c)
  solveLeftArm(skel, q, gripOf(ctx, center), ctx.rig, c)
  const implements_: ImplementPose[] = []
  if (ctx.hold === 'dumbbell') {
    const f = fk(skel, q)
    for (const s of ['l', 'r'] as const) {
      const h = handFrame(skel, f, s)
      implements_.push({ id: `db_${s}`, pos: h.pos, rot: implementFromHand(h.axis, h.palm) })
    }
  } else implements_.push({ id: ctx.bar!.id, pos: center, rot: qid() })
  implements_.push(...ctx.fixed)
  return { q, implements: implements_, contacts: ctx.setup.contacts }
}
