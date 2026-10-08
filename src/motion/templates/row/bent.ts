import { root1d } from '../../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { centerOfMass, fk, localToWorld, segPos } from '../../fk.ts'
import { barbell, type ImplementSpec } from '../../implements.ts'
import { smithRails } from '../../implements/back.ts'
import { add, angleBetween, qrot, RAD, scale, sub, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { limitSway, makeStance, plantedContacts, stand, stanceWidth, standBalanced, type StanceSetup, type Sway } from '../standing.ts'
import type { Setup } from '../types.ts'
import { elbowPole, gripContacts, lerp, mirrorArm, phases, PROT, reach, shoulderMid, type P } from './common.ts'

// Bent-over barbell row: hips hinged so the trunk sits at torsoAngle from vertical (45) with a neutral spine and soft
// knees (~22 deg), both held still. The bar hangs from the protracted shoulders (elbows ~8 deg), then the scapulae
// set back and the elbows drive the bar up to the lower stomach, at the shorts' waistband (elbow ~0 -> ~124 deg,
// humerus to ~30-60 deg behind the trunk; research: elbow 0 -> 90-110, shoulder to 0..-30 extension; higher on the
// ribs folds the elbow past 130 on this figure, lower lands on the hip crease). The bar path runs from under the
// shoulders to the trunk; the ankles keep body + bar over the midfoot. Smith: the bar runs on the rails' vertical
// line through the finish (lower stomach), so it hangs a little behind the shoulders at the bottom.

const KNEE = 22
const PLATE_KG = 20
const BOTTOM_ELBOW = 8
/** bar surface to the trunk at the top, m (touching, not in it) */
const RIB_GAP = 0.006
/** upper-abdomen level the bar rows to (segment-local, m) */
const RIB_SEG = 'thorax1'
const RIB_LOCAL: V3 = [0, -0.05, 0]
const BALANCE_TOL = 0.025

export type Bent = {
  kind: 'bent'
  tempo: Tempo
  setup: Setup
  stance: StanceSetup
  bar: ImplementSpec
  tilt: number
  /** bar centre relative to the pelvis origin: hang (with protracted scapulae) and finish */
  bottom: V3
  top: V3
  /** shoulder midpoint relative to the pelvis at s = 0 */
  sm0: V3
  /** Smith: the rails' line (world z) */
  railZ?: number
  sway?: Sway
}

function trunk(skel: Skeleton, q: Float64Array, s: number) {
  setDofs(skel, q, {
    'lumbar.flex': 0,
    'thorax.flex': 4,
    'neck.flex': -16,
    'head.flex': -8,
    'clavicle_*.prot': lerp(PROT.start, PROT.finish, s),
    'clavicle_*.elev': lerp(2, -4, s),
    'grip_*.close': 1,
  })
}

const pelvisPos = (skel: Skeleton, q: Float64Array): V3 => segPos(skel, fk(skel, q), 'pelvis')

/** trunk angle from vertical as it reads from the side: hip joints to shoulder joints, deg (~2 standing) */
export function trunkAngle(skel: Skeleton, q: Float64Array) {
  const f = fk(skel, q)
  const hips = scale(add(segPos(skel, f, 'femur_l'), segPos(skel, f, 'femur_r')), 0.5)
  return angleBetween(sub(shoulderMid(skel, q), hips), [0, 1, 0]) * RAD
}

function barPoseAt(skel: Skeleton, q: Float64Array, v: Pick<Bent, 'bar' | 'bottom' | 'top' | 'sm0' | 'railZ'>, e: number): ImplementPose {
  const pel = pelvisPos(skel, q)
  const sm = sub(shoulderMid(skel, q), pel)
  const hang = add(v.bottom, sub(sm, v.sm0))
  const rel: V3 = [0, lerp(hang[1], v.top[1], e), lerp(hang[2], v.top[2], e)]
  const pos = add(pel, rel)
  if (v.railZ !== undefined) pos[2] = v.railZ
  return { id: v.bar.id, pos, rot: [0, 0, 0, 1] }
}

function arms(skel: Skeleton, q: Float64Array, p: P, bar: ImplementSpec, pose: ImplementPose) {
  const g = add(pose.pos, bar.sites.l.pos)
  // underhand: palms forward (towards the toes) with the bar a little oblique across the palm (the forearm is at full
  // supination), elbows tucked and pointed down at the hips, so the finish sits behind the trunk (plane past -90)
  const under = p.grip === 'supinated'
  const grip = { pos: g, axis: [1, 0, 0] as V3, palm: (under ? [0, 0, 1] : [0, 0, -1]) as V3, ...(under ? { oblique: 6 } : {}) }
  reach(skel, q, 'l', grip, { pole: elbowPole(skel, q, 'l', p.elbowFlare, under ? 1 : 0.6), planeHint: under ? 0 : 90 })
  mirrorArm(skel, q)
}

function frame(skel: Skeleton, q: Float64Array, p: P, v: Bent, s: number, e: number, sway?: Sway) {
  trunk(skel, q, s)
  let pose!: ImplementPose
  // Smith: the rails take the bar's fore-aft load, so the body balances itself (as the Smith overhead press)
  const loads = v.railZ === undefined ? (qq: Float64Array) => [{ mass: v.bar.mass, pos: barPoseAt(skel, qq, v, e).pos }] : () => []
  const measure = (qq: Float64Array) => centerOfMass(skel, fk(skel, qq), loads(qq))[2]
  const bal = standBalanced(skel, q, v.stance, { knee: KNEE, tilt: v.tilt }, measure, (qq) => {
    pose = barPoseAt(skel, qq, v, e)
    arms(skel, qq, p, v.bar, pose)
  }, [-15, 30], sway)
  return { pose, bal }
}

export function bentContext(p: P, skel: Skeleton, tempo: Tempo): Bent {
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 10)
  const bar = barbell({ gripWidth: p.gripWidth * skel.data.shoulderWidth, plateKg: PLATE_KG })
  const base = (s: number, tilt: number, df = 12) => {
    const q = zeroQ(skel)
    trunk(skel, q, s)
    stand(skel, q, stance, { knee: KNEE, df, tilt })
    return q
  }
  const tilt = root1d((t) => trunkAngle(skel, base(0.5, t)) - p.torsoAngle, 0, 85, { tol: 1e-5 }).x
  const q0 = base(0, tilt)
  const pel0 = pelvisPos(skel, q0)
  const sm0 = sub(shoulderMid(skel, q0), pel0)
  const v: Bent = { kind: 'bent', tempo, setup: undefined as never, stance, bar, tilt, bottom: [0, sm0[1] - 0.6, sm0[2]], top: [0, 0, 0], sm0 }
  // finish: the bar against the lower stomach, reached along the trunk's front normal
  const q1 = base(1, tilt)
  const pel1 = pelvisPos(skel, q1)
  const f1 = fk(skel, q1)
  const rib = localToWorld(skel, f1, RIB_SEG, RIB_LOCAL)
  const front = qrot(f1.rot[skel.seg[RIB_SEG]], [0, 0, 1])
  const trunkCaps = bodyCapsules(skel, f1).filter((c) => c.region === 'trunk')
  const at = (d: number): V3 => [0, rib[1] + front[1] * d, rib[2] + front[2] * d]
  const gap = (d: number) => {
    const solids = placeParts(bar, { id: bar.id, pos: at(d), rot: [0, 0, 0, 1] }).slice(0, 1)
    return Math.min(...trunkCaps.map((c) => capsuleSolidClearance(c, solids[0]))) - RIB_GAP
  }
  v.top = sub(at(root1d(gap, 0, 0.4, { tol: 1e-6 }).x), pel1)
  if (p.implement === 'smith') v.railZ = pel1[2] + v.top[2]
  // hang: grips straight under the shoulders with the elbows just short of straight
  const elbowAt = (dy: number) => {
    const q = Float64Array.from(q0)
    const vv = { ...v, bottom: [0, sm0[1] - dy, sm0[2]] as V3 }
    arms(skel, q, p, bar, barPoseAt(skel, q, vv, 0))
    return q[skel.dof['elbow_l.flex']]
  }
  const dy = root1d((d) => elbowAt(d) - BOTTOM_ELBOW, 0.45, 0.75, { tol: 1e-6 }).x
  v.bottom = [0, sm0[1] - dy, sm0[2]]
  const contacts = [...plantedContacts(skel, stance), ...gripContacts(bar.id)]
  v.setup = { implements: [bar], contacts, tempo, symmetric: true }
  if (v.railZ === undefined) v.setup.balance = { point: 'com', over: 'midfoot', tol: BALANCE_TOL }
  else v.setup.implements.push(smithRails({ z: v.railZ }))
  const balance = () =>
    limitSway((u, sway) => {
      const ph = phases(u, tempo)
      return frame(skel, zeroQ(skel), p, v, ph.s, ph.g, sway).bal
    }, BALANCE_TOL - 0.005)
  v.sway = balance()
  // Smith: the body settles where it balances, so the rails go where the bar meets the stomach at the finish (u = 0)
  for (let pass = 0; v.railZ !== undefined && pass < 4; pass++) {
    const q = zeroQ(skel)
    const ph = phases(0, tempo)
    frame(skel, q, p, v, ph.s, ph.g, v.sway)
    v.railZ = pelvisPos(skel, q)[2] + v.top[2]
    // hang: as low on the rails as the elbows allow, in the balanced body
    const elbowIn = (d: number) => {
      const qq = zeroQ(skel)
      frame(skel, qq, p, { ...v, bottom: [0, sm0[1] - d, sm0[2]] }, 0, 0, v.sway)
      return qq[skel.dof['elbow_l.flex']]
    }
    v.bottom = [0, sm0[1] - root1d((d) => elbowIn(d) - BOTTOM_ELBOW, 0.3, 0.75, { tol: 1e-6, scan: 12 }).x, sm0[2]]
    v.setup.implements[1] = smithRails({ z: v.railZ })
    v.sway = balance()
  }
  return v
}

export function sampleBent(u: number, p: P, skel: Skeleton, v: Bent): Pose {
  const ph = phases(u, v.tempo)
  const q = zeroQ(skel)
  const { pose } = frame(skel, q, p, v, ph.s, ph.g, v.sway)
  const rails: ImplementPose[] = v.railZ === undefined ? [] : [{ id: 'smith', pos: [0, 0, 0], rot: [0, 0, 0, 1] }]
  return { q, implements: [pose, ...rails], contacts: v.setup.contacts }
}
