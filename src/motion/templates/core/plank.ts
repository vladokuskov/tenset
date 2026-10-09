import { attachHand, root1d, type FootTarget } from '../../constraints.ts'
import { bodyCapsules, capsuleClearance, type Capsule } from '../../collide.ts'
import { fk, sitePos, type FK } from '../../fk.ts'
import type { ImplementSpec } from '../../implements.ts'
import { palmRest } from '../../implements/core.ts'
import { floorMat } from '../../implements/shared.ts'
import { dls } from '../../ik.ts'
import { add, dist, lerp, qaxis, qfromBasis, qid, qrot, sub, type Quat, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Side, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import type { ParamsOf } from '../schemas.ts'
import type { Setup } from '../types.ts'
import { footContacts, legsToward, matClearance, MAT_TOP, mirrorArm, segPosOf, SINK, toWorld } from './floor.ts'

// Forearm planks as breathing holds (unit seconds): the supports stay put and the body keeps its straight line while
// it breathes. Contraction c from the default tempo is the breath: the slow eccentric is the inhale (ribs lift a
// little, the hips settle a few millimetres), the quick concentric is the exhale and brace (pelvis tucks, the
// shoulders push the floor away) with the highlight pulse. Front plank (804): prone on the forearms, elbows under the
// shoulders, forearms parallel with loose fists, up on the toes. Side plank (803): on the working side's forearm, elbow
// under the shoulder, legs stacked, hips up in line with ankles and shoulders, the free arm reaching straight up
// (a hand resting on the curved flank cannot lie flat within the wrist's extension limit, so it floated). Research
// (motion-authoring): anti-extension / anti-lateral-flexion holds keep a neutral spine; ranges are author judgment.

type P = ParamsOf<'hold'>

/** front plank posture, deg: braced (c = 1) and inhaled (c = 0) values */
export const FRONT = { lumbar: [2, 4.7], thorax: [-1.5, 1.2], tilt: [0, -3.1], clavicle: [7, 10.6], neck: [-4, -7.6], hip: 3 } as const
/** side plank posture, deg, inhaled -> braced: lateral sag of the lumbar spine (the pelvis list follows it so the
 * straight legs keep reaching the feet), ribs and neck */
export const SIDE = { bend: [1.5, 0], thorax: [0.6, 0], clavicle: [4, 6.5], neck: [-2, 0] } as const
/** ankles, deg: the front plank (as the push-up) has heels up and back and the balls of the feet on the mat, toes
 * turned under and lying flat */
const ANKLE = { front: 28, side: 4 }
/**
 * Front plank: how far the forefoot capsule sinks into the mat, mm. It is rigid with the foot and models straight
 * toes, while here they are turned under (the push-up's FOOT_SINK, a lead decision).
 */
export const FOOT_SINK = 65
/**
 * Stacked legs press the inner thighs together: the thigh capsules (up to 10 cm radius, fitted to the widest part of
 * the mesh) overlap ~41 mm when the feet stack 12 mm apart, mm (lead decision)
 */
export const STACKED_THIGHS = 42
/**
 * Side plank hip dip: the hips sink towards the mat by side-bending the spine (the upper flank shortens), the lumbar
 * spine taking this share; the legs keep aiming at the stacked feet (holdReach turns the pelvis), so the dip is the
 * spine's bend between the fixed elbow and feet. The hips lower over the slow eccentric and drive up over the
 * concentric; the top is the plain side plank.
 */
export const DIP = { lumbar: 0.6 } as const
/** side plank raised arm: share of the zero pose's shoulder-to-grip distance, ~12 deg of elbow flexion */
const REACH_SOFT = 1.006
/** elbow joint height with the forearm on the mat, m (the upper arm's distal capsule radius, sunk into the mat) */
const ELBOW_Y = MAT_TOP + 0.054 - SINK

export type Plank = {
  kind: 'plank'
  side: boolean
  tempo: Tempo
  setup: Setup
  work: Side
  /** pelvis tilt (front) or list (side) holding the line, deg */
  angle0: number
  /** shoulder joint target: both shoulders' midpoint (front), the support shoulder (side) */
  shoulder: V3
  feet: FootTarget[]
  /** fist grip targets on the mat */
  fists: Partial<Record<Side, { pos: V3; hand: Quat; elbow: V3 }>>
  rest?: ImplementSpec
  /** side plank: top shoulder to the raised hand's grip site, m */
  reach?: number
  /** front plank: toe flexion that lays the turned-under toes flat, deg */
  toe?: number
  /** side plank: hip adduction (both legs) that stacks the feet, deg */
  upAbd?: number
  /** side plank hip dip: spine side bend at the bottom, deg */
  dip?: number
  /** hip to ankle distance of the straight legs, braced, m */
  legReach: Record<Side, number>
  mat: ImplementPose
  guess: [number, number]
}

/** loose fist resting on its little-finger edge, fingers along `dir` (horizontal), thumb up */
function fistHand(dir: V3): Quat {
  // local X (the left hand's back, the right hand's palm) points to the lifter's left of `dir`; fingers (-Y local)
  // along dir, so the thumb (+Z local) points up on both hands
  return qfromBasis([dir[2], 0, -dir[0]], [-dir[0], -dir[1], -dir[2]])
}

// ---------- front plank ----------

function frontBody(skel: Skeleton, q: Float64Array, c: number, angle: number, toe = 0) {
  setDofs(skel, q, {
    'lumbar.flex': lerp(FRONT.lumbar[1], FRONT.lumbar[0], c),
    'thorax.flex': lerp(FRONT.thorax[1], FRONT.thorax[0], c),
    'neck.flex': lerp(FRONT.neck[1], FRONT.neck[0], c),
    'head.flex': -2,
    'clavicle_*.prot': lerp(FRONT.clavicle[0], FRONT.clavicle[1], c),
    'clavicle_*.elev': 4,
    'hip_*.flex': FRONT.hip,
    'hip_*.abd': 2,
    'knee_*.flex': 2,
    'ankle_*.df': ANKLE.front,
    'toe_*.flex': toe,
    'grip_*.close': 1,
  })
  q[skel.dof['pelvis.tilt']] = angle + lerp(FRONT.tilt[1], FRONT.tilt[0], c)
}

const shoulders = (skel: Skeleton, f: FK): V3 => {
  const l = segPosOf(skel, f, 'humerus_l'), r = segPosOf(skel, f, 'humerus_r')
  return [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2, (l[2] + r[2]) / 2]
}


/** two root DOFs that put the shoulder point on its target: height and the `axis` coordinate */
function placeRoot(skel: Skeleton, q: Float64Array, at: (f: FK) => V3, target: V3, dofs: [string, string], guess: [number, number], axis: number) {
  const [a, b] = dofs.map((d) => skel.dof[d])
  const res = (x: number[]) => {
    q[a] = x[0]
    q[b] = x[1]
    const s = at(fk(skel, q))
    return [(s[1] - target[1]) * 10, (s[axis] - target[axis]) * 10]
  }
  res(dls(res, guess, { tol: 1e-10, iters: 40 }).x)
}

/**
 * Root placement that keeps each straight leg's hip to ankle distance at its braced value: the shoulder slides a few
 * millimetres along the body line (the arm tilts over the fixed elbow) and, given `list`, the pelvis list turns a
 * fraction of a degree so stacked legs both reach. With the shoulder fixed, the spine's breath would bend the
 * near-straight knees ~12 deg or pull the feet off the mat.
 */
function holdReach(skel: Skeleton, q: Float64Array, at: (f: FK) => V3, v: Plank, dofs: [string, string], axis: number, list?: { dof: string; base: number }) {
  const legs = (['l', 'r'] as const).map((s) => ({ s, ankle: v.feet.find((ft) => ft.side === s)!.ankle }))
  const err = (f: FK) => legs.map(({ s, ankle }) => (dist(segPosOf(skel, f, `femur_${s}`), ankle) - v.legReach[s]) * 100)
  const place = (d: number) => {
    const target: V3 = [...v.shoulder]
    target[axis] += d
    placeRoot(skel, q, at, target, dofs, v.guess, axis)
    return fk(skel, q)
  }
  if (!list) {
    const mean = (d: number) => {
      const e = err(place(d))
      return (e[0] + e[1]) / 2
    }
    mean(root1d(mean, -0.03, 0.03, { tol: 1e-7, scan: 3 }).x)
    return
  }
  const res = (x: number[]) => {
    q[skel.dof[list.dof]] = list.base + x[1]
    return err(place(x[0]))
  }
  res(dls(res, [0, 0], { tol: 1e-9, iters: 30 }).x)
}

const legReach = (skel: Skeleton, f: FK): Record<Side, number> => ({
  l: dist(segPosOf(skel, f, 'femur_l'), segPosOf(skel, f, 'foot_l')),
  r: dist(segPosOf(skel, f, 'femur_r'), segPosOf(skel, f, 'foot_r')),
})

/** the elbow bends towards its spot on the mat under the shoulder */
function elbowPole(skel: Skeleton, q: Float64Array, side: Side, g: { pos: V3; elbow: V3 }): V3 {
  const sh = segPosOf(skel, fk(skel, q), `humerus_${side}`)
  return sub(g.elbow, [(sh[0] + g.pos[0]) / 2, (sh[1] + g.pos[1]) / 2, (sh[2] + g.pos[2]) / 2])
}

function frontArms(skel: Skeleton, q: Float64Array, v: Plank) {
  const g = v.fists.l!
  attachHand(skel, q, 'l', { pos: g.pos, axis: [0, 0, 1], palm: [-1, 0, 0], hand: g.hand }, { pole: elbowPole(skel, q, 'l', g), planeHint: 90 })
  mirrorArm(skel, q)
}

/**
 * Front plank; `ahead` (m) puts the elbows that far in front of the shoulders (long-lever plank): the upper arms lean
 * forward and the shoulders sit lower, the body line a little longer over the same feet.
 */
export function frontContext(skel: Skeleton, tempo: Tempo, ahead = 0): Plank {
  const q = zeroQ(skel)
  const upper = skel.segments[skel.seg.humerus_l].length
  const shoulderY = ELBOW_Y + (ahead ? Math.sqrt(upper * upper - ahead * ahead) : upper)
  const target: V3 = [0, shoulderY, 0]
  // line: pelvis tilt and height so the shoulders sit over the elbows and the toes rest on the mat
  const res = (x: number[]) => {
    frontBody(skel, q, 1, x[1])
    q[skel.dof['pelvis.ty']] = x[0]
    q[skel.dof['pelvis.tz']] = 0
    const f0 = fk(skel, q)
    q[skel.dof['pelvis.tz']] = -shoulders(skel, f0)[2]
    const f = fk(skel, q)
    // up on the toes: the balls of the feet on the mat
    return [(shoulders(skel, f)[1] - shoulderY) * 10, (sitePos(skel, f, 'ball_l')[1] - MAT_TOP) * 10]
  }
  const s = dls(res, [0.3, 80], { tol: 1e-10, iters: 80 })
  res(s.x)
  // toes turned under, lying flat on the mat
  const toe = root1d((t) => {
    q[skel.dof['toe_l.flex']] = t
    return qrot(fk(skel, q).rot[skel.seg.toes_l], [0, 0, 1])[1]
  }, -60, 30, { tol: 1e-6, scan: 9 }).x
  q[skel.dof['toe_r.flex']] = toe
  const f = fk(skel, q)
  const feet: FootTarget[] = (['l', 'r'] as const).map((side) => ({ side, rot: f.rot[skel.seg[`foot_${side}`]], ankle: segPosOf(skel, f, `foot_${side}`) }))
  // fists straight ahead of the elbows (under the shoulders), forearms on the mat
  const fists: Plank['fists'] = {}
  const lf = skel.segments[skel.seg.forearm_l].length
  for (const side of ['l', 'r'] as const) {
    const sh = segPosOf(skel, f, `humerus_${side}`)
    const hand = fistHand([0, 0, 1])
    const elbow: V3 = [sh[0] * 0.92, ELBOW_Y, sh[2] + ahead]
    const wrist: V3 = [elbow[0], ELBOW_Y - 0.004, sh[2] + ahead + lf]
    fists[side] = { pos: add(wrist, qrot(hand, skel.data.sites[`grip_${side}`].local)), hand, elbow }
  }
  const rest = palmRest({ id: 'fists', sites: { l: fists.l!.pos, r: fists.r!.pos } })
  const contacts: Contact[] = [
    ...footContacts(skel, feet, ['ball']),
    { site: 'grip_l', kind: 'grip', target: { implement: rest.id, grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: rest.id, grip: 'r' } },
  ]
  // mat from behind the balls of the feet to past the fists (the plank is longer than the standard 1.8 m mat)
  const back = sitePos(skel, f, 'ball_l')[2] - 0.08, front = fists.l!.pos[2] + 0.08
  const matSpec = floorMat({ length: front - back })
  const mat: ImplementPose = { id: matSpec.id, pos: [0, 0, (back + front) / 2], rot: qid() }
  const rests = [{ implement: matSpec.id, regions: ['foot_l', 'foot_r'], tol: FOOT_SINK }]
  const setup: Setup = { implements: [matSpec, rest], contacts, tempo, symmetric: true, rests, tolerances: { floor: FOOT_SINK } }
  return { kind: 'plank', side: false, tempo, setup, work: 'r', angle0: s.x[1], toe, legReach: legReach(skel, f), shoulder: target, feet, fists, rest, mat, guess: [q[skel.dof['pelvis.ty']], q[skel.dof['pelvis.tz']]] }
}

export function samplePlank(skel: Skeleton, v: Plank, c: number): Pose {
  if (v.side) return sampleSide(skel, v, c)
  const q = zeroQ(skel)
  frontBody(skel, q, c, v.angle0, v.toe)
  holdReach(skel, q, (f) => shoulders(skel, f), v, ['pelvis.ty', 'pelvis.tz'], 2)
  legsToward(skel, q, v.feet, [0, -1, 0])
  frontArms(skel, q, v)
  return { q, implements: [v.mat, { id: v.rest!.id, pos: [0, 0, 0], rot: qid() }], contacts: v.setup.contacts }
}

// ---------- side plank ----------

function sideBody(skel: Skeleton, q: Float64Array, c: number, angle: number, work: Side, dip = 0) {
  const s = work === 'r' ? 1 : -1
  setDofs(skel, q, {
    'lumbar.bend': s * (lerp(SIDE.bend[0], SIDE.bend[1], c) + DIP.lumbar * dip),
    'thorax.bend': s * (lerp(SIDE.thorax[0], SIDE.thorax[1], c) + (1 - DIP.lumbar) * dip),
    'lumbar.flex': 2,
    'thorax.flex': 0,
    'neck.flex': 0,
    'neck.bend': s * lerp(SIDE.neck[0], SIDE.neck[1], c),
    'clavicle_*.elev': 2,
    'clavicle_*.prot': lerp(SIDE.clavicle[0], SIDE.clavicle[1], c),
    'hip_*.flex': 2,
    'knee_*.flex': 2,
    'ankle_*.df': ANKLE.side,
    'grip_*.close': 1,
  })
  q[skel.dof['pelvis.list']] = s * angle
}

const other = (s: Side): Side => (s === 'l' ? 'r' : 'l')

function sideArms(skel: Skeleton, q: Float64Array, v: Plank) {
  const g = v.fists[v.work]!
  attachHand(skel, q, v.work, { pos: g.pos, axis: [0, 0, 1], palm: [v.work === 'r' ? 1 : -1, 0, 0], hand: g.hand }, { pole: elbowPole(skel, q, v.work, g), planeHint: 90 })
  // free arm straight up from the top shoulder, palm forward, elbow soft
  const free = other(v.work)
  const pos = add(segPosOf(skel, fk(skel, q), `humerus_${free}`), [0, v.reach!, 0])
  const hand = handFacing(free, [0, 0, 1], [0, 1, 0])
  attachHand(skel, q, free, { pos, axis: qrot(hand, [0, 0, 1]), palm: [0, 0, 1], hand }, { pole: [0, 0, -1], planeHint: 90 })
  return pos
}

/** hand with its palm facing `palm` and fingers along `fingers` */
function handFacing(side: Side, palm: V3, fingers: V3): Quat {
  const x: V3 = side === 'l' ? [-palm[0], -palm[1], -palm[2]] : palm
  return qfromBasis(x, [-fingers[0], -fingers[1], -fingers[2]])
}

export function sideContext(p: P, skel: Skeleton, tempo: Tempo): Plank {
  const work: Side = p.side === 'left' ? 'l' : 'r'
  const q = zeroQ(skel)
  const shoulderY = ELBOW_Y + skel.segments[skel.seg.humerus_l].length
  const lowFoot = (c: Capsule) => c.region === `foot_${work}`
  const up = other(work)
  // stack the legs: both hips adduct until the feet touch
  const res = (x: number[]) => {
    sideBody(skel, q, 1, x[1], work)
    setDofs(skel, q, { 'hip_*.abd': x[2] })
    q[skel.dof['pelvis.ty']] = x[0]
    q[skel.dof['pelvis.tx']] = 0
    const sh = segPosOf(skel, fk(skel, q), `humerus_${work}`)
    q[skel.dof['pelvis.tx']] = -sh[0]
    q[skel.dof['pelvis.tz']] = -sh[2]
    const f = fk(skel, q)
    const caps = bodyCapsules(skel, f)
    const feetGap = Math.min(...caps.filter((c) => c.region === `foot_${up}`).flatMap((a) => caps.filter(lowFoot).map((b) => capsuleClearance(a, b))))
    return [(segPosOf(skel, f, `humerus_${work}`)[1] - shoulderY) * 10, (matClearance(caps.filter(lowFoot)) + SINK / 2) * 10, (feetGap - 0.012) * 10]
  }
  const r = dls(res, [0.3, 76, -3], { tol: 1e-10, iters: 80 })
  res(r.x)
  const f = fk(skel, q)
  const feet: FootTarget[] = (['l', 'r'] as const).map((side) => ({ side, rot: f.rot[skel.seg[`foot_${side}`]], ankle: segPosOf(skel, f, `foot_${side}`) }))
  const sh = segPosOf(skel, f, `humerus_${work}`)
  const lf = skel.segments[skel.seg.forearm_l].length
  const hand = fistHand([0, 0, 1])
  const elbow: V3 = [sh[0], ELBOW_Y, sh[2]]
  const wrist: V3 = [sh[0], ELBOW_Y - 0.004, sh[2] + lf]
  const fists: Plank['fists'] = { [work]: { pos: add(wrist, qrot(hand, skel.data.sites[`grip_${work}`].local)), hand, elbow } }
  // raised arm: shoulder to grip site with the elbow a little soft
  const z = fk(skel, zeroQ(skel))
  const reach = REACH_SOFT * dist(segPosOf(skel, z, `humerus_${up}`), toWorld(skel, z, `hand_${up}`, skel.data.sites[`grip_${up}`].local))
  const rest = palmRest({ id: 'fists', sites: { [work]: fists[work]!.pos } })
  const upRest = palmRest({ id: 'reach', sites: { [up]: [0, 0, 0] } })
  const contacts: Contact[] = [
    ...footContacts(skel, feet.filter((ft) => ft.side === work), ['heel', 'ball']),
    { site: `grip_${work}`, kind: 'grip', target: { implement: rest.id, grip: work } },
    { site: `grip_${up}`, kind: 'grip', target: { implement: upRest.id, grip: up } },
  ]
  const footX = segPosOf(skel, f, `foot_${work}`)[0]
  const matSpec = floorMat()
  // the mat runs along the body (X)
  const mat: ImplementPose = { id: matSpec.id, pos: [(footX + 0.15 + sh[0] - 0.25) / 2, 0, 0.12], rot: qaxis([0, 1, 0], Math.PI / 2) }
  const setup: Setup = { implements: [matSpec, rest, upRest], contacts, tempo, symmetric: false, tolerances: { body: { 'thigh_l / thigh_r': STACKED_THIGHS } } }
  return { kind: 'plank', side: true, tempo, setup, work, angle0: r.x[1], upAbd: r.x[2], legReach: legReach(skel, f), shoulder: sh, feet, fists, rest, reach, mat, guess: [q[skel.dof['pelvis.tx']], q[skel.dof['pelvis.ty']]] }
}

function sideFrame(skel: Skeleton, v: Plank, c: number, dip: number): Float64Array {
  const q = zeroQ(skel)
  sideBody(skel, q, c, v.angle0, v.work, dip)
  setDofs(skel, q, { 'hip_*.abd': v.upAbd! })
  const at = (f: FK) => segPosOf(skel, f, `humerus_${v.work}`)
  holdReach(skel, q, at, v, ['pelvis.tx', 'pelvis.ty'], 0, { dof: 'pelvis.list', base: q[skel.dof['pelvis.list']] })
  legsToward(skel, q, v.feet, [0, 0, 1])
  return q
}

const hipY = (skel: Skeleton, q: Float64Array) => {
  const f = fk(skel, q)
  return (segPosOf(skel, f, 'femur_l')[1] + segPosOf(skel, f, 'femur_r')[1]) / 2
}

/** hip dip: the spine bend that lowers the hip joints `drop` m below the braced side plank */
export function dipFor(skel: Skeleton, v: Plank, drop: number): number {
  const top = hipY(skel, sideFrame(skel, v, 1, 0))
  return root1d((d) => top - hipY(skel, sideFrame(skel, v, 1, d)) - drop, 0, 40, { tol: 1e-5 }).x
}

function sampleSide(skel: Skeleton, v: Plank, c: number): Pose {
  if (v.dip) {
    const q = sideFrame(skel, v, c, v.dip * (1 - c))
    const pos = sideArms(skel, q, v)
    return { q, implements: [v.mat, { id: v.rest!.id, pos: [0, 0, 0], rot: qid() }, { id: 'reach', pos, rot: qid() }], contacts: v.setup.contacts }
  }
  const q = zeroQ(skel)
  sideBody(skel, q, c, v.angle0, v.work)
  setDofs(skel, q, { 'hip_*.abd': v.upAbd! })
  const at = (f: FK) => segPosOf(skel, f, `humerus_${v.work}`)
  holdReach(skel, q, at, v, ['pelvis.tx', 'pelvis.ty'], 0, { dof: 'pelvis.list', base: q[skel.dof['pelvis.list']] })
  legsToward(skel, q, v.feet, [0, 0, 1])
  const pos = sideArms(skel, q, v)
  return { q, implements: [v.mat, { id: v.rest!.id, pos: [0, 0, 0], rot: qid() }, { id: 'reach', pos, rot: qid() }], contacts: v.setup.contacts }
}
