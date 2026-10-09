import { bodyCapsules, capsuleSolidClearance, placeParts, solidClearance } from '../../collide.ts'
import { handFrame, plantFoot, root1d, type FootTarget } from '../../constraints.ts'
import { fk, sitePos } from '../../fk.ts'
import { bench, ezBar, type ImplementSpec } from '../../implements.ts'
import { dls } from '../../ik.ts'
import { lerp, qaxis, qid, qrot, sub, type V3 } from '../../math.ts'
import { type Contact, type ImplementPose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import type { Setup } from '../types.ts'
import { armDir, footContacts, lowest, mirrorArm, setOverheadShoulder, type Base, type P, type Sampled } from './common.ts'
import { SEATED, seatedBase } from './seated.ts'

/**
 * Seated EZ-bar overhead extension (745). The seated overhead body (seated.ts): upright against the vertical back pad,
 * feet flat, the upper arms still beside the head at shoulderFlexion (research overhead ~170). The hands hold the
 * EZ bar's inner bends overhand, close together (cue 2), and only the elbows move, lowering the bar behind the head
 * (~110-135 deg) and straightening to lockout. The bar's bends set how far the knuckle line turns from the bar's
 * axis, so each frame the humeral roll and the forearm's turn are solved together (Newton, 2 x 2) to put the grip
 * on the inner bend at the hand spacing with the hand along it; the wrists keep a fixed slight extension. Solving the
 * forearm's turn instead of the full arm IK keeps pronation continuous (the hand IK flipped here in wave 3a).
 */
const EZ = {
  /** humerus past the record's flexion and drawn in, deg */
  lift: 4,
  inward: 4,
  lock: 5,
  maxElbow: 135,
  /** wrists: slight extension, deg */
  wrist: 0,
  dev: 12,
  clear: 0.015,
  plateKg: 5,
  /** reference forearm turn, deg; the humeral roll is held at the bottom's (found in the context) */
  pro: 75,
  roll: 0,
  /** solve weights: grip offset across (per m), knuckle line, then deg per unit of roll, turn, deviation */
  w: { x: 300, axis: 30, roll: 6, pro: 30, dev: 5, inward: 1.5 },
}

export type SeatedEz = Base & {
  kind: 'seated-ez'
  elbow: readonly [number, number]
  feet: FootTarget[]
  /** humerus flexion, deg (drawn in by `inward`, plus a little more or less as the grips need) */
  flex: number
  bar: ImplementSpec
  benchPose: ImplementPose
  /** the left hand's site on the bar */
  site: { pos: V3; axis: V3 }
  /** humeral roll held all rep (the bottom's), deg */
  roll: number
}

/** the left arm on u with roll, forearm turn and wrist deviation, the elbow at e (mirrored); returns the grip and hand axis */
function armAt(skel: Skeleton, base: Float64Array, q: Float64Array, u: V3, roll: number, pro: number, e: number, dev = EZ.dev) {
  q.set(base)
  setOverheadShoulder(skel, q, u, roll)
  q[skel.dof['elbow_l.flex']] = e
  q[skel.dof['forearm_l.pro']] = pro
  q[skel.dof['wrist_l.flex']] = EZ.wrist
  q[skel.dof['wrist_l.dev']] = dev
  mirrorArm(skel, q)
  return handFrame(skel, fk(skel, q), 'l')
}

function frame(skel: Skeleton, v: Pick<SeatedEz, 'flex' | 'bar' | 'site' | 'roll'>, base: Float64Array, e: number, free = false) {
  const roll = v.roll
  const q = Float64Array.from(base)
  // the hand's knuckle line (index towards the midline) makes the bend's fixed angle with the bar's axis (X); the
  // humeral roll is held near `roll` (the upper arms stay still, cue 4), the forearm's turn and the wrist take the bar
  const ax = -v.site.axis[0]
  const { w } = EZ
  const u = (a: number) => armDir(v.flex, -EZ.inward - a)
  const res = ([r, p, d, a]: number[]) => {
    const h = armAt(skel, base, q, u(a), r, p, e, d)
    return [(h.pos[0] - v.site.pos[0]) * w.x, (h.axis[0] - ax) * w.axis, free ? 0 : (r - roll) / w.roll, (p - EZ.pro) / w.pro, (d - EZ.dev) / w.dev, a / w.inward]
  }
  const lim = ['forearm_l.pro', 'wrist_l.dev'].map((n) => skel.dofs[skel.dof[n]])
  const x = dls(res, [roll, EZ.pro, EZ.dev, 0], { lo: [-Infinity, lim[0].min, lim[1].min, -10], hi: [Infinity, lim[0].max, lim[1].max, 10], iters: 40, h: 1e-4 }).x
  const h = armAt(skel, base, q, u(x[3]), x[0], x[1], e, x[2])
  // the bar turns about its own axis so its inner bend lies along the knuckle line
  // (the hand axis is -site.axis = [-cx, 0, -sz] in the bar frame; about X it turns to [-cx, sz sin t, -sz cos t])
  const rot = qaxis([1, 0, 0], Math.atan2(h.axis[1], -h.axis[2]))
  const g = sitePos(skel, fk(skel, q), 'grip_l')
  const pos = sub([0, g[1], g[2]], qrot(rot, [0, v.site.pos[1], v.site.pos[2]]))
  return { q, pose: { id: v.bar.id, pos, rot } as ImplementPose, x: { roll: x[0], pro: x[1] } }
}

export function seatedEzContext(p: P, skel: Skeleton, tempo: Tempo): SeatedEz {
  const half = skel.segments[skel.seg.femur_l].offset[0] + 0.06
  const z = SEATED.hip[2] + skel.segments[skel.seg.femur_l].length + 0.08
  const feet = [plantFoot(skel, 'l', [half, 0, z], 12), plantFoot(skel, 'r', [-half, 0, z], 12)]
  const q0 = seatedBase(skel, feet)
  const caps = bodyCapsules(skel, fk(skel, q0))
  const trunk = caps.filter((k) => k.region === 'trunk')
  const seatTop = lowest(caps, ['trunk']) + SEATED.sink
  const back = Math.min(...trunk.map((k) => Math.min(k.a[2], k.b[2]) - k.r)) + SEATED.sink
  const benchSpec = bench({ backAngle: 90, seatHeight: seatTop, backLength: 0.745 })
  const benchPose: ImplementPose = { id: benchSpec.id, pos: [0, seatTop, back], rot: qid() }
  const g = (p.gripWidth * skel.data.shoulderWidth) / 2
  const bar = ezBar({ plateKg: EZ.plateKg, inner: g })
  const site = { pos: bar.sites.l_in.pos, axis: bar.sites.l_in.axis! }
  const contacts: Contact[] = [
    ...footContacts(skel, feet),
    { site: 'grip_l', kind: 'grip', target: { implement: 'bar', grip: 'l_in' } },
    { site: 'grip_r', kind: 'grip', target: { implement: 'bar', grip: 'r_in' } },
  ]
  const setup: Setup = { implements: [bar, benchSpec], contacts, tempo, symmetric: true }
  const v: SeatedEz = { kind: 'seated-ez', tempo, setup, elbow: [EZ.lock, EZ.maxElbow], feet, flex: p.shoulderFlexion + EZ.lift, bar, benchPose, site, roll: EZ.roll }
  // lower the bar until it and the hands come within `clear` of the back pad, head, neck or upper back
  const pad = placeParts(benchSpec, benchPose)[1]
  const gap = (e: number) => {
    const { q, pose } = frame(skel, v, q0, e)
    const all = bodyCapsules(skel, fk(skel, q))
    const arms = all.filter((k) => /^(hand|forearm)_/.test(k.region))
    const body = all.filter((k) => k.region === 'head' || k.region === 'neck' || k.region === 'trunk')
    const solids = placeParts(bar, pose)
    return Math.min(...solids.map((sd) => solidClearance(sd, pad)), ...arms.map((k) => capsuleSolidClearance(k, pad)), ...solids.flatMap((sd) => body.map((k) => capsuleSolidClearance(k, sd)))) - EZ.clear
  }
  // the roll the hands want with the bar behind the head, then held from there to lockout
  const settle = () => (v.roll = frame(skel, v, q0, v.elbow[1], true).x.roll)
  settle()
  if (gap(EZ.maxElbow) < 0) {
    v.elbow = [EZ.lock, root1d(gap, 80, EZ.maxElbow, { tol: 1e-4 }).x]
    settle()
  }
  return v
}

export function sampleSeatedEz(u: number, _p: P, skel: Skeleton, v: SeatedEz): Sampled {
  const e = lerp(v.elbow[1], v.elbow[0], phaseAt(u, v.tempo).c)
  const { q, pose } = frame(skel, v, seatedBase(skel, v.feet), e)
  return { q, implements: [pose, v.benchPose] }
}
