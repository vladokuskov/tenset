import { handFrame, implementFromHand, root1d } from '../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../collide.ts'
import { fk, localToWorld, segPos, type FK } from '../fk.ts'
import { barbell, dumbbell, type ImplementSpec, type Part } from '../implements.ts'
import { benchRack, pressBench, PRESS_BENCH } from '../implements/press-horizontal.ts'
import { dls } from '../ik.ts'
import { add, lerp, norm, qid, scale, type V3 } from '../math.ts'
import { zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../skeleton.ts'
import { phaseAt, type Tempo } from '../timing.ts'
import {
  armElevation, BACK_CAPS, flareLean, forearmSag, forearmTilt, holdArm, holdFade, minClear, naturalCubic, plantFeet, poleAt, restHead, SEAT_CAPS, seatedCaps, seatOnPads, smooth, solidOf,
  solveLeftArm, trunkPose, wristSchedule, type ArmRig, type Posture,
} from './press-body.ts'
import type { ParamsOf } from './schemas.ts'
import type { Setup } from './types.ts'

// Bench press lying on a flat bench or reclined on an incline: implement driver. The body is still (feet planted,
// butt and upper back on the pads with a moderate arch, scapulae retracted and depressed); the bar or the dumbbells
// press back in a J-curve from the chest to over the shoulders (Madsen & McLaughlin 1984): vertical near lockout,
// curving towards the feet at the bottom, where most of the horizontal travel happens early in the press; the descent
// is a straight diagonal. Flat: touch on the lower chest; incline: the touch point moves up the chest towards the
// clavicles. The arms are solved to the grips each frame with the elbow pole set so the upper arm sits at
// `elbowFlare` from the torso (frontal-plane abduction) at the bottom. Grip 1.0-1.7 x biacromial keeps abduction
// under ~45-75 deg (Larsen 2021; Green & Comfort 2007). With the bar on the chest the elbows fold to ~135-150 deg:
// this rig's grip site sits mid-palm.

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
/** touch point along the torso (thorax2 frame, y up the spine): flat = lower chest, incline = upper chest, close = low sternum */
export const TOUCH_Y = { flat: -0.05, incline: 0.04, close: -0.1 }
/**
 * Close grip (about shoulder width): the bar touches lower on the sternum and the wrists stack over the elbows, so the
 * wrist extension is solved for a vertical forearm (side view) at the touch, within CLOSE_WRIST
 */
export const CLOSE_GRIP = 1.1
const CLOSE_WRIST: [number, number] = [WRIST_EXT, 30]
/** holdArm: extra weight on the front-view lean, so the elbows stay under the hands mid-press ("elbows tucked") */
const CLOSE_FRONT = 2
/** stackPath hands over to the lockout from this press height fraction */
const STACK_BLEND = 0.6
/**
 * J-curve: fore-aft offset from lockout = full offset x (1 - h)^exp at press height fraction h. The bar comes down
 * on a straight diagonal to the touch and presses back in the J (most of the travel early); a J on the way down
 * too keeps the bar over the shoulders until the arms are half folded, with the elbows tucked at the ribs
 */
const J_EXP = { ecc: 1, con: 2 }
export type Stroke = keyof typeof J_EXP
/** the bar sinks this far into the chest at the touch (soft tissue), m */
const BAR_SINK = 0.004
/** flat bench: the seat's front edge sits this far past the hip joints so the thighs leave the bench there, m */
const SEAT_FRONT = 0.1
const DB_KG = 18
/** dumbbells: handle centres at lockout, |x| (inner heads ~4 cm apart), and their clearance off the chest and arms at the bottom */
const DB_TOP_X = 0.17
/** holdDumbbells: deg of forearm lean traded per cm of path offset */
const DB_OFF = 0.5
const DB_CLEAR = 0.012
/** dumbbell handles at the bottom this far below the top of the chest (level: deeper takes the upper arm past ~40 deg below the chest plane), m */
const DB_BELOW = 0
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
  /** load path and arm rig per stroke (the paths differ) */
  strokes: Record<Stroke, { path: (c: number) => V3; rig: ArmRig }>
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
export function jCurve(top: V3, bottom: V3, h: number, stroke: Stroke = 'con'): V3 {
  return [lerp(top[0], bottom[0], 1 - h * h), lerp(bottom[1], top[1], h), top[2] + (bottom[2] - top[2]) * (1 - h) ** J_EXP[stroke]]
}

/**
 * Dumbbells are free to move sideways, so their path can keep the forearms at their touch lean (about vertical) the
 * whole way up, the elbows opening steadily to lockout, instead of the barbell's trade-off (holdArm). Per knot over
 * contraction: the path offset (dx, dz, cm) and the pole lean th that hold the touch lean in both planes with the
 * upper-arm elevation rising as c^2 to its lockout value, traded at DB_OFF deg per cm of offset (least squares), faded
 * out towards lockout. `solve(c, offset, th)` poses the arm.
 */
function holdDumbbells(skel: Skeleton, solve: (c: number, off: V3, th: number) => Float64Array, th0: number, samples = 33) {
  const at = (c: number, x: number[]) => {
    const f = fk(skel, solve(c, [x[0] / 100, 0, x[1] / 100], x[2]))
    return { fr: forearmTilt(skel, f), sag: forearmSag(skel, f), elev: armElevation(skel, f) }
  }
  const touch = at(0, [0, 0, th0])
  const lock = at(1, [0, 0, th0]).elev
  const cs = Array.from({ length: samples }, (_, i) => i / (samples - 1))
  let x = [0, 0, th0]
  const knots = cs.map((c) => {
    const elev = touch.elev + (lock - touch.elev) * c * c
    x = dls((y) => {
      const m = at(c, y)
      return [m.fr - touch.fr, m.sag - touch.sag, m.elev - elev, y[0] * DB_OFF, y[1] * DB_OFF]
    }, x, { h: 1e-3, iters: 40, tol: 1e-4 }).x
    const w = holdFade(solve(c, [0, 0, 0], th0)[skel.dof['elbow_l.flex']])
    return [w * x[0], w * x[1], th0 + w * (x[2] - th0)]
  })
  // the fade towards lockout is quick in c: a few [1 2 1] passes over the knots keep the jerk down
  for (let pass = 0; pass < 4; pass++) for (const v of [0, 1, 2]) for (let i = 1, prev = knots[0][v]; i < knots.length - 1; i++) [prev, knots[i][v]] = [knots[i][v], (prev + 2 * knots[i][v] + knots[i + 1][v]) / 4]
  const [dx, dz, th] = [0, 1, 2].map((k) => naturalCubic(cs, knots.map((v) => v[k])))
  const clamp = (c: number) => Math.max(0, Math.min(1, c))
  return { offset: (c: number): V3 => [dx(clamp(c)) / 100, 0, dz(clamp(c)) / 100], pole: (c: number) => poleAt(th(clamp(c))) }
}

/**
 * Close grip: the bar rises over the elbows (forearms vertical in the side view, the cue "stack your wrists over your
 * elbows"): at each height the fore-aft position where the forearm is vertical, blended into the lockout over the
 * shoulders, where the straight arm leaves the forearm direction to the shoulder. `pose(center)` solves the arm.
 */
function stackPath(skel: Skeleton, top: V3, bottom: V3, pose: (center: V3) => FK, samples = 17): (c: number) => V3 {
  const hs = Array.from({ length: samples }, (_, i) => i / (samples - 1))
  // continuation from the touch: the root nearest the previous height's, so the path stays on one branch
  let prev = bottom[2]
  const zs = hs.map((h) => {
    const y = lerp(bottom[1], top[1], h)
    const sag = (z: number) => forearmSag(skel, pose([0, y, z]))
    let z = prev
    for (let d = 0.005; d <= 0.1; d += 0.005) {
      const hit = [prev - d, prev + d].find((e) => sag(e) * sag(e > prev ? e - 0.005 : e + 0.005) <= 0)
      if (hit !== undefined) {
        const [a, b] = hit > prev ? [hit - 0.005, hit] : [hit, hit + 0.005]
        z = root1d(sag, a, b, { tol: 1e-5 }).x
        break
      }
    }
    prev = z
    return lerp(z, top[2], smooth((h - STACK_BLEND) / (1 - STACK_BLEND)))
  })
  // the bar never drifts towards the feet on the way up: unfolding tucked elbows would carry it there
  const dir = Math.sign(top[2] - bottom[2])
  for (let i = 1; i < zs.length; i++) zs[i] = dir > 0 ? Math.max(zs[i], zs[i - 1]) : Math.min(zs[i], zs[i - 1])
  // the clamp releasing leaves a kink: a few [1 2 1] passes take it out (the ends stay put)
  for (let pass = 0; pass < 4; pass++) for (let i = 1, p = zs[0]; i < zs.length - 1; i++) [p, zs[i]] = [zs[i], (p + 2 * zs[i] + zs[i + 1]) / 4]
  zs[0] = bottom[2]
  const z = naturalCubic(hs, zs)
  return (c) => {
    const h = Math.max(0, Math.min(1, c))
    // the spline may overshoot the touch by a few mm where the path leaves it
    return [0, lerp(bottom[1], top[1], h), dir > 0 ? Math.max(z(h), bottom[2]) : Math.min(z(h), bottom[2])]
  }
}

function gripOf(ctx: Pick<BenchCtx, 'hold' | 'bar'>, center: V3) {
  return { pos: ctx.hold === 'dumbbell' ? center : add(center, ctx.bar!.sites.l.pos), axis: [1, 0, 0] as V3 }
}

// ---------- context ----------

export function benchContext(p: PressParams, skel: Skeleton, tempo: Tempo): BenchCtx {
  const a = p.benchAngle
  const hold = p.implement as Hold
  const incline = a >= 10
  const close = hold === 'barbell' && !incline && p.gripWidth <= CLOSE_GRIP
  const bench = pressBench({ backAngle: a, seatHeight: SEAT_H })
  const benchPose: ImplementPose = { id: 'bench', pos: [0, SEAT_H, 0], rot: qid() }
  const { hip, s } = placeBody(skel, a, bench, benchPose)
  const base = zeroQ(skel)
  trunkPose(skel, base, hip, s)
  restHead(skel, base, solidOf(bench, benchPose, 1))
  const legs = plantFeet(skel, base, hip, incline ? KNEE.incline : KNEE.flat, FEET_HALF)
  const f0 = fk(skel, base)
  const gh = scale(add(segPos(skel, f0, 'humerus_l'), segPos(skel, f0, 'humerus_r')), 0.5)
  const touch = localToWorld(skel, f0, 'thorax2', [0, incline ? TOUCH_Y.incline : close ? TOUCH_Y.close : TOUCH_Y.flat, 0.1])

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
  let lean = 60
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
      rig.pole = poleAt((lean = flareLean(skel, p.elbowFlare, (pole) => arm(bottom, pole))))
    }
  } else if (close) {
    // wrist extension and pole lean together: the record's flare with the forearm vertical in the side view
    const sagAt = (w: number) => {
      rig.wristBias = w
      lean = flareLean(skel, p.elbowFlare, (pole) => arm(bottom, pole))
      return forearmSag(skel, fk(skel, arm(bottom, poleAt(lean))))
    }
    const [lo, hi] = CLOSE_WRIST
    rig.wristBias = sagAt(hi) > 0 ? hi : sagAt(lo) < 0 ? lo : root1d(sagAt, lo, hi, { tol: 1e-3 }).x
    sagAt(rig.wristBias)
    rig.pole = poleAt(lean)
  } else rig.pole = poleAt((lean = flareLean(skel, p.elbowFlare, (pole) => arm(bottom, pole))))
  // lockout over the shoulder joints (the Smith bar stays on its rail over the touch point), elbows soft
  const topZ = hold === 'smith' ? bottom[2] : gh[2]
  const topX = hold === 'dumbbell' ? DB_TOP_X : 0
  const topY = root1d((y) => arm([topX, y, topZ])[skel.dof['elbow_l.flex']] - LOCK_ELBOW, bottom[1], bottom[1] + 0.8, { tol: 1e-6 }).x
  const top: V3 = [topX, topY, topZ]
  const stack = close ? stackPath(skel, top, bottom, (center) => fk(skel, arm(center))) : undefined
  const strokeOf = (stroke: Stroke) => {
    const r: ArmRig = { ...rig }
    const pose = (center: V3, pole: V3) => {
      const q = Float64Array.from(base)
      solveLeftArm(skel, q, gripOf({ hold, bar }, center), { ...r, pole })
      return q
    }
    let path = stack ?? ((c: number) => jCurve(top, bottom, c, stroke))
    if (hold === 'dumbbell') {
      const j = path
      const h = holdDumbbells(skel, (c, off, th) => pose(add(j(c), off), poleAt(th)), lean)
      path = (c) => add(j(c), h.offset(c))
      r.poleOf = h.pole
    } else {
      // the bar's path is set: the forearms stay as close to under it as the elbows allow, without closing onto the ribs
      r.poleOf = holdArm(skel, (c, pole) => pose(path(c), pole), lean, (th) => poleAt(th), close ? { front: CLOSE_FRONT } : {})
    }
    r.oblique = wristSchedule((c, o) => {
      const q = Float64Array.from(base)
      solveLeftArm(skel, q, gripOf({ hold, bar }, path(c)), { ...r, oblique: () => o }, c, true)
      return q[skel.dof['wrist_l.dev']]
    })
    return { path, rig: r }
  }
  const strokes = { ecc: strokeOf('ecc'), con: strokeOf('con') }

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
  return { kind: 'bench', tempo, setup, hold, base, bar, top, bottom, strokes, fixed }
}

export function sampleBench(u: number, skel: Skeleton, ctx: BenchCtx): Pose {
  const { c, name } = phaseAt(u, ctx.tempo)
  const stroke: Stroke = name === 'ecc' ? 'ecc' : 'con'
  const q = Float64Array.from(ctx.base)
  const center = ctx.strokes[stroke].path(c)
  solveLeftArm(skel, q, gripOf(ctx, center), ctx.strokes[stroke].rig, c)
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
