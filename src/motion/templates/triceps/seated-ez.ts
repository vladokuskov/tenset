import { bodyCapsules, capsuleSolidClearance, placeParts, solidClearance } from '../../collide.ts'
import { handFrame, plantFoot, root1d, type FootTarget } from '../../constraints.ts'
import { fk, sitePos } from '../../fk.ts'
import { bench, ezBar, type ImplementSpec } from '../../implements.ts'
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
  /** start of the forearm turn and the humeral roll, deg */
  pro: 70,
  roll: 0,
}

export type SeatedEz = Base & {
  kind: 'seated-ez'
  elbow: readonly [number, number]
  feet: FootTarget[]
  u: V3
  bar: ImplementSpec
  benchPose: ImplementPose
  /** the left hand's site on the bar */
  site: { pos: V3; axis: V3 }
}

/** the left arm on u with roll and forearm turn, the elbow at e (mirrored); returns the grip and hand axis */
function armAt(skel: Skeleton, base: Float64Array, q: Float64Array, u: V3, roll: number, pro: number, e: number) {
  q.set(base)
  setOverheadShoulder(skel, q, u, roll)
  q[skel.dof['elbow_l.flex']] = e
  q[skel.dof['forearm_l.pro']] = pro
  q[skel.dof['wrist_l.flex']] = EZ.wrist
  q[skel.dof['wrist_l.dev']] = EZ.dev
  mirrorArm(skel, q)
  return handFrame(skel, fk(skel, q), 'l')
}

function frame(skel: Skeleton, v: Pick<SeatedEz, 'u' | 'bar' | 'site'>, base: Float64Array, e: number, start = { roll: EZ.roll, pro: EZ.pro }) {
  const q = Float64Array.from(base)
  // the hand's knuckle line (index towards the midline) makes the bend's fixed angle with the bar's axis (X)
  const ax = -v.site.axis[0]
  const res = (r: number, p: number) => {
    const h = armAt(skel, base, q, v.u, r, p, e)
    return [(h.pos[0] - v.site.pos[0]) * 100, (h.axis[0] - ax) * 10]
  }
  let x = [start.roll, start.pro]
  for (let it = 0; it < 30; it++) {
    const r0 = res(x[0], x[1])
    if (Math.abs(r0[0]) + Math.abs(r0[1]) < 1e-6) break
    const ja = res(x[0] + 0.05, x[1]).map((v, i) => (v - r0[i]) / 0.05)
    const jb = res(x[0], x[1] + 0.05).map((v, i) => (v - r0[i]) / 0.05)
    const det = ja[0] * jb[1] - jb[0] * ja[1]
    const d = [(-r0[0] * jb[1] + jb[0] * r0[1]) / det, (-ja[0] * r0[1] + r0[0] * ja[1]) / det]
    const k = Math.min(1, 10 / Math.max(Math.abs(d[0]), Math.abs(d[1])))
    x = [x[0] + d[0] * k, x[1] + d[1] * k]
  }
  const h = armAt(skel, base, q, v.u, x[0], x[1], e)
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
  const v: SeatedEz = { kind: 'seated-ez', tempo, setup, elbow: [EZ.lock, EZ.maxElbow], feet, u: armDir(p.shoulderFlexion + EZ.lift, -EZ.inward), bar, benchPose, site }
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
  if (gap(EZ.maxElbow) < 0) v.elbow = [EZ.lock, root1d(gap, 80, EZ.maxElbow, { tol: 1e-4 }).x]
  return v
}

export function sampleSeatedEz(u: number, _p: P, skel: Skeleton, v: SeatedEz): Sampled {
  const e = lerp(v.elbow[1], v.elbow[0], phaseAt(u, v.tempo).c)
  const { q, pose } = frame(skel, v, seatedBase(skel, v.feet), e)
  return { q, implements: [pose, v.benchPose] }
}
