import { attachHand, legKinematics, root1d, writeLeg, type FootTarget } from '../../constraints.ts'
import { bodyCapsules } from '../../collide.ts'
import { fk } from '../../fk.ts'
import { siteWorld, type ImplementSpec, type Part, type Site } from '../../implements.ts'
import { hackSled, hackSquat, leverPose, pendulumArm, pendulumSquat, sledPose, HACK, PENDULUM, CARRIAGE } from '../../implements/stations.ts'
import { add, DEG, qaxis, qmul, qrot, sub, type Quat, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Side, type Skeleton } from '../../skeleton.ts'
import { setPelvis } from '../standing.ts'
import { armPairs } from './holds.ts'

// Squats under a shoulder carriage (hack squat, reverse hack squat, pendulum squat; the hack calf raise rides the same
// sled). The trunk is held rigid against the carriage, so the body is registered once in an upright carriage frame
// (back on the pad, or the chest on it facing the machine), shoulders under the shoulder pads, and every frame the
// pelvis follows the carriage while the legs are solved to the feet on the foot plate. The arms hold the carriage
// handles and ride with it, so they are solved once.

/** carriage pose: origin (shoulder line on the pad surface) and its rotation about X, deg (90 = an upright pad) */
export type CarriagePose = { pos: V3; angle: number }
export type Facing = 'back' | 'chest'

export type Rider = {
  facing: Facing
  /** hip midpoint relative to the carriage origin with the carriage upright */
  hipRel: V3
  /** pelvis tilt with the carriage upright */
  tilt: number
  spine: Record<string, number>
  /** arm DOFs on the handles (constant) */
  arms: [number, number][]
}

/**
 * Body on the carriage: the pads sink this far into the back or chest (m), and into the shoulders' girdle capsule. The
 * round girdle capsule stands proud of the sloping trapezius, so the shoulder pads go deeper into it (as the standing
 * calf machine's yoke: calf-raise.ts GIRDLE_PROUD).
 */
export const RIDE = { back: 0.01, shoulder: 0.048 }
/** girdle vs shoulder pads, mm (lead decision, as the calf machine's YOKE_REST) */
export const SHOULDER_REST = 50
/**
 * handles lowered from the shoulder line to hip height, m: the hands hold them at the sides, arms hanging, as on sleds
 * with side handles. At the drawn default (beside the shoulder pads) a forward-pointing handle needs more elbow flexion
 * and forearm supination than the joints have.
 */
export const HANDLE_DROP = 0.8

const UPRIGHT = 90
/** facing the machine (reverse hack), the machine is turned 180 deg about Y round the lifter, who faces +Z as always */
const TURN: Quat = qaxis([0, 1, 0], Math.PI)
export const turned = (v: V3): V3 => [-v[0], v[1], -v[2]]
export const turnPose = (p: ImplementPose): ImplementPose => ({ id: p.id, pos: turned(p.pos), rot: qmul(TURN, p.rot) })
const turnFoot = (f: FootTarget): FootTarget => ({ side: f.side, rot: qmul(TURN, f.rot), ankle: turned(f.ankle) })
const ARM_SEED = { 'clavicle_*.prot': 2, 'clavicle_*.elev': 0, 'grip_*.close': 1 }

function movedSite(s: Site, d: V3): Site {
  return { ...s, pos: add(s.pos, d) }
}

function movedPart(p: Part, d: V3): Part {
  return p.shape === 'cylinder' ? { ...p, a: add(p.a, d), b: add(p.b, d) } : { ...p, center: add(p.center, d) }
}

/**
 * a carriage implement (hack sled, pendulum arm) with its handles moved `d` in its own frame; `d[0]` moves each handle
 * outwards (away from the midline)
 */
export function lowerHandles(spec: ImplementSpec, d: V3): ImplementSpec {
  const handles = new Set(spec.parts.map((p, i) => (p.shape === 'cylinder' && Math.abs(p.r - CARRIAGE.handle.r) < 1e-9 ? i : -1)).filter((i) => i >= 0))
  const out = (x: number): V3 => [Math.sign(x) * d[0], d[1], d[2]]
  return {
    ...spec,
    parts: spec.parts.map((p, i) => (handles.has(i) && p.shape === 'cylinder' ? movedPart(p, out(p.a[0])) : p)),
    sites: Object.fromEntries(Object.entries(spec.sites).map(([k, s]) => [k, k.startsWith('handle_') ? movedSite(s, out(s.pos[0])) : s])),
  }
}

