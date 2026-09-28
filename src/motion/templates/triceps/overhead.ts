import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { plantFoot, root1d, solveLegs, type FootTarget } from '../../constraints.ts'
import { dls } from '../../ik.ts'
import { fk, segPos } from '../../fk.ts'
import type { Cable, ImplementSpec } from '../../implements.ts'
import { add, lerp, norm, qid, scale, sub, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { ARM_BALANCE_TOL, setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'
import { armDir, footContacts, mirrorArm, setOverheadShoulder, type Base, type P, type Sampled } from './common.ts'
import { cablePressure, HIGH } from './pushdown.ts'
import { ROPE_IDS, ropeContacts, ropeHandle, ropeImplements, ropePoses, stackSpec } from './rope.ts'

/**
 * Overhead cable extension facing away from the stack (705). Staggered stance, trunk leaning forward torsoAngle
 * (30), the rope from the high pulley behind. The upper arms stay put at shoulderFlexion against the trunk (research
 * overhead ~170), elbows pointing forward beside the head; the rope pulls the hands deep behind the head (elbow
 * ~135) and the elbows straighten until the arms point up and forward along the lean. The hips hold still: one
 * pelvis position keeps the centre of pressure of body, rope and cable pull over the stagger's midpoint.
 */
const OVER = {
  /** front (left) foot ahead of the rear one, m; front and rear knee flexion, deg */
  step: 0.7,
  frontKnee: 32,
  rearKnee: 14,
  lumbar: 4,
  thorax: 4,
  neck: -12,
  /** humerus against the thorax: past the record's flexion by `lift`, drawn in by `inward`, deg */
  lift: 0,
  inward: 10,
  lock: 5,
  maxElbow: 138,
  /** thumbs up the rope: pronation, wrist extension (lockout, stretch), deg */
  pro: 10,
  ext: [15, 25],
  /** the pulley stands this far behind the rear heel's line, m */
  pulleyBack: 0.55,
  /** hands, forearms and rope keep this far off the head, neck and upper back at the stretch, m */
  clear: 0.015,
  /** stack load, kg: the pull high behind the head tips the lifter back, so it stays light */
  kg: 6,
}

export type Overhead = Base & {
  kind: 'overhead'
  feet: FootTarget[]
  midfoot: number
  pulley: V3
  tilt: number
  u: V3
  hip: V3
  elbow: readonly [number, number]
}

function trunkBase(skel: Skeleton, tilt: number) {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': OVER.lumbar, 'thorax.flex': OVER.thorax, 'neck.flex': OVER.neck, 'head.flex': -4, 'clavicle_*.elev': 4, 'grip_*.close': 1 })
  setPelvis(skel, q, [0, 1, 0], tilt)
  return q
}

/** trunk lean from vertical (hip midpoint to shoulder midpoint), deg */
function trunkAngle(skel: Skeleton, q: Float64Array) {
  const f = fk(skel, q)
  const hips = scale(add(segPos(skel, f, 'femur_l'), segPos(skel, f, 'femur_r')), 0.5)
  const sh = scale(add(segPos(skel, f, 'humerus_l'), segPos(skel, f, 'humerus_r')), 0.5)
  const d = norm(sub(sh, hips))
  return (Math.acos(d[1]) * 180) / Math.PI
}

/** the body for a pelvis position: legs to the planted feet, trunk, both arms */
function body(skel: Skeleton, v: Pick<Overhead, 'feet' | 'tilt' | 'u'>, hip: V3, e: number, c: number) {
  const q = trunkBase(skel, v.tilt)
  setPelvis(skel, q, hip, v.tilt)
  solveLegs(skel, q, v.feet)
  setOverheadShoulder(skel, q, v.u, 0)
  setDofs(skel, q, { 'elbow_l.flex': e, 'forearm_l.pro': OVER.pro, 'wrist_l.flex': -lerp(OVER.ext[1], OVER.ext[0], c), 'wrist_l.dev': 0 })
  mirrorArm(skel, q)
  return q
}

function elbowAt(v: Pick<Overhead, 'elbow'>, c: number) {
  return lerp(v.elbow[1], v.elbow[0], c)
}

export function overheadContext(p: P, skel: Skeleton, tempo: Tempo): Overhead {
  const half = (skel.data.hipWidth + 0.03) / 2
  // left foot forward; the lifter faces +Z, away from the stack
  const feet = [plantFoot(skel, 'l', [half, 0, OVER.step / 2], 8), plantFoot(skel, 'r', [-half, 0, -OVER.step / 2], 14)]
  const tilt = root1d((t) => trunkAngle(skel, trunkBase(skel, t)) - p.torsoAngle, -10, 60, { tol: 1e-6 }).x
  const rearHeel = add(feet[1].ankle, [0, 0, -0.05])
  const pulley: V3 = [0, HIGH, rearHeel[2] - OVER.pulleyBack]
  const u = armDir(p.shoulderFlexion + OVER.lift, -OVER.inward)
  const contacts = [...footContacts(skel, feet), ...ropeContacts()]
  const cables: Cable[] = [{ pulley, implement: ROPE_IDS.handle, point: [0, 0, 0], kg: OVER.kg }]
  const implements_: ImplementSpec[] = [...ropeImplements(), stackSpec(pulley, true)]
  const setup: Setup = { implements: implements_, contacts, tempo, symmetric: false, cables, balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL } }
  const v: Overhead = { kind: 'overhead', tempo, setup, feet, midfoot: 0, pulley, tilt, u, hip: [0, 0.9, 0], elbow: [OVER.lock, OVER.maxElbow] }
  // pelvis still through the rep: height and forward position from the two knees
  const knees = (hip: V3) => {
    const q = body(skel, v, hip, OVER.lock, 1)
    return [q[skel.dof['knee_l.flex']] - OVER.frontKnee, q[skel.dof['knee_r.flex']] - OVER.rearKnee]
  }
  const hs = dls((x) => knees([0, x[0], x[1]]), [0.9, 0], { tol: 1e-8, iters: 60 })
  v.hip = [0, hs.x[0], hs.x[1]]
  // the deepest stretch the head, neck and upper back allow (arms, fists and rope `clear` off them)
  const rope = ropeImplements()
  const gap = (e: number) => {
    const q = body(skel, v, v.hip, e, 0)
    const f = fk(skel, q)
    const caps = bodyCapsules(skel, f)
    const arms = caps.filter((k) => /^(hand|forearm)_/.test(k.region))
    const trunk = caps.filter((k) => k.region === 'head' || k.region === 'neck' || k.region === 'trunk')
    const poses = ropePoses(skel, f, pulley)
    const solids = rope.flatMap((s, k) => placeParts(s, poses[k]))
    return Math.min(...arms.flatMap((a) => trunk.map((t) => capsuleClearance(t, a))), ...solids.flatMap((sd) => trunk.map((t) => capsuleSolidClearance(t, sd)))) - OVER.clear
  }
  if (gap(OVER.maxElbow) < 0) v.elbow = [OVER.lock, root1d(gap, 90, OVER.maxElbow, { tol: 1e-4 }).x]
  // leaning against the cable, the centre of pressure sits behind the stagger's midpoint (the rear foot braces):
  // the balance gate holds it within its band round where it sits over the rep
  const cops = Array.from({ length: 9 }, (_, i) => {
    const c = i / 8
    const f = fk(skel, body(skel, v, v.hip, elbowAt(v, c), c))
    return cablePressure(skel, f, ropeHandle(skel, f, pulley).pos, pulley, 0.6, OVER.kg)
  })
  setup.balance!.target = Math.round(((Math.max(...cops) + Math.min(...cops)) / 2) * 1000) / 1000
  return v
}

export function sampleOverhead(u: number, _p: P, skel: Skeleton, v: Overhead): Sampled {
  const c = phaseAt(u, v.tempo).c
  const q = body(skel, v, v.hip, elbowAt(v, c), c)
  return { q, implements: [...ropePoses(skel, fk(skel, q), v.pulley), { id: 'stack', pos: [0, 0, 0], rot: qid() }] }
}
