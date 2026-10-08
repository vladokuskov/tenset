import { attachHand, handFrame, implementFromHand, plantFoot, root1d, solveLegs, type FootTarget } from '../../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { fk, segPos, sitePos, type FK } from '../../fk.ts'
import { bench, dumbbell, ezBar, type ImplementSpec } from '../../implements.ts'
import { add, cross, lerp, norm, qid, qrot, scale, sub, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'
import { footContacts, frameY, lowest, mirrorArm, setArm, type Base, type P, type Sampled } from './common.ts'
import { barArms } from './pushdown.ts'

/**
 * EZ skull crusher (706). Lying on the flat bench, head towards -Z on the back pad, feet flat on the floor either
 * side. Trunk and head rest `sink` m into the pads. Upper arms tilted back towards the head (shoulderFlexion ~110,
 * research skull crusher ~90-110), elbows narrow; the bar comes down behind the forehead, stopping `clear` m off the
 * head. Dumbbells (738): the same upper arms, palms facing in (forearms neutral) and the hands straight over the
 * elbows, so the dumbbells come down beside the ears; each dumbbell rides its hand.
 */
const LYING = { seat: 0.44, sink: 0.006, headSink: -0.006, feet: { x: 0.34, z: 0.62, toeOut: 15 }, abd: 2, pro: 60, clear: 0.025, maxElbow: 130 }

/** dumbbell variant: dumbbell mass, kg; the hands this far outside the elbows, m (the heads pass beside the ears) */
const LYING_DB = { kg: 10, out: 0.01 }

/** elbow flexion at lockout, deg */
const LYING_LOCK = 5
/** 5 kg plate radius, m (implements.ts barbell) */
const PLATE_5 = 0.115

export type Lying = Base & {
  kind: 'lying'
  elbow: readonly [number, number]
  hip: [number, number, number]
  neck: number
  feet?: FootTarget[]
  bar: ImplementSpec
  /** dumbbell variant: one per hand instead of the bar */
  dbs?: ImplementSpec[]
  benchPose: ImplementPose
}

type Posture = Pick<Lying, 'hip' | 'neck' | 'feet'>

function lyingBase(skel: Skeleton, v: Posture) {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': -3, 'thorax.flex': 3, 'neck.flex': v.neck, 'head.flex': 0, 'clavicle_*.prot': -6, 'clavicle_*.elev': -2 })
  setPelvis(skel, q, v.hip, -90)
  if (v.feet) solveLegs(skel, q, v.feet)
  return q
}

/** EZ bar with 5 kg plates (the core bar draws 10 kg ones), inner grips at +-g */
function lightEz(g: number): ImplementSpec {
  const spec = ezBar({ plateKg: 5, inner: g })
  return { ...spec, parts: spec.parts.map((part) => (part.shape === 'cylinder' && part.r >= 0.06 ? { ...part, r: PLATE_5 } : part)) }
}

/** EZ bar at the reference grips, turned with the forearms (its camber towards the palms) */
function lyingBar(skel: Skeleton, f: FK, spec: ImplementSpec): ImplementPose {
  const g = sitePos(skel, f, 'grip_l')
  const fore = sub(segPos(skel, f, 'hand_l'), segPos(skel, f, 'forearm_l'))
  const rot = frameY(norm([0, fore[1], fore[2]]))
  const mid = scale(add(spec.sites.l_in.pos, spec.sites.r_in.pos), 0.5)
  return { id: spec.id, pos: sub([0, g[1], g[2]], qrot(rot, mid)), rot }
}

/**
 * dumbbells: the EZ arm's reference path, the hand straight over its elbow (forearm in the sagittal plane), the
 * handle head to feet across the forearm and the palms facing in; the arm solved onto it as the bar's is, mirrored
 */
function lyingDumbbells(skel: Skeleton, q: Float64Array, p: P, dbs: ImplementSpec[], elbow: number): ImplementPose[] {
  setArm(skel, q, { flex: p.shoulderFlexion, abd: LYING.abd, rot: 0, elbow, pro: LYING.pro, wrist: 0 })
  const r = fk(skel, q)
  const e = segPos(skel, r, 'forearm_l'), g = sitePos(skel, r, 'grip_l')
  const fore = norm([0, g[1] - e[1], g[2] - e[2]])
  // over the elbow, at the reference reach from the shoulder (so the elbow keeps its keyed angle)
  const sh = segPos(skel, r, 'humerus_l')
  const dx = e[0] + LYING_DB.out - sh[0], dy = g[1] - sh[1], dz = g[2] - sh[2]
  const k = Math.sqrt(Math.max(0, (g[0] - sh[0]) ** 2 + dy * dy + dz * dz - dx * dx) / (dy * dy + dz * dz))
  const pos: V3 = [sh[0] + dx, sh[1] + k * dy, sh[2] + k * dz]
  attachHand(skel, q, 'l', { pos, axis: norm(cross([1, 0, 0], fore)), palm: [-1, 0, 0] }, { pole: [0, 1, 0.25], planeHint: 90 })
  mirrorArm(skel, q)
  const f = fk(skel, q)
  return dbs.map((spec, k) => {
    const h = handFrame(skel, f, k === 0 ? 'l' : 'r')
    return { id: spec.id, pos: h.pos, rot: implementFromHand(h.axis, h.palm) }
  })
}

function lyingFrame(skel: Skeleton, q: Float64Array, p: P, v: Lying, c: number, elbow = v.elbow): ImplementPose[] {
  const target = lerp(elbow[1], elbow[0], c)
  if (v.dbs) return lyingDumbbells(skel, q, p, v.dbs, target)
  setArm(skel, q, { flex: p.shoulderFlexion, abd: LYING.abd, rot: 0, elbow: target, pro: LYING.pro, wrist: 0 })
  const ref = Float64Array.from(q)
  const f = fk(skel, ref)
  const base = lyingBar(skel, f, v.bar)
  const fore = norm(sub(segPos(skel, f, 'hand_l'), segPos(skel, f, 'forearm_l')))
  // the hands take the bar's camber, which turns the forearms and moves the wrists a little: slide the bar along the
  // forearms until the solved elbow is back on its keyed angle
  let pose = base
  const err = (d: number) => {
    q.set(ref)
    pose = { ...base, pos: add(base.pos, scale(fore, d)) }
    // elbows up (a little towards the feet) through the whole rep, so the bend plane holds at lockout
    barArms(skel, q, v.bar, pose, ref, { out: LYING.abd, site: 'l_in', pole: [0, 1, 0.25] })
    return q[skel.dof['elbow_l.flex']] - target
  }
  err(root1d(err, -0.08, 0.1, { tol: 0.01, scan: 3 }).x)
  return [pose]
}

export function lyingContext(p: P, skel: Skeleton, tempo: Tempo): Lying {
  const v: Lying = { kind: 'lying', tempo, setup: undefined as unknown as Setup, elbow: [LYING_LOCK, LYING.maxElbow], hip: [0, 0.6, 0], neck: 0, bar: undefined as unknown as ImplementSpec, benchPose: undefined as unknown as ImplementPose }
  // trunk onto the pad, then the head: neck flexion that rests it on the pad too
  let q = lyingBase(skel, v)
  const trunkLow = lowest(bodyCapsules(skel, fk(skel, q)), ['trunk'])
  v.hip = [0, 0.6 - (trunkLow - (LYING.seat - LYING.sink)), 0]
  v.neck = root1d((n) => {
    v.neck = n
    return lowest(bodyCapsules(skel, fk(skel, lyingBase(skel, v))), ['head']) - (LYING.seat - LYING.headSink)
  }, -30, 40, { tol: 1e-6 }).x
  const { x, z, toeOut } = LYING.feet
  v.feet = [plantFoot(skel, 'l', [x, 0, z], toeOut), plantFoot(skel, 'r', [-x, 0, z], toeOut)]
  q = lyingBase(skel, v)
  // the back pad ends just past the head (the drawn bench's pad reaches 0.81 m from the hinge)
  const top = sitePos(skel, fk(skel, q), 'head_top')
  const hinge: [number, number, number] = [0, LYING.seat, top[2] + 0.81 - 0.03]
  const benchSpec = bench({ backAngle: 0, seatHeight: LYING.seat })
  v.benchPose = { id: benchSpec.id, pos: hinge, rot: qid() }
  const g = (p.gripWidth * skel.data.shoulderWidth) / 2
  v.bar = lightEz(g)
  if (p.implement === 'dumbbell') v.dbs = [dumbbell({ id: 'db_l', mass: LYING_DB.kg }), dumbbell({ id: 'db_r', mass: LYING_DB.kg })]
  const held = v.dbs ?? [v.bar]
  const contacts: Contact[] = footContacts(skel, v.feet)
  if (v.dbs) contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: 'db_l', grip: 'c' } }, { site: 'grip_r', kind: 'grip', target: { implement: 'db_r', grip: 'c' } })
  else contacts.push({ site: 'grip_l', kind: 'grip', target: { implement: 'bar', grip: 'l_in' } }, { site: 'grip_r', kind: 'grip', target: { implement: 'bar', grip: 'r_in' } })
  v.setup = { implements: [...held, benchSpec], contacts, tempo, symmetric: true }
  // lower the bar until it is `clear` off the head (never past maxElbow)
  const headGap = (e: number) => {
    const qq = lyingBase(skel, v)
    const poses = lyingFrame(skel, qq, p, v, 0, [LYING_LOCK, e])
    const head = bodyCapsules(skel, fk(skel, qq)).filter((k) => k.region === 'head')
    return Math.min(...held.flatMap((spec, k) => placeParts(spec, poses[k]).flatMap((sd) => head.map((h) => capsuleSolidClearance(h, sd))))) - LYING.clear
  }
  if (headGap(LYING.maxElbow) < 0) v.elbow = [LYING_LOCK, root1d(headGap, 90, LYING.maxElbow, { tol: 1e-4 }).x]
  return v
}

export function sampleLying(u: number, p: P, skel: Skeleton, v: Lying): Sampled {
  const q = lyingBase(skel, v)
  const held = lyingFrame(skel, q, p, v, phaseAt(u, v.tempo).c)
  return { q, implements: [...held, v.benchPose] }
}
