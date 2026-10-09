import { bodyCapsules, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { attachHand, implementFromHand, root1d } from '../../constraints.ts'
import { centerOfMass, fk, segPos, sitePos } from '../../fk.ts'
import { dumbbell, siteWorld, type ImplementSpec } from '../../implements.ts'
import { cross, DEG, dist, dot, lerp, norm, qaxis, qmul, qrot, RAD, scale, sub, type V3 } from '../../math.ts'
import { setDofs, setScapula, zeroQ, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { mirrorArm } from '../isolation.ts'
import type { ParamsOf } from '../schemas.ts'
import { ARM_BALANCE_TOL, limitSway, makeStance, plantedContacts, stanceWidth, standBalanced, type StanceSetup, type Sway } from '../standing.ts'
import type { Setup } from '../types.ts'

// Waiter curl (730): one dumbbell held upright by its top head, both palms cupped under the plate side by side (the
// goblet hold), elbows at the sides. A symmetric reference arm (palms up, upper arm hanging, drifting forward near the
// top) sets the height and reach of the hands; the dumbbell stays vertical on the midline with its cups there and both
// arms are solved onto it. The rep runs from where the lower head clears the thighs (the bell held a little forward,
// tipping with the forearms below LEAN.from) to where it would reach the chest.

type P = ParamsOf<'curl'>

const WAITER = {
  kg: 10,
  knee: 6,
  tilt: 2,
  /** the dumbbell's lower head keeps this far off the thighs at the bottom and off the chest and chin at the top, m */
  thighs: 0.012,
  chest: 0.015,
  elbow: { min: 30, max: 135 },
  drift: 10,
  /**
   * upper arms forward at the bottom, deg: the bell is held a little forward, so its lower head clears the thighs with
   * the elbows at ~39 (at 4 the rep stopped at ~73) and the arms converge on it in front of the belly, not through it.
   * 25 keeps the upper arms ~7 mm inside ARMS_TOL against the chest at the bottom (at 20 they were within 3 mm)
   */
  lean: 25,
  /** elbows' pole: out and back from straight down (thorax frame) */
  pole: [1.5, -1, -0.5] as V3,
}
/** trunk / upper arm allowance at the bottom, mm (the default is 20) */
const ARMS_TOL = 30
/** goblet cup in the dumbbell frame (X up the handle, Y forward, Z left): squat.ts GOBLET, so the hands match */
const CUP = { at: [0.033, 0.03, 0.06] as V3, fingers: [0, 1, -0.4] as V3, palm: [1, 0, -0.3] as V3 }
/** forearm angle below level past which the dumbbell tips forward with it, and the blend width, deg */
const LEAN = { from: 20, soft: 8 }
/** dumbbell upright, local Y forward */
const UPRIGHT = implementFromHand([0, 1, 0], [0, 0, 1])

export type Waiter = {
  tempo: Tempo
  setup: Setup
  stance: StanceSetup
  db: ImplementSpec
  elbow: [number, number]
  sway?: Sway
}

function cupHand(): { axis: V3; palm: V3 } {
  const f = norm(CUP.fingers)
  const p0 = norm(CUP.palm)
  const palm = norm(sub(p0, scale(f, dot(p0, f))))
  return { axis: cross(palm, f), palm }
}

function base(skel: Skeleton) {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': -1, 'thorax.flex': 1, 'neck.flex': -3, 'clavicle_*.prot': -2, 'grip_*.close': 1 })
  return q
}

/** reference arms: upper arm hanging (drifting forward near the top), palms up, elbow e */
function reference(skel: Skeleton, q: Float64Array, e: number, c: number) {
  const a = WAITER.drift * c * c + WAITER.lean * (1 - c)
  setDofs(skel, q, { 'shoulder_*.plane': 90, 'shoulder_*.elev': a, 'shoulder_*.rot': 0, 'elbow_*.flex': e, 'forearm_*.pro': -80, 'wrist_*.flex': 0 })
  setScapula(skel, q, 'l')
  setScapula(skel, q, 'r')
}

/**
 * the dumbbell on the midline: its left cup at the cup spacing, in the reference hand's direction from the shoulder in
 * the side view and at its distance (so the elbow keeps its keyed angle). Upright while the forearms are above
 * LEAN.from below level; past that its top tips forward with them, so the wrists stay inside their extension
 */
function dbPose(skel: Skeleton, q: Float64Array, db: ImplementSpec): ImplementPose {
  const f = fk(skel, q)
  const g = sitePos(skel, f, 'grip_l')
  const sh = segPos(skel, f, 'humerus_l')
  const fore = norm(sub(segPos(skel, f, 'hand_l'), segPos(skel, f, 'forearm_l')))
  const below = Math.asin(Math.max(-1, Math.min(1, -fore[1]))) * RAD
  const w = LEAN.soft
  const lean = w * Math.log(1 + Math.exp((below - LEAN.from) / w))
  const rot = qmul(qaxis([1, 0, 0], lean * DEG), UPRIGHT)
  const cup = qrot(rot, CUP.at)
  const dx = cup[0] - sh[0], dy = g[1] - sh[1], dz = g[2] - sh[2]
  const k = Math.sqrt(Math.max(0, dist(g, sh) ** 2 - dx * dx) / (dy * dy + dz * dz))
  const at: V3 = [cup[0], sh[1] + k * dy, sh[2] + k * dz]
  return { id: db.id, pos: sub(at, cup), rot }
}

function arms(skel: Skeleton, q: Float64Array, v: Pick<Waiter, 'db'>, e: number, c: number): ImplementPose {
  reference(skel, q, e, c)
  const pose = dbPose(skel, q, v.db)
  const f = fk(skel, q)
  const g = siteWorld(v.db, pose, 'cup_l')
  const palm = qrot(pose.rot, cupHand().palm)
  attachHand(skel, q, 'l', { pos: g.pos, axis: g.axis!, palm }, { pole: qrot(f.rot[skel.seg.thorax2], norm(WAITER.pole)), planeHint: 60, wristBias: 30 })
  mirrorArm(skel, q)
  return pose
}

function frame(skel: Skeleton, q: Float64Array, v: Waiter, c: number, sway?: Sway, elbow = v.elbow) {
  const e = lerp(elbow[0], elbow[1], c)
  let pose!: ImplementPose
  const upper = (qq: Float64Array) => {
    pose = arms(skel, qq, v, e, c)
  }
  const measure = (qq: Float64Array) => centerOfMass(skel, fk(skel, qq), [{ mass: v.db.mass, pos: pose.pos }])[2]
  const bal = standBalanced(skel, q, v.stance, { knee: WAITER.knee, tilt: WAITER.tilt }, measure, upper, undefined, sway)
  return { bal, pose }
}

/** smallest gap of the dumbbell's heads to these body regions, m */
function gap(skel: Skeleton, q: Float64Array, db: ImplementSpec, pose: ImplementPose, regions: RegExp) {
  const caps = bodyCapsules(skel, fk(skel, q)).filter((k) => regions.test(k.region))
  const heads = placeParts(db, pose).slice(1)
  return Math.min(...heads.flatMap((s) => caps.map((k) => capsuleSolidClearance(k, s))))
}

export function waiterContext(_p: P, skel: Skeleton, tempo: Tempo): Waiter {
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const db = dumbbell({ id: 'db', mass: WAITER.kg })
  const { axis } = cupHand()
  const [x, y, z] = CUP.at
  db.sites.cup_l = { pos: [x, y, z], axis }
  db.sites.cup_r = { pos: [x, y, -z], axis: [axis[0], axis[1], -axis[2]] }
  const contacts = plantedContacts(skel, stance)
  contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: 'db', grip: 'cup_l' } }, { site: 'grip_r', kind: 'grip', target: { implement: 'db', grip: 'cup_r' } })
  const setup: Setup = {
    implements: [db],
    contacts,
    tempo,
    symmetric: true,
    balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL },
    // the palms press up under the top head
    rests: [{ implement: 'db', regions: ['hand_l', 'hand_r'], tol: 15 }],
    // both hands meet on the midline with the arms long at the bottom, so the upper arms press on the sides of the chest
    // (22-29 mm into the capsules; the right upper arm's capsule already overlaps the chest's 8 mm standing relaxed, the
    // left's does not, the capsule fit is not mirror-exact); the 421 two-hand hang allowance (squat.ts HANG.chest)
    tolerances: { body: Object.fromEntries(['trunk / upperarm_l', 'trunk / upperarm_r', 'trunk / upperarm_l (thorax2)', 'trunk / upperarm_r (thorax2)'].map((k) => [k, ARMS_TOL])) },
  }
  const v: Waiter = { tempo, setup, stance, db, elbow: [WAITER.elbow.min, WAITER.elbow.max] }
  // bottom: the lower head clear of the thighs; top: the heads short of the chest, neck and chin
  const at = (e: number, c: number, regions: RegExp) => {
    const q = base(skel)
    const { pose } = frame(skel, q, v, c, undefined, [e, e])
    return gap(skel, q, db, pose, regions)
  }
  const thighs = (e: number) => at(e, 0, /^thigh_/) - WAITER.thighs
  if (thighs(WAITER.elbow.min) < 0) v.elbow[0] = root1d(thighs, WAITER.elbow.min, 70, { tol: 1e-4 }).x
  const chest = (e: number) => at(e, 1, /^(trunk|neck|head)$/) - WAITER.chest
  if (chest(WAITER.elbow.max) < 0) v.elbow[1] = root1d(chest, 80, WAITER.elbow.max, { tol: 1e-4 }).x
  v.sway = limitSway((u, sway) => frame(skel, base(skel), v, phaseAt(u, tempo).c, sway).bal)
  return v
}

export function sampleWaiter(u: number, skel: Skeleton, v: Waiter): Pose {
  const q = base(skel)
  const { pose } = frame(skel, q, v, phaseAt(u, v.tempo).c, v.sway)
  return { q, implements: [pose], contacts: v.setup.contacts }
}