/** a carriage with its back pad ending `to` m down the pad from the shoulder line (CARRIAGE.back.to by default) */
export function trimPad(spec: ImplementSpec, to: number): ImplementSpec {
  const { back } = CARRIAGE
  const pad = { shape: 'box' as const, center: [0, -back.thick / 2, (back.from + to) / 2] as V3, size: [back.width, back.thick, to - back.from] as V3, pad: true }
  return { ...spec, parts: [pad, ...spec.parts.slice(1)] }
}

function rideRotation(angle: number): Quat {
  return qaxis([1, 0, 0], (angle - UPRIGHT) * DEG)
}

/** pelvis on a carriage at `c` (spine set from the rider) */
export function ridePelvis(skel: Skeleton, q: Float64Array, r: Rider, c: CarriagePose) {
  setDofs(skel, q, r.spine)
  const g = c.angle - UPRIGHT
  const hip = add(c.pos, qrot(rideRotation(c.angle), r.hipRel))
  // in the machine's frame a rider facing the pad faces -Z (yaw 180); the machine is turned instead
  if (r.facing === 'back') setPelvis(skel, q, hip, r.tilt + g)
  else setPelvis(skel, q, turned(hip), r.tilt - g)
  for (const [i, x] of r.arms) q[i] = x
}

/**
 * Register the body on an upright carriage: the pad plane meets the back (or chest) with RIDE.back of sink, the
 * shoulder line sits RIDE.shoulder into the girdle capsules; the hands close on `carriage`'s handle sites.
 */
export function registerRider(skel: Skeleton, o: { facing: Facing; tilt: number; spine: Record<string, number>; carriage: ImplementSpec; pole: V3 }): Rider {
  const q = zeroQ(skel)
  setDofs(skel, q, o.spine)
  setPelvis(skel, q, [0, 1, 0], o.tilt, o.facing === 'back' ? 0 : 180)
  const caps = bodyCapsules(skel, fk(skel, q))
  const near = Math.min(...caps.filter((c) => c.segment.startsWith('thorax')).flatMap((c) => [c.a[2] - c.r, c.b[2] - c.r]))
  const top = Math.max(...caps.filter((c) => c.region.startsWith('girdle')).flatMap((c) => [c.a[1] + c.r, c.b[1] + c.r]))
  const origin: V3 = [0, top - RIDE.shoulder, near + RIDE.back]
  const rider: Rider = { facing: o.facing, hipRel: sub([0, 1, 0], origin), tilt: o.tilt, spine: o.spine, arms: [] }
  // hands on the handles with the carriage upright at `origin` (left solved, mirrored)
  setDofs(skel, q, ARM_SEED)
  const pose: ImplementPose = { id: o.carriage.id, pos: origin, rot: qaxis([1, 0, 0], UPRIGHT * DEG) }
  const side: Side = o.facing === 'back' ? 'l' : 'r'
  const g = siteWorld(o.carriage, pose, `handle_${side}`)
  const palm: V3 = o.facing === 'back' ? [-1, 0, 0] : [1, 0, 0]
  attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm }, { pole: o.pole, planeHint: 60, wristBias: 0 })
  rider.arms = armPairs(skel, q)
  return rider
}

/** foot flat on a plate tilted toes-up `tilt` deg (about X), its midfoot at `spot`, turned out `toeOut`, facing +Z or -Z */
export function plateFoot(skel: Skeleton, side: Side, spot: V3, tilt: number, toeOut: number, facing: 1 | -1): FootTarget {
  const out = (side === 'l' ? toeOut : -toeOut) * DEG
  const rot = qmul(qaxis([1, 0, 0], -tilt * DEG), qaxis([0, 1, 0], (facing === 1 ? 0 : Math.PI) + out))
  return { side, rot, ankle: sub(spot, qrot(rot, skel.data.sites[`midfoot_${side}`].local)) }
}

