import { attachHand, plantFoot, solveLegs, type FootTarget } from '../../constraints.ts'
import { fk, sitePos } from '../../fk.ts'
import { siteWorld, type ImplementSpec } from '../../implements.ts'
import { dls } from '../../ik.ts'
import { naturalCubic } from '../solve.ts'
import { landmine, landmineBar, landminePose, LANDMINE } from '../../implements/portable-c.ts'
import { add, DEG, dist, lerp, norm, qaxis, qconj, qdot, qid, qmul, qnorm, qrot, RAD, scale, smoothstep, sub, type Quat, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import type { ParamsOf } from '../schemas.ts'
import { hipMidLocal, setPelvis, stanceWidth, type StanceName } from '../standing.ts'
import type { Setup } from '../types.ts'

// Landmine rotation (822): standing wide facing the landmine, both hands cupped round the bar's free end at arm's
// length. The end sweeps in an arc from beside one hip, up through chest height in front, down beside the other hip:
// the hips and trunk turn with it (pelvis yaw plus lumbar and thoracic rotation), the arms stay long, and the foot on
// the side the bar leaves pivots on its ball (heel up, turning in). One loop sweeps from the far hip (bottom) to the
// working side's hip (top), slowly one way and quickly back (the Russian twist's precedent). Research
// (motion-authoring): trunk rotation +-30-45 deg; the arc and the pivot are author judgment.

type P = ParamsOf<'rotation'>

/** deg at either end of the arc: pelvis yaw, lumbar and thoracic rotation, the pivoting foot's heel lift and turn in */
export const RAINBOW = { yaw: 14, lumbar: 8, thorax: 18, heel: 16, pivot: 18, neck: 8 } as const
/** grip point (between the cupped hands) at the middle and the ends of the arc, m: height, sideways out, distance
 * ahead of the hip line */
export const ARC = { top: 1.22, side: 1.0, out: 0.32, ahead: [0.7, 0.26] } as const
/** plates on the free end, kg (a light rotation) */
const PLATE_KG = 10
/** the forefoot capsule dips where the pivoting foot's toes lie flat, mm (rotation.ts FOOT_SINK, a lead decision) */
export const FOOT_SINK = 22
const TOE_OUT = 15
/** each cupped hand's grip site this far from the bar's axis, m */
const CUP_HALF = 0.048
/** shoulder to cupped hand as a share of the straight arm: soft elbows */
const REACH = 0.95

export type Landmine = {
  kind: 'landmine'
  tempo: Tempo
  setup: Setup
  /** +1 when the working side is the right */
  s: number
  feet: FootTarget[]
  balls: V3[]
  hipY: number
  base: ImplementSpec
  basePose: ImplementPose
  bar: ImplementSpec
  pivot: V3
  /** body adjustment over the sweep (sideways and forward hip shift, m; extra thoracic turn, deg) */
  adj: (t: number) => number[]
  /** both hands' orientation in the bar's frame over the sweep */
  hands?: (t: number) => Quat[]
}

/** sweep position -1 (far hip) .. +1 (working hip) */
const sweepAt = (c: number) => lerp(-1, 1, c)

/** grip point on the arc at sweep t (world; right side = -X for t > 0 when s = 1) */
function gripAt(v: Landmine, t: number): V3 {
  const a = Math.abs(t)
  const y = lerp(ARC.top, ARC.side, a * a)
  return [-v.s * t * ARC.out, y, lerp(ARC.ahead[0], ARC.ahead[1], a * a)]
}

/** bar pose putting the cup midpoint on the grip point (the bar from the pivot through it) */
function barPose(v: Landmine, g: V3): ImplementPose {
  const d = norm(sub(g, v.pivot))
  const yaw = Math.atan2(d[0], d[2]) * RAD
  const pitch = Math.asin(d[1]) * RAD
  return landminePose(v.bar.id, v.pivot, yaw, pitch)
}

/** shoulder joint to grip site with the arm straight, m */
function armLength(skel: Skeleton): number {
  const f = fk(skel, zeroQ(skel))
  return dist(f.pos[skel.seg.humerus_l], sitePos(skel, f, 'grip_l'))
}

/** the cup midpoint's distance from the pivot */
const cupRadius = (bar: ImplementSpec) => Math.hypot(...scale(add(bar.sites.cup_l.pos, bar.sites.cup_r.pos), 0.5))

function foot(skel: Skeleton, v: Landmine, i: number, k: number): FootTarget {
  const ft = v.feet[i]
  const sgn = ft.side === 'l' ? -1 : 1
  const rot = qmul(qmul(qaxis([0, 1, 0], sgn * RAINBOW.pivot * k * DEG), ft.rot), qaxis([1, 0, 0], RAINBOW.heel * k * DEG))
  return { side: ft.side, rot, ankle: sub(v.balls[i], qrot(rot, skel.data.sites[`ball_${ft.side}`].local)) }
}

function body(skel: Skeleton, q: Float64Array, v: Landmine, t: number, adj: number[] = [0, 0, 0]) {
  // + turns left: with the bar going to the right hip (t > 0, s = 1) the trunk turns right
  const turn = -v.s * t
  setDofs(skel, q, {
    'lumbar.rot': RAINBOW.lumbar * turn,
    'thorax.rot': RAINBOW.thorax * turn + adj[2],
    'lumbar.flex': 2 + 4 * t * t,
    'thorax.flex': 2 + 6 * t * t,
    'neck.rot': RAINBOW.neck * turn,
    'neck.flex': 6 + 10 * t * t,
    'clavicle_*.prot': 12,
    'clavicle_*.elev': 4,
    'grip_*.close': 0,
  })
  const drop = 0.04 * t * t
  setPelvis(skel, q, [0.03 * turn + adj[0], v.hipY - drop, adj[1]], 2, RAINBOW.yaw * turn)
  // the foot on the side the bar leaves pivots on its ball as the turn passes the middle
  const k = (x: number) => smoothstep(Math.max(0, Math.min(1, (x + 0.1) / 1.1)))
  const lift = [v.feet[0].side === 'l' ? k(-turn) : k(turn), v.feet[1].side === 'l' ? k(-turn) : k(turn)]
  solveLegs(skel, q, [foot(skel, v, 0, lift[0]), foot(skel, v, 1, lift[1])])
  for (const [i, ft] of v.feet.entries()) q[skel.dof[`toe_${ft.side}.flex`]] = -RAINBOW.heel * lift[i]
}

function arms(skel: Skeleton, q: Float64Array, v: Landmine, pose: ImplementPose, hands?: Quat[]) {
  for (const side of ['l', 'r'] as const) {
    const g = siteWorld(v.bar, pose, `cup_${side}`)
    const s = side === 'l' ? 1 : -1
    // palms round the sleeve from either side (local +Z is the lifter's left)
    attachHand(skel, q, side, { pos: g.pos, axis: g.axis!, palm: qrot(pose.rot, [0, 0, -s]), ...(hands ? { hand: qmul(pose.rot, hands[side === 'l' ? 0 : 1]) } : {}) }, { pole: [s * 0.5, -1, -0.2], planeHint: 60, devBand: [-35, 20] })
  }
}

export function landmineContext(p: P, skel: Skeleton, tempo: Tempo): Landmine {
  const s = p.side === 'left' ? -1 : 1
  const width = stanceWidth(skel, p.stance as StanceName)
  const feet = [plantFoot(skel, 'l', [width / 2, 0, 0], TOE_OUT), plantFoot(skel, 'r', [-width / 2, 0, 0], TOE_OUT)]
  const balls = feet.map((ft) => add(ft.ankle, qrot(ft.rot, skel.data.sites[`ball_${ft.side}`].local)))
  const hipY = skel.data.standingHeight + hipMidLocal(skel)[1] - 0.04
  // the cupped hands a little further apart round the sleeve than the press's interlocked cup (they overlap there)
  const raw = landmineBar({ plateKg: PLATE_KG })
  const bar: ImplementSpec = { ...raw, sites: { ...raw.sites, cup_l: { ...raw.sites.cup_l, pos: [raw.sites.cup_l.pos[0], 0, CUP_HALF] }, cup_r: { ...raw.sites.cup_r, pos: [raw.sites.cup_r.pos[0], 0, -CUP_HALF] } } }
  // the pivot straight ahead, where the bar reaches the middle of the arc
  const mid = ARC.top - LANDMINE.pivot, R = cupRadius(bar)
  const pivot: V3 = [0, LANDMINE.pivot, ARC.ahead[0] + Math.sqrt(R * R - mid * mid)]
  const base = landmine()
  const basePose: ImplementPose = { id: base.id, pos: [0, 0, pivot[2]], rot: qid() }
  const v: Landmine = { kind: 'landmine', tempo, setup: undefined as unknown as Setup, s, feet, balls, hipY, base, basePose, bar, pivot, adj: () => [0, 0, 0] }
  // at knots over the sweep: the hips shift and the upper back turns a little so both hands reach the bar end with the
  // elbows soft (REACH of the straight arm), as a lifter steers the bar with the whole body
  const L = armLength(skel)
  const ts = Array.from({ length: 7 }, (_, k) => -Math.cos((Math.PI * k) / 6))
  let guess = [0, 0, 0]
  const knots = ts.map((t) => {
    const pose = barPose(v, onSphere(v, gripAt(v, t)))
    const q = zeroQ(skel)
    const res = (x: number[]) => {
      body(skel, q, v, t, x)
      arms(skel, q, v, pose)
      const f = fk(skel, q)
      const d = (['l', 'r'] as const).map((sd) => dist(f.pos[skel.seg[`humerus_${sd}`]], siteWorld(bar, pose, `cup_${sd}`).pos) - REACH * L)
      // only a hand out of reach pulls the body after it (a smooth hinge); a nearer hand just bends its elbow more
      const over = (e: number) => 0.01 * Math.log1p(Math.exp(e / 0.01))
      return [over(d[0]) * 100, over(d[1]) * 100, x[0] * 2, x[1] * 2, x[2] * 0.05]
    }
    return (guess = dls(res, guess, { tol: 1e-9, iters: 40, lo: [-0.12, -0.04, -12], hi: [0.12, 0.04, 12] }).x)
  })
  const sp = [0, 1, 2].map((k) => naturalCubic(ts, knots.map((x) => x[k])))
  v.adj = (t) => sp.map((f) => f(t))
  // the hands' roll on the sleeve: the free solution at the knots, in the bar's frame, splined so the wrists turn
  // smoothly (the free roll swings quickly where it meets the deviation band)
  const rolls: Quat[][] = []
  for (const t of ts) {
    const q = zeroQ(skel)
    body(skel, q, v, t, v.adj(t))
    const pose = barPose(v, onSphere(v, gripAt(v, t)))
    arms(skel, q, v, pose)
    const f = fk(skel, q)
    rolls.push((['l', 'r'] as const).map((sd, k) => {
      const h = qmul(qconj(pose.rot), f.rot[skel.seg[`hand_${sd}`]]), prev = rolls.at(-1)?.[k]
      return prev && qdot(h, prev) < 0 ? (h.map((e) => -e) as unknown as Quat) : h
    }))
  }
  const rs = [0, 1].map((k) => [0, 1, 2, 3].map((i) => naturalCubic(ts, rolls.map((h) => h[k][i]))))
  v.hands = (t) => rs.map((sp4) => qnorm(sp4.map((fn) => fn(t)) as unknown as Quat))
  const contacts: Contact[] = [
    ...balls.map((b, i): Contact => ({ site: `ball_${feet[i].side}`, kind: 'planted', target: { world: b } })),
    { site: 'grip_l', kind: 'grip', target: { implement: bar.id, grip: 'cup_l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: bar.id, grip: 'cup_r' } },
  ]
  v.setup = { implements: [base, bar], contacts, tempo, symmetric: false, tolerances: { floor: FOOT_SINK } }
  return v
}

/** grip point on the arc corrected onto the bar's sphere (its distance from the pivot is fixed) */
function onSphere(v: Landmine, g: V3): V3 {
  const R = cupRadius(v.bar)
  const dy = g[1] - v.pivot[1], dx = g[0] - v.pivot[0]
  return [g[0], g[1], v.pivot[2] - Math.sqrt(Math.max(0, R * R - dx * dx - dy * dy))]
}

export function sampleLandmine(skel: Skeleton, v: Landmine, c: number): Pose {
  const t = sweepAt(c)
  const q = zeroQ(skel)
  body(skel, q, v, t, v.adj(t))
  const pose = barPose(v, onSphere(v, gripAt(v, t)))
  arms(skel, q, v, pose, v.hands?.(t))
  return { q, implements: [v.basePose, pose], contacts: v.setup.contacts }
}
