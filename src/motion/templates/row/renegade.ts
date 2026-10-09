import { handFrame, implementFromHand, root1d } from '../../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { fk, segPos, sitePos } from '../../fk.ts'
import { dumbbell, type ImplementSpec } from '../../implements.ts'
import { add, DEG, norm, qrot, scale, sub, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Skeleton } from '../../skeleton.ts'
import type { Tempo } from '../../timing.ts'
import { flatToes, FOOT_SINK, HIGH } from '../core/hand-plank.ts'
import type { Setup } from '../types.ts'
import { lerp, other, phases, PROT, reach, working, type P, type Side } from './common.ts'

// Renegade row (340, alternating: one working-side rep per loop, as the other alternating records): a high plank on two
// dumbbells resting on the floor, hands round their handles (neutral, the handles front to back) under the shoulders
// with the arms straight, the body in one line from the head to the heels on the balls of the feet, feet spread wide
// for a broad base. The working scapula sets back, then the elbow drives up along the body until the upper arm passes
// the back and the dumbbell comes up beside the lower ribs, the forearm hanging under the elbow (elbow ~0 -> ~95 deg, the
// one-arm row's finish). The support arm stays straight and pushes into its dumbbell; the hips stay level and square
// (no trunk rotation), so the work reads as the row, not a twist.

const DB_KG = 16
/** high plank: hip abduction for the wide stance, deg (the shoulder tap opens 12; this one wider still) */
const FEET_ABD = 18
/** arms nearly straight at the hang, deg */
const SUPPORT_ELBOW = 5
/** handles this far outside the shoulder joints, m: just wider than the shoulders so the plates clear the chest */
const HANDS_OUT = 0.03
/** upper arm raised past the trunk line at the finish, deg (the elbow above the back), and its least abduction from the
 * trunk (it opens as far as the plates need to clear the ribs, ~16) */
const TOP = { ext: 30, flare: 15 }
/** dumbbell (plates and hand) to the trunk and the thigh at the finish, m */
const BODY_GAP = 0.015

export type Renegade = {
  kind: 'renegade'
  tempo: Tempo
  setup: Setup
  work: Side
  tilt: number
  toe: number
  balls: [V3, V3]
  db: Record<Side, ImplementSpec>
  /** dumbbells resting on the floor: handle centres, world */
  rest: Record<Side, V3>
  /** working shoulder joint at the hang, world */
  sh0: V3
  /** working grip at the finish, world; elbow direction at the finish */
  top: V3
  topPole: V3
}

const lat = (s: Side) => (s === 'l' ? 1 : -1)

function body(skel: Skeleton, q: Float64Array, v: Pick<Renegade, 'work' | 'tilt' | 'toe' | 'balls'>, s: number) {
  setDofs(skel, q, {
    'lumbar.flex': HIGH.lumbar[1],
    'thorax.flex': 0,
    'neck.flex': HIGH.neck,
    'head.flex': 2,
    [`clavicle_${v.work}.prot`]: lerp(PROT.start, PROT.finish, s),
    // the support shoulder pushes the floor away (protracted), as the working one at the hang
    [`clavicle_${other(v.work)}.prot`]: PROT.start,
    'clavicle_*.elev': 3,
    'hip_*.flex': HIGH.hip,
    'hip_*.abd': FEET_ABD,
    'knee_*.flex': HIGH.knee,
    'ankle_*.df': HIGH.ankle,
    'toe_*.flex': v.toe,
    'grip_*.close': 1,
  })
  q[skel.dof['pelvis.tilt']] = v.tilt
  // rooted so the balls of the feet sit on their targets
  const f = fk(skel, q)
  const d = sub(scale(add(v.balls[0], v.balls[1]), 0.5), scale(add(sitePos(skel, f, 'ball_l'), sitePos(skel, f, 'ball_r')), 0.5))
  for (const [k, i] of [['pelvis.tx', 0], ['pelvis.ty', 1], ['pelvis.tz', 2]] as const) q[skel.dof[k]] += d[i]
}

/** neutral grip round a handle running front to back, palm in; the elbow back along the body */
function arm(skel: Skeleton, q: Float64Array, side: Side, pos: V3, pole: V3) {
  reach(skel, q, side, { pos, axis: [0, 0, 1], palm: [-lat(side), 0, 0] }, { pole, planeHint: 90 })
}

function supportPole(skel: Skeleton, q: Float64Array, side: Side): V3 {
  // the elbow points back towards the feet and a little out (thorax: +Y to the head, +Z out of the chest)
  return norm(qrot(fk(skel, q).rot[skel.seg.thorax2], [lat(side) * 0.3, -1, 0.2]))
}

function dbPose(skel: Skeleton, q: Float64Array, spec: ImplementSpec, side: Side): ImplementPose {
  const h = handFrame(skel, fk(skel, q), side)
  return { id: spec.id, pos: h.pos, rot: implementFromHand(h.axis, h.palm) }
}

const restPose = (spec: ImplementSpec, at: V3): ImplementPose => ({ id: spec.id, pos: at, rot: [0, Math.SQRT1_2, 0, Math.SQRT1_2] })