export function plantedOn(skel: Skeleton, feet: FootTarget[], sites = ['heel', 'ball']): Contact[] {
  return feet.flatMap((f) => sites.map((site): Contact => ({ site: `${site}_${f.side}`, kind: 'planted', target: { world: add(f.ankle, qrot(f.rot, skel.data.sites[`${site}_${f.side}`].local)) } })))
}

export function rideLegs(skel: Skeleton, q: Float64Array, feet: FootTarget[]) {
  const f = fk(skel, q)
  const pr = f.rot[skel.seg.pelvis]
  return feet.map((foot) => {
    const leg = legKinematics(skel, foot.side, f.pos[skel.seg[`femur_${foot.side}`]], pr, foot)
    writeLeg(skel, q, foot.side, leg)
    return leg
  })
}

// ---------- hack squat ----------

export type Hack = {
  frame: ImplementSpec
  sled: ImplementSpec
  rider: Rider
  feet: FootTarget[]
  /** sled travel at the bottom and at the top, m */
  travel: [number, number]
}

/** hack squat sled pose as a carriage pose */
export function hackCarriage(frame: ImplementSpec, s: number): CarriagePose {
  const p = sledPose('hack_sled', frame, s)
  return { pos: p.pos, angle: HACK.angle }
}

/** knee flexion of the planted legs with the sled at travel `s` */
export function hackKnee(skel: Skeleton, q: Float64Array, h: Pick<Hack, 'frame' | 'rider' | 'feet'>, s: number) {
  ridePelvis(skel, q, h.rider, hackCarriage(h.frame, s))
  return rideLegs(skel, q, h.feet)[0].knee
}

/** travel at which the planted knees bend `knee` deg (the knees bend as the sled comes down) */
export function hackTravel(skel: Skeleton, h: Pick<Hack, 'frame' | 'rider' | 'feet'>, knee: number) {
  const q = zeroQ(skel)
  return root1d((s) => hackKnee(skel, q, h, s) - knee, HACK.travel + 0.6, -0.3, { tol: 1e-7, scan: 36 })
}

export function hackPose(skel: Skeleton, h: Hack, s: number): { q: Float64Array; implements: ImplementPose[] } {
  const q = zeroQ(skel)
  hackKnee(skel, q, h, s)
  const poses: ImplementPose[] = [{ id: h.frame.id, pos: [0, 0, 0], rot: [0, 0, 0, 1] }, sledPose(h.sled.id, h.frame, s)]
  return { q, implements: h.rider.facing === 'back' ? poses : poses.map(turnPose) }
}

/**
 * Hack frame and sled for a rider whose feet sit `along` m from the plate centre (down the plate's +Z); the plate
 * moves along the rails so the rider stands tall with the sled `topTravel` up the rails.
 */
export function hackSetup(skel: Skeleton, o: { facing: Facing; tilt: number; spine: Record<string, number>; pole: V3; width: number; toeOut: number; along: number; ahead: number; topKnee: number; topTravel: number; padTo?: number }) {
  const lowered = lowerHandles(hackSled(), [0, 0, HANDLE_DROP])
  const sled = o.padTo === undefined ? lowered : trimPad(lowered, o.padTo)
  const rider = registerRider(skel, { facing: o.facing, tilt: o.tilt, spine: o.spine, carriage: sled, pole: o.pole })
  const tilt = HACK.plateTilt
  const plateRot = qaxis([1, 0, 0], -tilt * DEG)
  const feetAt = (plate: V3) => {
    const c = add(plate, qrot(plateRot, [0, 0, o.along]))
    // facing the machine (-Z) the lifter's left is -X
    const sx = o.facing === 'back' ? 1 : -1
    const feet = (['l', 'r'] as const).map((side) => plateFoot(skel, side, add(c, qrot(plateRot, [(side === 'l' ? sx : -sx) * o.width / 2, 0, 0])), tilt, o.toeOut, o.facing === 'back' ? 1 : -1))
    return o.facing === 'back' ? feet : feet.map(turnFoot)
  }
  // the plate `ahead` of its default spot; the rails move up or down until the rider stands tall `topTravel` up them
  const plate = add(HACK.plate.at, [0, 0, o.ahead])
  const feet = feetAt(plate)
  const q = zeroQ(skel)
  const frameAt = (k: number) => hackSquat({ plate, bottom: add(HACK.bottom, [0, k, 0]) })
  const k = root1d((k) => {
    const frame = frameAt(k)
    return root1d((s) => hackKnee(skel, q, { frame, rider, feet }, s) - o.topKnee, HACK.travel + 0.6, -0.3, { tol: 1e-8, scan: 36 }).x - o.topTravel
  }, -0.6, 0.6, { tol: 1e-7, scan: 12 }).x
  return { frame: frameAt(k), sled, rider, feet }
}

