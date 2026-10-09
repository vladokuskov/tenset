import { bodyCapsules, capsuleSolidClearance, placeParts, solidClearance } from '../../collide.ts'
import { DEV_BAND, root1d, softBand } from '../../constraints.ts'
import { fk, sitePos } from '../../fk.ts'
import { dumbbell, type ImplementSpec, type Part } from '../../implements.ts'
import { pressBench, PRESS_BENCH } from '../../implements/press-horizontal.ts'
import { dls, shoulderAngles } from '../../ik.ts'
import { cross, DEG, dot, eulerFrom, norm, qaxis, qconj, qfromBasis, qid, qmul, qrot, RAD, scale, sub, type Quat, type V3 } from '../../math.ts'
import { setDofs, setScapula, shoulderRhythm, zeroQ, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { BACK_CAPS, minClear, plantFeet, restHead, seatedCaps, solidOf, trunkPose, type Posture } from '../press-body.ts'
import { mirrorArm } from '../row/common.ts'
import { swing } from '../triceps/common.ts'
import type { ParamsOf } from '../schemas.ts'
import type { Setup } from '../types.ts'

// Dumbbell pullover (326) lying on a flat bench, head at the bench's end, feet planted, a light arch held still. One
// dumbbell in both hands, palms flat under the top head either side of the handle (the diamond hold of the seated
// overhead extension). The elbows hold a slight fixed bend (elbowAngle) and the arms sweep in the sagittal plane, drawn
// in so the hands meet, from over the chest (arms vertical) back past the head until the arms are about level with the
// ears (shoulder flexion ~90 -> ~160; research: pullover 90 -> 150-180 with the elbows held 10-30). The dumbbell stays
// in line with the forearms, its lower head towards the face, so the wrists hold one shape through the rep. The stretch
// stops where the dumbbell and hands come within reach of the head or the bench's end.

type P = ParamsOf<'pullover'>

export const LIE = {
  seatHeight: 0.44,
  sink: 0.01,
  /** a light arch: pelvis anterior tilt from the pad, lumbar and thoracic extension */
  arch: { pelvis: 4, lumbar: -4, thorax: -2 },
  clavicle: { prot: -4, elev: 0 },
  knee: 85,
  feetHalf: 0.4,
  /** the crown of the head this far in from the back pad's end, m */
  crown: 0.03,
  kg: 16,
  /** shoulder flexion against the thorax at the stretch (most), deg */
  top: 160,
  /** humeral rotation, deg (+ internal): the soft elbows point out to the sides and towards the hips */
  rot: 20,
  /** dumbbell lean from the arms' line over the chest, its lower head towards the face, deg */
  lean: 30,
  /** smallest gap of the dumbbell and hands to the head, face, neck and the bench at the stretch, m */
  clear: 0.015,
  /**
   * humeral rotation allowed (deg, + internal). The arm turns rigidly about the trunk's left-right axis, drawn in ~20
   * deg so the hands meet: with the arm across the face near the overhead pole the swing-twist chart reads that as
   * ~95 deg of internal rotation at the stretch, though nothing turns about the humerus (a lead decision)
   */
  rotLimit: [-110, 100] as [number, number],
  /** share of the scapulohumeral rhythm's clavicle elevation kept (the shoulder blades lie on the pad) */
  shrug: 0.5,
}
/** dumbbell frame: X up the handle, Y forward, Z to the lifter's left; the left hand flat under the top head */
export const PLATE = { site: [0.035, -0.02, 0.06] as V3, fingers: [0.25, -1, 0.2] as V3, palm: [1, 0, -0.45] as V3 }

export type Lying = {
  kind: 'lying'
  shape: ArmShape
  tempo: Tempo
  setup: Setup
  base: Float64Array
  /** shoulder flexion against the thorax at the stretch and the finish, deg */
  range: [number, number]
  db: ImplementSpec
  benchPose: ImplementPose
}

function plateHand(): { axis: V3; palm: V3 } {
  const f = norm(PLATE.fingers)
  const p0 = norm(PLATE.palm)
  const palm = norm(sub(p0, scale(f, dot(p0, f))))
  return { axis: cross(palm, f), palm }
}

function handInDb(): Quat {
  const { axis, palm } = plateHand()
  return qfromBasis(axis, palm)
}

/** forearm turn and wrist angles (deg) that bring the left hand's grip frame onto `grip`, inside the joint limits */
function wristTo(skel: Skeleton, q: Float64Array, grip: Quat) {
  const names = ['forearm_l.pro', 'wrist_l.flex', 'wrist_l.dev']
  for (const n of names) q[skel.dof[n]] = 0
  const f = fk(skel, q)
  const site = skel.data.sites.grip_l
  const hand = qmul(grip, qconj(qfromBasis(site.axis!, site.normal!)))
  const e = eulerFrom(qmul(qconj(f.rot[skel.seg.forearm_l]), hand), 1, 2, 0)
  const axes = [1, 2, 0]
  names.forEach((n, i) => {
    const d = skel.dofs[skel.dof[n]]
    q[skel.dof[n]] = softBand((e[i] * RAD) / d.axis[axes[i]], i === 2 ? DEV_BAND : [d.min + 2, d.max - 2])
  })
}

/** thorax-frame arm direction (left) at flexion `flex`, drawn in by `inward` */
function armAxes(flex: number, inward: number) {
  const a = flex * DEG, s = -inward * DEG
  return { u: [Math.sin(s), -Math.cos(a) * Math.cos(s), Math.sin(a) * Math.cos(s)] as V3 }
}

/** left shoulder at flexion `flex`, drawn in by `inward` deg, humeral rotation `rot` (deg, + internal) */
function shoulder(skel: Skeleton, q: Float64Array, flex: number, inward: number, rot: number) {
  const { plane, elev } = swing(armAxes(flex, inward).u)
  setDofs(skel, q, { 'shoulder_l.plane': plane, 'shoulder_l.elev': elev, 'shoulder_l.rot': rot })
  const g = shoulderRhythm(elev, plane)
  setDofs(skel, q, { 'clavicle_*.elev': LIE.clavicle.elev + g.elev * LIE.shrug, 'clavicle_*.prot': LIE.clavicle.prot + g.prot })
  setScapula(skel, q, 'l')
}

/** the dumbbell's rotation: the handle in the sagittal plane at `flex - lean` deg of the arc */
function dbRotation(skel: Skeleton, q: Float64Array, flex: number, lean: number): Quat {
  const rot = fk(skel, q).rot[skel.seg.thorax2]
  const a = (flex - lean) * DEG
  const up = norm(qrot(rot, [0, -Math.cos(a), Math.sin(a)]))
  return qfromBasis(up, cross([1, 0, 0], up))
}

/** both arms at flexion `flex`: the arms draw in until both hands meet under the plate */
function armsAt(skel: Skeleton, base: Float64Array, flex: number, elbow: number, rot: number, lean: number) {
  const q = Float64Array.from(base)
  const grip = qmul(dbRotation(skel, q, flex, lean), handInDb())
  const gripAt = (inward: number) => {
    q.set(base)
    shoulder(skel, q, flex, inward, rot)
    q[skel.dof['elbow_l.flex']] = elbow
    wristTo(skel, q, grip)
    mirrorArm(skel, q)
    return sitePos(skel, fk(skel, q), 'grip_l')
  }
  gripAt(root1d((r) => gripAt(r)[0] - PLATE.site[2], -10, 70, { tol: 1e-7 }).x)
  return q
}

/** the left arm over the chest (finish): humerus orientation against the thorax, the elbow, forearm and wrist DOFs */
export type ArmShape = { flex: number; hum: Quat; pro: number; wflex: number; dev: number }

/**
 * Over the chest the arms draw in until both hands meet under the plate (humeral rotation LIE.rot, the dumbbell leaning
 * LIE.lean from the arms); along the arc the whole arm turns rigidly about the thorax's left-right axis from there, so
 * the hands and the dumbbell keep one shape and the dumbbell stays square to the lifter
 */
function armShape(skel: Skeleton, base: Float64Array, flex: number, elbow: number): ArmShape {
  const q = armsAt(skel, base, flex, elbow, LIE.rot, LIE.lean)
  const f = fk(skel, q)
  const hum = qmul(qconj(f.rot[skel.seg.thorax2]), f.rot[skel.seg.humerus_l])
  const d = (n: string) => q[skel.dof[n]]
  return { flex, hum, pro: d('forearm_l.pro'), wflex: d('wrist_l.flex'), dev: d('wrist_l.dev') }
}

/** both arms at flexion `flex`, turned rigidly from the finish shape */
function rigidArms(skel: Skeleton, base: Float64Array, shape: ArmShape, flex: number, elbow: number) {
  const q = Float64Array.from(base)
  const hum = qmul(qaxis([1, 0, 0], -(flex - shape.flex) * DEG), shape.hum)
  const sh = shoulderAngles(hum, 'l', 110)
  setDofs(skel, q, { 'shoulder_l.plane': sh.plane, 'shoulder_l.elev': sh.elev, 'shoulder_l.rot': sh.rot, 'elbow_l.flex': elbow, 'forearm_l.pro': shape.pro, 'wrist_l.flex': shape.wflex, 'wrist_l.dev': shape.dev })
  const g = shoulderRhythm(sh.elev, sh.plane)
  setDofs(skel, q, { 'clavicle_*.elev': LIE.clavicle.elev + g.elev * LIE.shrug, 'clavicle_*.prot': LIE.clavicle.prot + g.prot })
  setScapula(skel, q, 'l')
  mirrorArm(skel, q)
  return q
}

export function frame(skel: Skeleton, v: Pick<Lying, 'base' | 'db' | 'shape'>, flex: number, elbow: number) {
  const q = rigidArms(skel, v.base, v.shape, flex, elbow)
  const f = fk(skel, q)
  const site = skel.data.sites.grip_l
  const hand = qmul(f.rot[skel.seg.hand_l], qfromBasis(site.axis!, site.normal!))
  const rot = qmul(hand, qconj(handInDb()))
  // centred between the mirrored hands: the shoulders' small sideways drift splits between them
  const pos = sub(sitePos(skel, f, 'grip_l'), qrot(rot, PLATE.site))
  pos[0] = 0
  return { q, pose: { id: v.db.id, pos, rot } as ImplementPose }
}

/** lying flat: the butt and upper back on the pads, the crown of the head LIE.crown in from the back pad's end */
function placeBody(skel: Skeleton, bench: ImplementSpec, pose: ImplementPose): { hip: V3; s: Posture } {
  const s0: Posture = { tilt: -90 + LIE.arch.pelvis, lumbar: LIE.arch.lumbar, thorax: LIE.arch.thorax, clavicle: LIE.clavicle }
  const seat = solidOf(bench, pose, 0)
  const pad = solidOf(bench, pose, 1)
  const end = pose.pos[2] - PRESS_BENCH.gap - PRESS_BENCH.back.len
  const res = (x: number[]) => {
    const c = seatedCaps(skel, [0, x[0], x[2]], { ...s0, tilt: x[1] })
    const head = bodyCapsules(skel, fk(skel, bodyQ(skel, [0, x[0], x[2]], { ...s0, tilt: x[1] }))).filter((k) => k.region === 'head')
    const crown = Math.min(...head.map((k) => Math.min(k.a[2], k.b[2]) - k.r))
    const pelvis = c.filter((k) => k.segment === 'pelvis')
    return [(Math.min(minClear(pelvis, seat), minClear(pelvis, pad)) + LIE.sink) * 100, (minClear(c.filter(BACK_CAPS), pad) + LIE.sink) * 100, (crown - end - LIE.crown) * 100]
  }
  const r = dls(res, [pose.pos[1] + 0.1, s0.tilt, pose.pos[2] - 0.2], { tol: 1e-7, iters: 80 })
  return { hip: [0, r.x[0], r.x[2]], s: { ...s0, tilt: r.x[1] } }
}

function bodyQ(skel: Skeleton, hip: V3, s: Posture) {
  const q = zeroQ(skel)
  trunkPose(skel, q, hip, s)
  return q
}

export function lyingContext(p: P, skel: Skeleton, tempo: Tempo): Lying {
  const bench = pressBench({ backAngle: 0, seatHeight: LIE.seatHeight })
  const benchPose: ImplementPose = { id: 'bench', pos: [0, LIE.seatHeight, 0], rot: qid() }
  const { hip, s } = placeBody(skel, bench, benchPose)
  const base = bodyQ(skel, hip, s)
  const pad = solidOf(bench, benchPose, 1)
  restHead(skel, base, pad)
  const legs = plantFeet(skel, base, hip, LIE.knee, LIE.feetHalf)
  const db = dumbbell({ id: 'db', mass: LIE.kg })
  const { axis } = plateHand()
  const [cx, cy, cz] = PLATE.site
  db.sites.cup_l = { pos: [cx, cy, cz], axis }
  db.sites.cup_r = { pos: [cx, cy, -cz], axis: [axis[0], axis[1], -axis[2]] }
  const contacts = [...legs.contacts, { site: 'grip_l', kind: 'grip' as const, target: { implement: 'db', grip: 'cup_l' } }, { site: 'grip_r', kind: 'grip' as const, target: { implement: 'db', grip: 'cup_r' } }]
  const setup: Setup = { implements: [db, bench], contacts, tempo, symmetric: true, rests: [{ implement: 'db', regions: ['hand_l', 'hand_r'], tol: 15 }], limits: { 'shoulder_l.rot': LIE.rotLimit, 'shoulder_r.rot': LIE.rotLimit } }
  const v: Lying = { kind: 'lying', tempo, setup, base, range: [p.topElevation ?? LIE.top, 90], db, benchPose, shape: undefined as never }
  // finish: the arms vertical over the shoulders
  const f0 = fk(skel, base)
  const thorax = f0.rot[skel.seg.thorax2]
  v.range[1] = root1d((fl) => qrot(thorax, armAxes(fl, 0).u)[2], 40, 140, { tol: 1e-6 }).x
  v.shape = armShape(skel, base, v.range[1], p.elbowAngle)
  // stretch: as far back as keeps the dumbbell and hands clear of the head, neck, face and the bench
  const solidsOf = (pose: ImplementPose) => placeParts(db, pose)
  const benchParts = (bench.parts as Part[]).map((_, i) => solidOf(bench, benchPose, i))
  const gap = (fl: number) => {
    const { q, pose } = frame(skel, v, fl, p.elbowAngle)
    const all = bodyCapsules(skel, fk(skel, q))
    const hands = all.filter((k) => /^(hand|forearm)_/.test(k.region))
    const body = all.filter((k) => k.region === 'head' || k.region === 'neck')
    const sd = solidsOf(pose)
    return Math.min(
      ...sd.flatMap((a) => benchParts.map((b) => solidClearance(a, b))),
      ...hands.flatMap((k) => benchParts.map((b) => capsuleSolidClearance(k, b))),
      ...sd.flatMap((a) => body.map((k) => capsuleSolidClearance(k, a))),
    ) - LIE.clear
  }
  if (gap(v.range[0]) < 0) v.range[0] = root1d(gap, v.range[1] + 20, v.range[0], { tol: 1e-4 }).x
  return v
}

export function sampleLying(u: number, p: P, skel: Skeleton, v: Lying): Pose {
  const c = phaseAt(u, v.tempo).c
  const flex = v.range[0] + (v.range[1] - v.range[0]) * c
  const { q, pose } = frame(skel, v, flex, p.elbowAngle)
  return { q, implements: [pose, v.benchPose], contacts: v.setup.contacts }
}
