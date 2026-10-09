import { plantFoot, root1d, solveLegs, type FootTarget } from '../../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { fk, segPos, sitePos } from '../../fk.ts'
import { siteWorld, type ImplementSpec } from '../../implements.ts'
import { landmine, landmineBar, landminePose } from '../../implements/index.ts'
import { add, DEG, dot, norm, qconj, qrot, scale, sub, type Quat, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'
import { BOTTOM_ELBOW, trunkAngle } from './bent.ts'
import { handSchedule } from './hand.ts'
import { elbowPole, gripPath, lerp, other, phases, PROT, reach, scapularLead, working, type P, type Side } from './common.ts'

// Landmine Meadows row (317): standing side-on to the loaded end of a landmine bar that runs across in front of the
// lifter from a pivot out on the working side, its tip pointing towards the free side and the plates outside the working
// hand. Staggered stance, the free-side foot forward, hips hinged to torsoAngle with soft knees, the free forearm resting
// across the front thigh above the knee. The working hand holds the thick sleeve near its tip overhand (the bar across
// the palm, palm back, index towards the tip, as an overhand bar row), hanging under the shoulder with the scapula drawn
// down and forward and the trunk turned a little towards it (elbow ~8 deg). Then the scapula sets back and the elbow
// travels up and slightly out (flare ~40) while the bar swings up about the pivot, until the elbow passes the back
// (elbow ~100-110 deg, the one-arm row's finish). The landmine sleeve swivels, so the bar also yaws: the hand rises and
// drifts back from under the shoulder to beside the hip, and the bar's far end follows on its sphere about the pivot.

/** plates on the loaded end, kg: smaller plates keep a longer pull before they meet the floor (Meadows' own advice) */
const PLATE_KG = 10
/**
 * staggered stance, the feet hip width apart: the front (free-side) ankle this far ahead of the hips (m), toe-out of the
 * front and back (working-side) feet (deg)
 */
const STANCE = { front: 0.14, toeOut: [10, 16] as [number, number] }
/** front knee (it carries the free forearm) and back knee (nearly straight), deg */
const FRONT_KNEE = 35
const BACK_KNEE = 10
/**
 * horizontal direction from the working hand to the pivot at the hang, world (+X = the lifter's left): out to the working
 * side, nearly straight across (forward share 0.12, ~83 deg from the facing direction)
 */
const ACROSS = { forward: 0.12 }
/** the hand's drift back from the hang to the top, m: searched in this range for the first finish with the elbow behind the trunk */
const BACK = { max: 0.4, step: 0.01 }
/** upper arm direction in the thorax frame at the finish, chest component at most this (behind the trunk line) */
const TOP_HUM_Z = -0.15
/** free hand: on top of the front thigh this far from the hip towards the knee, and lifted this far off its surface, m */
const FREE_HAND = { along: 0.82, lift: 0.035 }
/** the plates, sleeve and hand stop this far off the trunk and thighs at the top, m */
const TOP_GAP = 0.012
const TOP_ELBOW = 105
const BALANCE_TOL = 0.035
/** centre of pressure ahead of the front midfoot, m */
const FRONT_BIAS = 0.03

export type Meadows = {
  kind: 'meadows'
  tempo: Tempo
  setup: Setup
  work: Side
  /** elbow abduction from the trunk at the finish, deg (elbowFlare: "up and slightly out", ~40) */
  flare: number
  feet: FootTarget[]
  hip: { pos: V3; tilt: number }
  bar: ImplementSpec
  base: ImplementPose
  pivot: V3
  /** bar yaw at the hang, deg */
  yaw: number
  /** bar pitch at the hang and at the top, deg */
  pitch: [number, number]
  /** the hand's drift back from the hang to the top, m */
  back: number
  /** free hand target on the front thigh, world */
  freeHand: V3
  /** the working hand's orientation and the bar's pitch by contraction (smooth) */
  hand: (c: number) => Quat
  barAt: (c: number) => { yaw: number; pitch: number }
}

const lat = (s: Side) => (s === 'l' ? 1 : -1)

function body(skel: Skeleton, q: Float64Array, v: Pick<Meadows, 'work' | 'feet' | 'hip'>, s: number) {
  const work = v.work, free = other(work)
  setDofs(skel, q, {
    'lumbar.flex': 0,
    'thorax.flex': 4,
    // the working shoulder drops towards the bar at the stretch and squares up as the scapula sets back
    'thorax.rot': -lat(work) * lerp(7, -2, s),
    'neck.flex': -16,
    'head.flex': -8,
    'neck.rot': lat(work) * lerp(3, -1, s),
    [`clavicle_${work}.prot`]: lerp(PROT.start, PROT.finish, s),
    [`clavicle_${work}.elev`]: lerp(-2, -4, s),
    [`clavicle_${free}.prot`]: 6,
    [`clavicle_${free}.elev`]: 0,
    [`grip_${work}.close`]: 1,
    [`grip_${free}.close`]: 0.35,
  })
  setPelvis(skel, q, v.hip.pos, v.hip.tilt)
  solveLegs(skel, q, v.feet)
}

function freeArm(skel: Skeleton, q: Float64Array, v: Pick<Meadows, 'work' | 'freeHand'>) {
  const free = other(v.work)
  // palm down on the thigh, fingers pointing forward and in; the elbow out and back so the forearm lies across the thigh
  reach(skel, q, free, { pos: v.freeHand, axis: [1, 0, 0], palm: [0, -1, 0] }, { pole: [lat(free) * 0.8, -0.2, -0.6], planeHint: 60 })
}

function workArm(skel: Skeleton, q: Float64Array, v: Pick<Meadows, 'work' | 'bar' | 'flare'>, pose: ImplementPose, hand?: Quat) {
  const g = siteWorld(v.bar, pose, 'end')
  // overhand on the sleeve: the bar across the palm, palm towards the legs; the elbow up and a little out
  reach(skel, q, v.work, { pos: g.pos, axis: g.axis!, palm: [0, -0.2, -1], ...(hand ? { hand } : {}) }, { pole: elbowPole(skel, q, v.work, v.flare, 0.5), planeHint: 70 })
}

type Ctx = Omit<Meadows, 'kind' | 'tempo' | 'setup' | 'hand' | 'barAt'>

function frame(skel: Skeleton, v: Ctx, s: number, bar: { yaw: number; pitch: number }, hand?: Quat) {
  const q = zeroQ(skel)
  body(skel, q, v, s)
  freeArm(skel, q, v)
  const pose = landminePose(v.bar.id, v.pivot, bar.yaw, bar.pitch)
  workArm(skel, q, v, pose, hand)
  return { q, pose }
}

/** yaw and pitch that put the working hand's site at height y and depth z: the bar swivels about the pivot */
function swivel(bar: ImplementSpec, work: Side, pivot: V3, y: number, z: number) {
  const e = bar.sites.end.pos[0]
  const dy = y - pivot[1], dz = z - pivot[2]
  const dx = -lat(work) * Math.sqrt(Math.max(0, e * e - dy * dy - dz * dz))
  return { yaw: Math.atan2(dx, dz) / DEG, pitch: Math.asin(dy / e) / DEG }
}

/** pivot and yaw that put the working hand's site at `hand` with the bar running across from the working side */
function aim(bar: ImplementSpec, work: Side, hand: V3, pivotY: number): { pivot: V3; yaw: number; pitch: number } {
  const e = bar.sites.end.pos[0]
  const h = norm([lat(work), 0, ACROSS.forward])
  const pitch = Math.asin((hand[1] - pivotY) / e) / DEG
  const flat = e * Math.cos(pitch * DEG)
  const pivot: V3 = [hand[0] + h[0] * flat, pivotY, hand[2] + h[2] * flat]
  // the bar runs from the pivot towards the hand: yaw 0 = towards +Z
  const yaw = Math.atan2(-h[0], -h[2]) / DEG
  return { pivot, yaw, pitch }
}

export function meadowsContext(p: P, skel: Skeleton, tempo: Tempo): Meadows {
  const work = working(p)
  const free = other(work)
  const half = (skel.data.hipWidth + 0.03) / 2
  const feetAt = (back: number, front: number) => [plantFoot(skel, free, [lat(free) * half, 0, front], STANCE.toeOut[0]), plantFoot(skel, work, [lat(work) * half, 0, back], STANCE.toeOut[1])]
  let feet = feetAt(-0.25, 0.25)
  // the pivot carries part of the bar: what the hand holds is the bar's weight scaled by its centre's distance from the
  // pivot over the hand's, acting at the hand (statics about the pivot). The balance gates count it that way.
  const full = landmineBar({ plateKg: PLATE_KG })
  const bar: ImplementSpec = { ...full, mass: (full.mass * full.com[0]) / full.sites.end.pos[0], com: full.sites.end.pos }
  const unit = landmine()
  const pivotY = unit.sites.pivot.pos[1]
  const v: Ctx = {
    work, flare: p.elbowFlare, feet, hip: { pos: [0, 0.9, 0], tilt: 40 }, bar, base: { id: unit.id, pos: [0, 0, 0], rot: [0, 0, 0, 1] },
    pivot: [0, pivotY, 0], yaw: 0, pitch: [0, 0], back: 0, freeHand: [0, 0, 0],
  }
  const bodyQ = (s: number) => {
    const q = zeroQ(skel)
    body(skel, q, v, s)
    return q
  }
  // trunk at torsoAngle. The hips stay over z = 0: the front ankle a little ahead of them, the hip height bending the
  // front knee to FRONT_KNEE, the back foot set back until its knee is nearly straight
  const solveHip = () => {
    v.hip.tilt = root1d((t) => {
      v.hip.tilt = t
      return trunkAngle(skel, bodyQ(0.5)) - p.torsoAngle
    }, 0, 89, { tol: 1e-6 }).x
    const knee = (side: Side) => bodyQ(0.5)[skel.dof[`knee_${side}.flex`]]
    const withBack = (back: number) => {
      v.feet = feet = feetAt(back, STANCE.front)
      v.hip.pos[1] = root1d((y) => {
        v.hip.pos[1] = y
        return knee(free) - FRONT_KNEE
      }, 0.55, 1.05, { tol: 1e-7 }).x
      return knee(work) - BACK_KNEE
    }
    withBack(root1d(withBack, -0.9, -0.1, { tol: 1e-6 }).x)
  }
  // the free hand on top of the front thigh near the knee
  const placeFreeHand = () => {
    const f = fk(skel, bodyQ(0.5))
    const hipJ = segPos(skel, f, `femur_${free}`), knee = segPos(skel, f, `tibia_${free}`)
    const axis = norm(sub(knee, hipJ))
    const up = norm(sub([0, 1, 0], scale(axis, dot([0, 1, 0], axis))))
    const thigh = bodyCapsules(skel, f).find((c) => c.region === `thigh_${free}`)!
    v.freeHand = add(add(hipJ, scale(sub(knee, hipJ), FREE_HAND.along)), scale(up, thigh.r + FREE_HAND.lift))
  }
  // hang: the hand under the working shoulder with the elbow just short of straight
  const placeBar = () => {
    const q0 = bodyQ(0)
    const sh = segPos(skel, fk(skel, q0), `humerus_${work}`)
    const elbowAt = (d: number) => {
      const a = aim(bar, work, [sh[0], sh[1] - d, sh[2]], pivotY)
      Object.assign(v, { pivot: a.pivot, yaw: a.yaw })
      return frame(skel, v, 0, a).q[skel.dof[`elbow_${work}.flex`]]
    }
    const d = root1d((dd) => elbowAt(dd) - BOTTOM_ELBOW, 0.4, 0.8, { tol: 1e-7 }).x
    const a = aim(bar, work, [sh[0], sh[1] - d, sh[2]], pivotY)
    Object.assign(v, { pivot: a.pivot, yaw: a.yaw })
    v.pitch[0] = a.pitch
  }
  for (let pass = 0; pass < 2; pass++) {
    solveHip()
    placeFreeHand()
    placeBar()
  }
  solveHip()
  placeFreeHand()
  placeBar()
  // top: the hand drifts back from the hang by `back` as it rises, the bar swivelling to follow. For each drift the hand
  // rises until the elbow reaches TOP_ELBOW or the bar comes within TOP_GAP of the trunk or thighs; the first drift whose
  // finish has the upper arm behind the trunk line is kept
  const h0 = siteWorld(bar, landminePose(bar.id, v.pivot, v.yaw, v.pitch[0]), 'end').pos
  const caps = (q: Float64Array) => bodyCapsules(skel, fk(skel, q)).filter((c) => c.region === 'trunk' || c.region.startsWith('thigh_'))
  const gap = (b: { yaw: number; pitch: number }) => {
    const { q, pose } = frame(skel, v, 1, b)
    let m = Infinity
    for (const sd of placeParts(bar, pose)) for (const c of caps(q)) m = Math.min(m, capsuleSolidClearance(c, sd))
    return m - TOP_GAP
  }
  const humZ = (q: Float64Array) => {
    const f = fk(skel, q)
    return qrot(qconj(f.rot[skel.seg.thorax2]), norm(sub(segPos(skel, f, `forearm_${work}`), segPos(skel, f, `humerus_${work}`))))[2]
  }
  const finish = (back: number) => {
    let top = { y: h0[1], q: frame(skel, v, 1, swivel(bar, work, v.pivot, h0[1], h0[2] - back)).q }
    for (let y = h0[1] + 0.005; y < h0[1] + 0.8; y += 0.005) {
      const b = swivel(bar, work, v.pivot, y, h0[2] - back)
      if (gap(b) < 0) break
      top = { y, q: frame(skel, v, 1, b).q }
      if (top.q[skel.dof[`elbow_${work}.flex`]] >= TOP_ELBOW) break
    }
    return top
  }
  const elbow = (q: Float64Array) => q[skel.dof[`elbow_${work}.flex`]]
  let best = { back: 0, ...finish(0) }
  for (let back = BACK.step; back <= BACK.max + 1e-9; back += BACK.step) {
    const t = finish(back)
    if (elbow(t.q) < TOP_ELBOW - 1) continue
    if (humZ(t.q) < humZ(best.q)) best = { back, ...t }
    if (humZ(t.q) <= TOP_HUM_Z) break
  }
  v.back = best.back
  const yTop = best.y
  v.pitch[1] = swivel(bar, work, v.pivot, yTop, h0[2] - v.back).pitch
  // the hand's path along the pull: it rises from the hang, which follows the shoulder as the scapula sets back first
  // (the bar lifts a little with it), to the top along the lagging grip path, drifting back on the same schedule
  const shY = (sc: number) => segPos(skel, fk(skel, bodyQ(sc)), `humerus_${work}`)[1]
  const sh0 = shY(0)
  const barAt = (c: number) => swivel(bar, work, v.pivot, lerp(h0[1] + shY(scapularLead(c)) - sh0, yTop, gripPath(c)), h0[2] - v.back * gripPath(c))
  const hand = handSchedule(skel, (c) => frame(skel, v, scapularLead(c), barAt(c)).q, 9, work)
  v.base = { id: unit.id, pos: [v.pivot[0], 0, v.pivot[2]], rot: [0, 0, 0, 1] }
  const mf = (side: Side) => sitePos(skel, fk(skel, bodyQ(0.5)), `midfoot_${side}`)[2]
  const frontShift = (mf(free) - mf(work)) / 2
  const contacts: Contact[] = feet.flatMap((ft) =>
    ['heel', 'ball'].map((site) => ({ site: `${site}_${ft.side}`, kind: 'planted' as const, target: { world: add(ft.ankle, qrot(ft.rot, skel.data.sites[`${site}_${ft.side}`].local)) } })),
  )
  contacts.push({ site: `grip_${work}`, kind: 'grip', target: { implement: bar.id, grip: 'end' } })
  contacts.push({ site: `grip_${free}`, kind: 'support', target: { world: v.freeHand } })
  const setup: Setup = {
    implements: [bar, unit],
    contacts,
    tempo,
    symmetric: false,
    // staggered: the weight sits over the front foot (the back leg is a prop), so the centre of pressure is judged
    // against the front midfoot, a little towards its ball, rather than the middle of the stance
    balance: { point: 'com', over: 'midfoot', target: frontShift + FRONT_BIAS, tol: BALANCE_TOL },
  }
  return { kind: 'meadows', tempo, setup, ...v, hand, barAt }
}

export function sampleMeadows(u: number, _p: P, skel: Skeleton, v: Meadows): Pose {
  const ph = phases(u, v.tempo)
  const { q, pose } = frame(skel, v, ph.s, v.barAt(ph.c), v.hand(ph.c))
  return { q, implements: [pose, v.base], contacts: v.setup.contacts }
}