// ---------- pendulum squat ----------

export type Pendulum = {
  frame: ImplementSpec
  arm: ImplementSpec
  rider: Rider
  feet: FootTarget[]
  pivot: V3
  /** arm angle at the bottom and at the top, deg */
  swing: [number, number]
}

export function pendulumCarriage(arm: ImplementSpec, pivot: V3, deg: number): CarriagePose {
  const pose = leverPose(arm.id, pivot, deg)
  const site = arm.sites.carriage
  // the carriage's rotation about X in the arm frame: its normal (local Y) turned from +Y
  const n = site.normal!
  const local = Math.atan2(n[2], n[1]) / DEG
  return { pos: add(pose.pos, qrot(pose.rot, site.pos)), angle: deg + local }
}

export function pendulumKnee(skel: Skeleton, q: Float64Array, p: Pick<Pendulum, 'arm' | 'rider' | 'feet' | 'pivot'>, deg: number) {
  ridePelvis(skel, q, p.rider, pendulumCarriage(p.arm, p.pivot, deg))
  return rideLegs(skel, q, p.feet)[0].knee
}

export function pendulumPose(skel: Skeleton, p: Pendulum, deg: number): { q: Float64Array; implements: ImplementPose[] } {
  const q = zeroQ(skel)
  pendulumKnee(skel, q, p, deg)
  return { q, implements: [{ id: p.frame.id, pos: [0, 0, 0], rot: [0, 0, 0, 1] }, leverPose(p.arm.id, p.pivot, deg)] }
}

/**
 * Pendulum frame and arm built round the rider standing tall: the carriage (back pad leaning `lean` deg) on the
 * shoulders at the top with the arm at 0 deg, the pivot `reach` behind and above the shoulder line along `pitch` deg
 * above the horizontal, the platform under the feet.
 */
export function pendulumSetup(skel: Skeleton, o: { tilt: number; spine: Record<string, number>; pole: V3; width: number; toeOut: number; lean: number; reach: number; pitch: number; platformTilt: number; topKnee: number; feetAhead: number }) {
  // the arm's carriage is the hack sled's: register on it with the handles lowered as there
  const rider = registerRider(skel, { facing: 'back', tilt: o.tilt, spine: o.spine, carriage: lowerHandles(hackSled(), [0, 0, HANDLE_DROP]), pole: o.pole })
  const tilt = o.platformTilt
  const plateRot = qaxis([1, 0, 0], -tilt * DEG)
  const platform: V3 = [0, PENDULUM.platform.at[1], o.feetAhead]
  const feet = (['l', 'r'] as const).map((side) => plateFoot(skel, side, add(platform, qrot(plateRot, [(side === 'l' ? 1 : -1) * o.width / 2, 0, 0])), tilt, o.toeOut, 1))
  // standing tall: the shoulder line above z = 0 where the knees reach topKnee with the pad leaning `lean`
  const q = zeroQ(skel)
  const angle = UPRIGHT - o.lean
  const y = root1d((y) => {
    ridePelvis(skel, q, rider, { pos: [0, y, 0], angle })
    return rideLegs(skel, q, feet)[0].knee - o.topKnee
  }, 0.8, 2.6, { tol: 1e-8, scan: 24 }).x
  const shoulder: V3 = [0, y, 0]
  const pivot = add(shoulder, [0, o.reach * Math.sin(o.pitch * DEG), -o.reach * Math.cos(o.pitch * DEG)])
  const frame = pendulumSquat({ pivot, platform, tilt })
  const arm = pendulumArm({ pivot, shoulder, lean: o.lean })
  const down = arm.sites.carriage.axis!
  return { frame, arm: lowerHandles(arm, [down[0] * HANDLE_DROP, down[1] * HANDLE_DROP, down[2] * HANDLE_DROP]), rider, feet, pivot }
}