export function renegadeContext(p: P, skel: Skeleton, tempo: Tempo): Renegade {
  const work = working(p)
  const free = other(work)
  const db = { l: dumbbell({ id: 'db_l', mass: DB_KG }), r: dumbbell({ id: 'db_r', mass: DB_KG }) }
  const plateR = (db.l.parts[1] as { r: number }).r
  const v: Renegade = {
    kind: 'renegade', tempo, setup: undefined as never, work, tilt: 70, toe: 0, balls: [[0.2, 0, 0], [-0.2, 0, 0]], db,
    rest: { l: [0, 0, 0], r: [0, 0, 0] }, sh0: [0, 0, 0], top: [0, 0, 0], topPole: [0, 0, 0],
  }
  /** handle centres under the shoulders (just outside them), resting on the plates */
  const handles = (q: Float64Array): Record<Side, V3> => {
    const f = fk(skel, q)
    const at = (s: Side): V3 => {
      const sh = segPos(skel, f, `humerus_${s}`)
      return [sh[0] + lat(s) * HANDS_OUT, plateR, sh[2]]
    }
    return { l: at('l'), r: at('r') }
  }
  // the pelvis tilt that leaves the arms straight with the handles under the shoulders (the body a straight line pivoting
  // on the balls of the feet); the feet set where the wide plank puts them
  const q = zeroQ(skel)
  for (let pass = 0; pass < 3; pass++) {
    body(skel, q, v, 0)
    v.toe = flatToes(skel, q)
    v.tilt = root1d((t) => {
      v.tilt = t
      body(skel, q, v, 0)
      const h = handles(q)
      arm(skel, q, 'l', h.l, supportPole(skel, q, 'l'))
      return q[skel.dof['elbow_l.flex']] - SUPPORT_ELBOW
    }, 40, 89, { tol: 1e-7, scan: 9 }).x
    body(skel, q, v, 0)
    const f = fk(skel, q)
    v.balls = [sitePos(skel, f, 'ball_l'), sitePos(skel, f, 'ball_r')]
  }
  // the handles are fixed where the braced plank puts them (s = 0 for both arms)
  const q0 = zeroQ(skel)
  body(skel, q0, v, 0)
  v.rest = handles(q0)
  v.sh0 = segPos(skel, fk(skel, q0), `humerus_${work}`)
  // finish: the upper arm back along the trunk and past it by TOP.ext, out by the flare, the forearm hanging; the flare
  // opens only as far as the dumbbell needs to clear the trunk and thigh
  const q1 = zeroQ(skel)
  body(skel, q1, v, 1)
  const th = fk(skel, q1).rot[skel.seg.thorax2]
  const humAt = (flare: number) => {
    const e = TOP.ext * DEG, a = flare * DEG
    return norm(qrot(th, [lat(work) * Math.sin(a), -Math.cos(a) * Math.cos(e), -Math.cos(a) * Math.sin(e)]))
  }
  const gh = segPos(skel, fk(skel, q1), `humerus_${work}`)
  const lu = skel.segments[skel.seg[`humerus_${work}`]].length
  const toGrip = skel.segments[skel.seg[`forearm_${work}`]].length - skel.data.sites[`grip_${work}`].local[1]
  const gripAt = (hum: V3): V3 => add(add(gh, scale(hum, lu)), [0, -toGrip, 0])
  const clearAt = (flare: number) => {
    const qq = Float64Array.from(q1)
    v.topPole = humAt(flare)
    v.top = gripAt(v.topPole)
    arms(skel, qq, v, v.top)
    const caps = bodyCapsules(skel, fk(skel, qq)).filter((c) => c.region === 'trunk' || c.region.startsWith('thigh_'))
    const solids = placeParts(db[work], dbPose(skel, qq, db[work], work))
    return Math.min(...caps.flatMap((c) => solids.map((sd) => capsuleSolidClearance(c, sd)))) - BODY_GAP
  }
  const flare = clearAt(TOP.flare) >= 0 ? TOP.flare : root1d(clearAt, TOP.flare, 70, { tol: 1e-4 }).x
  v.topPole = humAt(flare)
  v.top = gripAt(v.topPole)
  const contacts: Contact[] = [
    ...(['l', 'r'] as const).map((s, i): Contact => ({ site: `ball_${s}`, kind: 'planted', target: { world: v.balls[i] } })),
    { site: `grip_${work}`, kind: 'grip', target: { implement: db[work].id, grip: 'c' } },
    { site: `grip_${free}`, kind: 'grip', target: { implement: db[free].id, grip: 'c' } },
  ]
  v.setup = {
    implements: [db.l, db.r],
    contacts,
    tempo,
    symmetric: false,
    // the turned-under toes on the floor: the forefoot capsule models straight toes (the push-up's FOOT_SINK)
    tolerances: { floor: FOOT_SINK },
  }
  return v
}

function arms(skel: Skeleton, q: Float64Array, v: Pick<Renegade, 'work' | 'rest' | 'topPole'>, target: V3) {
  const free = other(v.work)
  arm(skel, q, free, v.rest[free], supportPole(skel, q, free))
  // the working elbow blends from pointing back along the body to its finish direction
  const pole = norm(add(supportPole(skel, q, v.work), scale(v.topPole, 0.8)))
  arm(skel, q, v.work, target, pole)
}

export function sampleRenegade(u: number, _p: P, skel: Skeleton, v: Renegade): Pose {
  const ph = phases(u, v.tempo)
  const q = zeroQ(skel)
  body(skel, q, v, ph.s)
  // the dumbbell leaves the floor with the scapula's first travel (the hang follows the shoulder), then rises to the finish
  const hang = add(v.rest[v.work], sub(segPos(skel, fk(skel, q), `humerus_${v.work}`), v.sh0))
  const target: V3 = add(scale(hang, 1 - ph.g), scale(v.top, ph.g))
  arms(skel, q, v, target)
  const free = other(v.work)
  return { q, implements: [dbPose(skel, q, v.db[v.work], v.work), restPose(v.db[free], v.rest[free])], contacts: v.setup.contacts }
}
