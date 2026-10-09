import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { handFrame, root1d } from '../../constraints.ts'
import { fk, type FK } from '../../fk.ts'
import { cableHandle, type Cable, type ImplementSpec } from '../../implements.ts'
import { lerp, norm, qfromBasis, qid, qrot, sub, type V3 } from '../../math.ts'
import { setDofs, setScapula, zeroQ, type ImplementPose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { footContacts, splitStance, standSplit, type SplitStance } from '../isolation.ts'
import { ARM_BALANCE_TOL, setPelvis } from '../standing.ts'
import type { Setup } from '../types.ts'
import { armDir, mirrorArm, setOverheadShoulder, type Base, type P, type Sampled } from './common.ts'
import { trunkAngle } from './overhead.ts'
import { cablePressure } from './pushdown.ts'
import { stackSpec } from './rope.ts'

/**
 * Single-arm overhead cable extension (737). Facing away from a low pulley, staggered stance (the working side's
 * foot back), trunk leaning a little forward (torsoAngle). One D-handle: the working upper arm holds still beside
 * the head at shoulderFlexion (research overhead ~170), the elbow pointing forward, and the cable draws the hand down
 * behind the head (elbow ~125-135, stopped `clear` m off the head) before the elbow straightens to lockout. The free
 * arm hangs relaxed. The hips hold the centre of pressure of body and cable pull over the stance (the pull runs down
 * and back, so the lifter leans into it a little).
 */
const ONE = {
  step: 0.4,
  frontKnee: 34,
  lumbar: 2,
  thorax: 3,
  neck: -6,
  head: -2,
  /** humerus past the record's flexion and drawn in towards the head, deg */
  lift: 0,
  inward: 12,
  /** the elbow's bend plane turned in, deg: the hand comes down behind the head towards its middle, not beside it */
  roll: 20,
  lock: 5,
  maxElbow: 138,
  /** neutral grip: forearm turn; wrist extension at lockout and at the stretch, deg */
  pro: 10,
  ext: [10, 20] as const,
  /** low pulley: height, behind the rear heel, m */
  pulley: { y: 0.1, back: 0.55 },
  kg: 5,
  clear: 0.015,
  free: { plane: 70, elev: 8, rot: 0, elbow: 14, pro: 20, close: 0.3 },
}

type S = 'l' | 'r'

export type OverheadSingle = Base & {
  kind: 'overhead-single'
  work: S
  free: S
  stance: SplitStance
  tilt: number
  u: V3
  pulley: V3
  handle: ImplementSpec
  elbow: readonly [number, number]
}

function spine(skel: Skeleton, q: Float64Array) {
  setDofs(skel, q, { 'lumbar.flex': ONE.lumbar, 'thorax.flex': ONE.thorax, 'neck.flex': ONE.neck, 'head.flex': ONE.head, 'clavicle_*.elev': 4, 'grip_*.close': 1 })
}

function arms(skel: Skeleton, q: Float64Array, v: Pick<OverheadSingle, 'work' | 'free' | 'u'>, e: number, c: number) {
  setOverheadShoulder(skel, q, v.u, ONE.roll)
  setDofs(skel, q, { 'elbow_l.flex': e, 'forearm_l.pro': ONE.pro, 'wrist_l.flex': -lerp(ONE.ext[1], ONE.ext[0], c), 'wrist_l.dev': 0 })
  if (v.work === 'r') mirrorArm(skel, q)
  const f = ONE.free, s = v.free
  setDofs(skel, q, { [`shoulder_${s}.plane`]: f.plane, [`shoulder_${s}.elev`]: f.elev, [`shoulder_${s}.rot`]: f.rot, [`elbow_${s}.flex`]: f.elbow, [`forearm_${s}.pro`]: f.pro, [`wrist_${s}.flex`]: 0, [`wrist_${s}.dev`]: 0, [`grip_${s}.close`]: f.close })
  setScapula(skel, q, s)
}

function handlePose(skel: Skeleton, f: FK, v: Pick<OverheadSingle, 'work' | 'pulley' | 'handle'>): ImplementPose {
  const h = handFrame(skel, f, v.work)
  const rot = qfromBasis(h.axis, norm(sub(v.pulley, h.pos)))
  return { id: v.handle.id, pos: sub(h.pos, qrot(rot, v.handle.sites.c.pos)), rot }
}

function place(skel: Skeleton, v: OverheadSingle, e: number, c: number) {
  const q = zeroQ(skel)
  spine(skel, q)
  // the hips hold still over the stance; leaning against the cable, the rear foot braces (as the rope version)
  standSplit(skel, q, v.stance, { frontKnee: ONE.frontKnee, tilt: v.tilt }, (qq) => arms(skel, qq, v, e, c))
  return { q }
}

export function overheadSingleContext(p: P, skel: Skeleton, tempo: Tempo): OverheadSingle {
  const work: S = p.side === 'left' ? 'l' : 'r'
  const free: S = work === 'l' ? 'r' : 'l'
  const tilt = root1d((t) => {
    const q = zeroQ(skel)
    spine(skel, q)
    setPelvis(skel, q, [0, 1, 0], t)
    return trunkAngle(skel, q) - p.torsoAngle
  }, -20, 60, { tol: 1e-6 }).x
  const stance = splitStance(skel, free, ONE.step)
  const rear = stance.feet.find((ft) => ft.side === work)!
  const sgn = work === 'l' ? 1 : -1
  const pulley: V3 = [sgn * skel.data.shoulderWidth / 2, ONE.pulley.y, rear.ankle[2] - 0.05 - ONE.pulley.back]
  const handle = cableHandle({ id: 'handle', attachment: 'single_handle' })
  const stack = stackSpec(pulley, true)
  stack.parts = [
    { shape: 'cylinder', a: [pulley[0], 0, pulley[2] - 0.12], b: [pulley[0], 2.1, pulley[2] - 0.12], r: 0.05 },
    { shape: 'cylinder', a: pulley, b: [pulley[0], pulley[1], pulley[2] - 0.12], r: 0.04 },
  ]
  const cables: Cable[] = [{ pulley, implement: 'handle', point: [0, 0, 0], kg: ONE.kg }]
  const setup: Setup = {
    implements: [handle, stack],
    contacts: [...footContacts(skel, stance.feet), { site: `grip_${work}`, kind: 'grip', target: { implement: 'handle', grip: 'c' } }],
    tempo,
    symmetric: false,
    cables,
    balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL },
  }
  const v: OverheadSingle = { kind: 'overhead-single', tempo, setup, work, free, stance, tilt, u: armDir(p.shoulderFlexion + ONE.lift, -ONE.inward), pulley, handle, elbow: [ONE.lock, ONE.maxElbow] }
  // the deepest stretch the head, neck and upper back allow (forearm, fist and handle `clear` off them)
  const gap = (e: number) => {
    const { q } = place(skel, v, e, 0)
    const f = fk(skel, q)
    const caps = bodyCapsules(skel, f)
    const arm = caps.filter((k) => k.region === `hand_${work}` || k.region === `forearm_${work}`)
    const body = caps.filter((k) => k.region === 'head' || k.region === 'neck' || k.region === 'trunk')
    const solids = placeParts(handle, handlePose(skel, f, v))
    return Math.min(...arm.flatMap((a) => body.map((b) => capsuleClearance(a, b))), ...solids.flatMap((sd) => body.map((b) => capsuleSolidClearance(b, sd)))) - ONE.clear
  }
  if (gap(ONE.maxElbow) < 0) v.elbow = [ONE.lock, root1d(gap, 90, ONE.maxElbow, { tol: 1e-4 }).x]
  // the centre of pressure sits behind the stagger's midpoint: the balance band is centred where it sits over the rep
  const cops = Array.from({ length: 9 }, (_, i) => {
    const c = i / 8
    const f = fk(skel, place(skel, v, lerp(v.elbow[1], v.elbow[0], c), c).q)
    return cablePressure(skel, f, handlePose(skel, f, v).pos, v.pulley, v.handle.mass, ONE.kg)
  })
  setup.balance!.target = Math.round(((Math.max(...cops) + Math.min(...cops)) / 2) * 1000) / 1000
  return v
}

export function sampleOverheadSingle(u: number, _p: P, skel: Skeleton, v: OverheadSingle): Sampled {
  const c = phaseAt(u, v.tempo).c
  const { q } = place(skel, v, lerp(v.elbow[1], v.elbow[0], c), c)
  return { q, implements: [handlePose(skel, fk(skel, q), v), { id: 'stack', pos: [0, 0, 0], rot: qid() }] }
}
