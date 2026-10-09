import { handFrame, implementFromHand, plantFoot, root1d, solveLegs, type FootTarget } from '../../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { fk, segPos } from '../../fk.ts'
import { bench, dumbbell, type ImplementSpec } from '../../implements.ts'
import { flatBench } from '../../implements/shared.ts'
import { kettlebell } from '../../implements/index.ts'
import { add, cross, DEG, norm, qaxis, qfromBasis, qmul, qrot, scale, sub, type Quat, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'
import { elbowPole, lerp, mirrorArm, other, phases, PROT, reach, shoulderMid, working, type P, type Side } from './common.ts'

// Bench-supported dumbbell rows.
// One-arm (307): free-side knee and hand on a flat bench (thigh near vertical, shin along the pad, hand flat under
// the shoulder), working-side foot on the floor beside it, trunk at torsoAngle from vertical and still. The dumbbell
// hangs from the protracted shoulder (elbow ~8), then the scapula sets back and the elbow drives up along the body:
// at the finish the upper arm is extended past the trunk line with the forearm vertical, so the dumbbell ends beside
// the waist (elbow ~90-100; research: elbow 0 -> 90-110, shoulder to 0..-30 extension).
// Chest-supported (306): prone on the back pad at benchAngle (45; trunk 90 - benchAngle from vertical), facing -Z with
// the shoulders just past the top end, legs nearly straight, reaching back astride the seat onto the balls of the
// feet, toes turned under. On a 30 deg pad the feet only reach the floor with the hips flexed ~20 deg, which drives
// the fronts of the thighs 25-40 mm into the lower pad whatever the stance width. The dumbbells hang under the shoulders (pronated, palms to the feet); the elbows flare to elbowFlare (~65,
// lead decision: the upper-back variant) and drive up until the upper arms are level with the back, forearms vertical.
// Kettlebell (321): the one-arm row with a kettlebell held by its handle (neutral, the handle along the body), the
// bell hanging under the fist; the finish flare opens until the bell clears the standing thigh.

const DB_KG = { one: 18, chest: 12 }
const KB_KG = 20
/** the drawn adjustable bench's seat pad: from the hinge forward, m (props/sockets.ts BENCH.seat.len) */
const DRAWN_SEAT = 0.32
const BENCH_TOP = 0.44
const BOTTOM_ELBOW = 8

/** one-arm setup */
const ONE = {
  /** kneeling knee and shin into the pad, m */
  sink: 0.004,
  /** kneeling thigh forward of vertical, deg (knee under the belly, hip a little lower) */
  kneeFwd: 12,
  /** standing foot: out from the midline, behind the hips (m), toe-out (deg), knee flexion it settles to (deg) */
  foot: { x: 0.26, toeOut: 14, knee: 14 },
  /** supporting hand: the lowest hand capsule this far into the pad (m); the arm nearly straight (elbow, deg) */
  handSink: 0.009,
  supportElbow: 12,
  /** palm centre behind the front end of the bench's seat pad, m */
  handFromFront: 0.12,
  /** fingers turned out from straight ahead, deg (a flat palm with the fingers forward needs full pronation) */
  handYaw: 10,
  /** upper arm extended past the trunk line at the finish, deg (the elbow above the back) */
  topExt: 20,
  /** dumbbell (plates and handle) to the standing thigh at the finish, m */
  thighGap: 0.012,
}

/** chest-supported setup */
const CHEST = {
  sink: 0.006,
  /**
   * feet astride the seat: balls of the feet out from the midline (m), toes turned out (deg), foot pitched toes-down
   * (deg), knee flexion the feet are set back to (deg)
   */
  feet: { x: 0.3, toeOut: 10, pitch: 45, knee: 4 },
  /**
   * the forefoot capsule models straight toes, so turned-under toes read this far into the floor, mm (the push-up's
   * FOOT_SINK case). A lead decision.
   */
  toeSink: 50,
  /** shoulder joints past the pad's top end along the pad, m */
  shoulderPast: 0.05,
  /** upper arm raised dorsally from the lateral line at the finish, deg (elbows just past the back, elbow ~88) */
  topDorsal: 26,
}

export type BenchRow = {
  kind: 'bench'
  tempo: Tempo
  setup: Setup
  variant: 'one' | 'chest'
  work: Side
  /** base posture (legs, pelvis, trunk) without the arms */
  base: (s: number) => Float64Array
  db: ImplementSpec[]
  benchPose: ImplementPose
  /** grip targets, world: hang (with protracted scapulae) and finish */
  bottom: V3
  top: V3
  sm0: V3
  /** elbow direction at the finish, world */
  topPole: V3
  /** one-arm: the supporting hand's target and fixed orientation */
  support?: { pos: V3; hand: Quat }
}

const lat = (s: Side) => (s === 'l' ? 1 : -1)

function trunkAngleOf(skel: Skeleton, q: Float64Array) {
  const f = fk(skel, q)
  const hips = scale(add(segPos(skel, f, 'femur_l'), segPos(skel, f, 'femur_r')), 0.5)
  const d = norm(sub(shoulderMid(skel, q), hips))
  return (Math.acos(Math.max(-1, Math.min(1, d[1]))) * 180) / Math.PI
}

function footContacts(skel: Skeleton, feet: FootTarget[], sites = ['heel', 'ball']): Contact[] {
  return feet.flatMap((ft) => sites.map((site) => ({ site: `${site}_${ft.side}`, kind: 'planted' as const, target: { world: add(ft.ankle, qrot(ft.rot, skel.data.sites[`${site}_${ft.side}`].local)) } })))
}

/** lowest point of a body region's capsules */
function regionBottom(skel: Skeleton, q: Float64Array, test: (region: string) => boolean) {
  return Math.min(...bodyCapsules(skel, fk(skel, q)).filter((c) => test(c.region)).map((c) => Math.min(c.a[1], c.b[1]) - c.r))
}

/**
 * finish grip for a hanging forearm: the upper arm leaves the shoulder along `hum` (world), the forearm hangs straight
 * down from the elbow
 */
function hangingForearmGrip(skel: Skeleton, q: Float64Array, side: Side, hum: V3): V3 {
  const gh = segPos(skel, fk(skel, q), `humerus_${side}`)
  const elbow = add(gh, scale(hum, skel.segments[skel.seg[`humerus_${side}`]].length))
  const forearmToGrip = skel.segments[skel.seg[`forearm_${side}`]].length - skel.data.sites[`grip_${side}`].local[1]
  return add(elbow, [0, -forearmToGrip, 0])
}

// ---------- one-arm ----------

/** flat hand, palm down, fingers forward and turned out by `yaw` deg */
function flatHand(side: Side, yaw: number): Quat {
  const base = side === 'l' ? qfromBasis([0, 1, 0], [0, 0, -1]) : qfromBasis([0, -1, 0], [0, 0, -1])
  return qmul(qaxis([0, 1, 0], lat(side) * yaw * DEG), base)
}

type OneBody = { hip: V3; tilt: number; foot?: FootTarget }

function oneBody(skel: Skeleton, q: Float64Array, work: Side, b: OneBody, s: number) {
  const free = other(work)
  setDofs(skel, q, {
    'lumbar.flex': 0,
    'thorax.flex': 2,
    // the trunk stays square: the working shoulder reaches with the scapula alone, the supporting arm stays still
    'thorax.rot': 0,
    'neck.flex': -20,
    'head.flex': -8,
    [`clavicle_${work}.prot`]: lerp(PROT.start, PROT.finish, s),
    [`clavicle_${work}.elev`]: lerp(0, -4, s),
    [`clavicle_${free}.prot`]: 6,
    [`clavicle_${free}.elev`]: 0,
    [`hip_${free}.flex`]: b.tilt + ONE.kneeFwd,
    [`hip_${free}.abd`]: 2,
    [`hip_${free}.rot`]: 0,
    [`knee_${free}.flex`]: 90 + ONE.kneeFwd,
    [`ankle_${free}.df`]: -40,
    [`grip_${work}.close`]: 1,
    [`grip_${free}.close`]: 0,
  })
  setPelvis(skel, q, b.hip, b.tilt)
  if (b.foot) solveLegs(skel, q, [b.foot])
}

function oneArmContext(p: P, skel: Skeleton, tempo: Tempo): BenchRow {
  const work = working(p)
  const free = other(work)
  const tilt = root1d((t) => {
    const q = zeroQ(skel)
    oneBody(skel, q, work, { hip: [0, 1, 0], tilt: t }, 0.5)
    return trunkAngleOf(skel, q) - p.torsoAngle
  }, 30, 100, { tol: 1e-5 }).x
  // hip height: the kneeling knee and shin rest on the pad
  const kneeling = (r: string) => r === `shank_${free}` || r === `thigh_${free}`
  const hipY = root1d((h) => {
    const q = zeroQ(skel)
    oneBody(skel, q, work, { hip: [0, h, 0], tilt }, 0)
    return regionBottom(skel, q, kneeling) - (BENCH_TOP - ONE.sink)
  }, 0.6, 1.3, { tol: 1e-6 }).x
  const body: OneBody = { hip: [0, hipY, 0], tilt }
  // standing foot beside the bench, behind the hips far enough that the knee settles soft
  const footAt = (z: number) => plantFoot(skel, work, [lat(work) * ONE.foot.x, 0, z], ONE.foot.toeOut)
  const kneeAt = (z: number) => {
    const q = zeroQ(skel)
    oneBody(skel, q, work, { ...body, foot: footAt(z) }, 0)
    return q[skel.dof[`knee_${work}.flex`]]
  }
  body.foot = footAt(root1d((z) => kneeAt(z) - ONE.foot.knee, -0.35, 0.2, { tol: 1e-6 }).x)
  const base = (s: number) => {
    const q = zeroQ(skel)
    oneBody(skel, q, work, body, s)
    return q
  }

  // supporting hand flat on the pad ahead of its shoulder, as far ahead as leaves the arm nearly straight
  const hand = flatHand(free, ONE.handYaw)
  const q0 = base(0.5)
  const shFree = segPos(skel, fk(skel, q0), `humerus_${free}`)
  const supportArm = (q: Float64Array, pos: V3) =>
    reach(skel, q, free, { pos, axis: [1, 0, 0], palm: [0, -1, 0], hand }, { pole: [lat(free) * 0.5, 0.1, -1], planeHint: 90 })
  /** grip-site target that puts the hand's lowest capsule ONE.handSink into the pad at this spot */
  const handTarget = (x: number, z: number): V3 => {
    const probe: V3 = [x, BENCH_TOP + 0.06, z]
    const q = Float64Array.from(q0)
    supportArm(q, probe)
    return [x, probe[1] - (regionBottom(skel, q, (r) => r === `hand_${free}`) - (BENCH_TOP - ONE.handSink)), z]
  }
  const supportElbowAt = (ahead: number) => {
    const q = Float64Array.from(q0)
    supportArm(q, handTarget(shFree[0], shFree[2] + ahead))
    return q[skel.dof[`elbow_${free}.flex`]]
  }
  const ahead = root1d((a) => supportElbowAt(a) - ONE.supportElbow, 0, 0.5, { tol: 1e-5 }).x
  const supportPos = handTarget(shFree[0], shFree[2] + ahead)

  // bench along Z under the knee and the hand, the hand near the front of the seat pad; the kneeling foot hangs off
  // the rear end
  const knee = segPos(skel, fk(skel, q0), `tibia_${free}`)
  const benchX = (knee[0] + supportPos[0]) / 2
  const benchPose: ImplementPose = { id: 'bench', pos: [benchX, BENCH_TOP, supportPos[2] - (DRAWN_SEAT - ONE.handFromFront)], rot: [0, 0, 0, 1] }
  const benchSpec: ImplementSpec = { ...flatBench({ seatHeight: BENCH_TOP }), sites: { hand: { pos: sub(supportPos, benchPose.pos), normal: [0, 1, 0] } } }

  const db = p.implement === 'kettlebell' ? kettlebell({ id: `kb_${work}`, kg: KB_KG }) : dumbbell({ id: `db_${work}`, mass: DB_KG.one })
  const v: BenchRow = {
    kind: 'bench', tempo, setup: undefined as never, variant: 'one', work, base, db: [db], benchPose,
    bottom: [0, 0, 0], top: [0, 0, 0], sm0: [0, 0, 0], topPole: [0, 0, 0], support: { pos: supportPos, hand },
  }
  // finish: upper arm back along the trunk and past it by topExt, out by the flare, forearm hanging; the flare opens
  // just enough that the dumbbell clears the standing thigh
  const q1 = base(1)
  const th = fk(skel, q1).rot[skel.seg.thorax2]
  const humAt = (flare: number) => {
    const e = ONE.topExt * DEG, a = flare * DEG
    return norm(qrot(th, [lat(work) * Math.sin(a), -Math.cos(a) * Math.cos(e), -Math.cos(a) * Math.sin(e)]))
  }
  const thighGapAt = (flare: number) => {
    const q = Float64Array.from(q1)
    v.top = hangingForearmGrip(skel, q1, work, humAt(flare))
    v.topPole = humAt(flare)
    armsOne(skel, q, v, v.top)
    const thigh = bodyCapsules(skel, fk(skel, q)).filter((c) => c.region === `thigh_${work}`)
    const solids = placeParts(db, dbPose(skel, q, db))
    return Math.min(...thigh.flatMap((c) => solids.map((sd) => capsuleSolidClearance(c, sd)))) - ONE.thighGap
  }
  const flare = thighGapAt(p.elbowFlare) >= 0 ? p.elbowFlare : root1d(thighGapAt, p.elbowFlare, 60, { tol: 1e-4 }).x
  v.topPole = humAt(flare)
  v.top = hangingForearmGrip(skel, q1, work, v.topPole)
  // hang: grip straight under the shoulder, elbow just short of straight
  const qb = base(0)
  const sh = segPos(skel, fk(skel, qb), `humerus_${work}`)
  v.sm0 = sh
  const elbowAt = (d: number) => {
    const q = Float64Array.from(qb)
    armsOne(skel, q, v, [sh[0], sh[1] - d, sh[2]])
    return q[skel.dof[`elbow_${work}.flex`]]
  }
  v.bottom = [sh[0], sh[1] - root1d((d) => elbowAt(d) - BOTTOM_ELBOW, 0.45, 0.75, { tol: 1e-6 }).x, sh[2]]
  const contacts: Contact[] = [
    ...footContacts(skel, [body.foot]),
    { site: `grip_${free}`, kind: 'support', target: { implement: 'bench', grip: 'hand' } },
    { site: `grip_${work}`, kind: 'grip', target: { implement: db.id, grip: db.kind === 'kettlebell' ? 'handle' : 'c' } },
  ]
  // the supporting palm rests on the pad
  v.setup = { implements: [db, benchSpec], contacts, tempo, symmetric: false, rests: [{ implement: benchSpec.id, regions: [`hand_${free}`], tol: 15 }] }
  return v
}

function armsOne(skel: Skeleton, q: Float64Array, v: BenchRow, target: V3) {
  const work = v.work
  // neutral grip: the handle runs along the body, palm facing the bench
  const pole = norm(add(elbowPole(skel, q, work, 25, 0.9), scale(v.topPole, 0.6)))
  reach(skel, q, work, { pos: target, axis: [0, 0, 1], palm: [-lat(work), 0, 0] }, { pole, planeHint: 90 })
  if (v.support) {
    const free = other(work)
    reach(skel, q, free, { pos: v.support.pos, axis: [1, 0, 0], palm: [0, -1, 0], hand: v.support.hand }, { pole: [lat(free) * 0.5, 0.1, -1], planeHint: 90 })
  }
}

function dbPose(skel: Skeleton, q: Float64Array, spec: ImplementSpec): ImplementPose {
  const h = handFrame(skel, fk(skel, q), spec.id.endsWith('_l') ? 'l' : 'r')
  if (spec.kind === 'kettlebell') {
    // the handle along the grip axis, the bell hanging straight down from it
    const x = norm(h.axis)
    const rot = qfromBasis(x, norm(cross(cross(x, [0, 1, 0]), x)))
    return { id: spec.id, pos: sub(h.pos, qrot(rot, spec.sites.handle.pos)), rot }
  }
  return { id: spec.id, pos: h.pos, rot: implementFromHand(h.axis, h.palm) }
}

// ---------- chest-supported ----------

function chestBody(skel: Skeleton, q: Float64Array, hip: V3, tilt: number, s: number, feet?: FootTarget[]) {
  setDofs(skel, q, {
    'lumbar.flex': 0,
    'thorax.flex': 2,
    'neck.flex': -12,
    'head.flex': -6,
    'clavicle_*.prot': lerp(PROT.start, PROT.finish, s),
    'clavicle_*.elev': lerp(2, -3, s),
    'grip_*.close': 1,
  })
  // prone, facing -Z (yaw 180), head up the pad
  setPelvis(skel, q, hip, tilt, 180)
  if (feet) solveLegs(skel, q, feet)
}

/** ball of the foot on the floor at z, heel up, toes towards -Z (the lifter's front); the lifter's left is -X */
function proneFoot(skel: Skeleton, side: Side, z: number): FootTarget {
  const { x, toeOut, pitch } = CHEST.feet
  const rot = qmul(qaxis([0, 1, 0], (180 + (side === 'l' ? toeOut : -toeOut)) * DEG), qaxis([1, 0, 0], pitch * DEG))
  const ankle = sub([side === 'l' ? -x : x, 0, z], qrot(rot, skel.data.sites[`ball_${side}`].local))
  return { side, rot, ankle }
}

/** toes turned under, lying flat on the floor */
function toesFlat(skel: Skeleton, q: Float64Array) {
  for (const side of ['l', 'r'] as const) {
    const k = skel.dof[`toe_${side}.flex`]
    q[k] = root1d((t) => {
      q[k] = t
      return qrot(fk(skel, q).rot[skel.seg[`toes_${side}`]], [0, 0, 1])[1]
    }, -60, 30, { tol: 1e-6, scan: 9 }).x
  }
}

function chestContext(p: P, skel: Skeleton, tempo: Tempo): BenchRow {
  const angle = p.benchAngle ?? 30
  const a = angle * DEG
  const along: V3 = [0, Math.sin(a), -Math.cos(a)]
  const normal: V3 = [0, Math.cos(a), Math.sin(a)]
  const benchSpec = bench({ backAngle: angle, seatHeight: BENCH_TOP })
  const benchPose: ImplementPose = { id: 'bench', pos: [0, BENCH_TOP, 0], rot: [0, 0, 0, 1] }
  const padLen = 0.84
  const tilt = root1d((t) => {
    const q = zeroQ(skel)
    chestBody(skel, q, [0, 1, 0], t, 0.5)
    return trunkAngleOf(skel, q) - p.torsoAngle
  }, 20, 90, { tol: 1e-5 }).x
  const padPart = placeParts(benchSpec, benchPose)[1]
  // slide the body along the pad until the shoulders pass its top end, the trunk pressed into it by CHEST.sink
  let hip: V3 = add(add(benchPose.pos, scale(along, 0.4)), scale(normal, 0.15))
  for (let pass = 0; pass < 4; pass++) {
    const q = zeroQ(skel)
    chestBody(skel, q, hip, tilt, 0.5)
    const f = fk(skel, q)
    const hips = scale(add(segPos(skel, f, 'femur_l'), segPos(skel, f, 'femur_r')), 0.5)
    const toShoulders = sub(shoulderMid(skel, q), hips)
    const tAlong = padLen + CHEST.shoulderPast - (toShoulders[1] * along[1] + toShoulders[2] * along[2])
    const at = (d: number) => add(add(benchPose.pos, scale(along, tAlong)), scale(normal, d))
    const d = root1d((dd) => {
      const qq = zeroQ(skel)
      chestBody(skel, qq, at(dd), tilt, 0.5)
      const trunk = bodyCapsules(skel, fk(skel, qq)).filter((c) => c.region === 'trunk')
      return Math.min(...trunk.map((c) => capsuleSolidClearance(c, padPart))) + CHEST.sink
    }, 0, 0.4, { tol: 1e-6 }).x
    hip = at(d)
  }
  // astride the seat: the balls of the feet set back until the knees are nearly straight
  const feetAt = (z: number) => (['l', 'r'] as const).map((side) => proneFoot(skel, side, z))
  const kneeAt = (z: number) => {
    const q = zeroQ(skel)
    chestBody(skel, q, hip, tilt, 0.5, feetAt(z))
    return q[skel.dof['knee_l.flex']]
  }
  const feet = feetAt(root1d((z) => kneeAt(z) - CHEST.feet.knee, hip[2] + 0.2, hip[2] + 1.2, { tol: 1e-6 }).x)
  const base = (s: number) => {
    const q = zeroQ(skel)
    chestBody(skel, q, hip, tilt, s, feet)
    toesFlat(skel, q)
    return q
  }
  const db = [dumbbell({ id: 'db_l', mass: DB_KG.chest }), dumbbell({ id: 'db_r', mass: DB_KG.chest })]
  const v: BenchRow = {
    kind: 'bench', tempo, setup: undefined as never, variant: 'chest', work: 'l', base, db, benchPose,
    bottom: [0, 0, 0], top: [0, 0, 0], sm0: [0, 0, 0], topPole: [0, 0, 0],
  }
  // finish: upper arm at elbowFlare from the trunk's long axis, raised dorsally to the level of the back, forearm
  // hanging vertical under the elbow
  const q1 = base(1)
  const th = fk(skel, q1).rot[skel.seg.thorax2]
  const fl = p.elbowFlare * DEG, up = CHEST.topDorsal * DEG
  v.topPole = norm(qrot(th, [Math.sin(fl) * Math.cos(up), -Math.cos(fl), -Math.sin(fl) * Math.sin(up)]))
  v.top = hangingForearmGrip(skel, q1, 'l', v.topPole)
  // hang: grips straight under the shoulders, elbows just short of straight
  const qb = base(0)
  const sh = segPos(skel, fk(skel, qb), 'humerus_l')
  v.sm0 = sh
  const elbowAt = (d: number) => {
    const q = Float64Array.from(qb)
    armsChest(skel, q, v, [sh[0], sh[1] - d, sh[2]])
    return q[skel.dof['elbow_l.flex']]
  }
  v.bottom = [sh[0], sh[1] - root1d((d) => elbowAt(d) - BOTTOM_ELBOW, 0.45, 0.75, { tol: 1e-6 }).x, sh[2]]
  const contacts: Contact[] = [
    ...footContacts(skel, feet, ['ball']),
    { site: 'grip_l', kind: 'grip', target: { implement: 'db_l', grip: 'c' } },
    { site: 'grip_r', kind: 'grip', target: { implement: 'db_r', grip: 'c' } },
  ]
  // yaw 180 reads as asymmetric to the symmetry gate; the arms are mirrored every frame
  v.setup = { implements: [...db, benchSpec], contacts, tempo, symmetric: false, tolerances: { floor: CHEST.toeSink } }
  return v
}

function armsChest(skel: Skeleton, q: Float64Array, v: BenchRow, target: V3) {
  // pronated: handle across, palms towards the feet (+Z for this lifter)
  reach(skel, q, 'l', { pos: target, axis: [1, 0, 0], palm: [0, -0.3, 1] }, { pole: v.topPole, planeHint: 60 })
  mirrorArm(skel, q)
}

// ---------- sampling ----------

export function benchContext(p: P, skel: Skeleton, tempo: Tempo): BenchRow {
  if (p.support === 'bench') return oneArmContext(p, skel, tempo)
  return chestContext(p, skel, tempo)
}

export function sampleBench(u: number, _p: P, skel: Skeleton, v: BenchRow): Pose {
  const ph = phases(u, v.tempo)
  const q = v.base(ph.s)
  const sh = segPos(skel, fk(skel, q), `humerus_${v.work}`)
  const hang = add(v.bottom, sub(sh, v.sm0))
  const target = add(scale(hang, 1 - ph.g), scale(v.top, ph.g))
  if (v.variant === 'one') armsOne(skel, q, v, target)
  else armsChest(skel, q, v, target)
  return { q, implements: [...v.db.map((spec) => dbPose(skel, q, spec)), v.benchPose], contacts: v.setup.contacts }
}
