import { bodyCapsules } from '../../collide.ts'
import { attachHand, handFrame, root1d } from '../../constraints.ts'
import { fk, segPos, type FK } from '../../fk.ts'
import { cableHandle, type Cable, type ImplementSpec } from '../../implements.ts'
import { add, lerp, norm, qfromBasis, qid, qrot, reject, scale, sub, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type ImplementPose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { footContacts, splitStance, standSplit, type SplitStance } from '../isolation.ts'
import { ARM_BALANCE_TOL, limitSway, setPelvis, type Sway } from '../standing.ts'
import type { Setup } from '../types.ts'
import { setArm, type Base, type P, type Sampled } from './common.ts'
import { trunkAngle } from './overhead.ts'
import { cablePressure } from './pushdown.ts'
import { stackSpec } from './rope.ts'

/**
 * Cable kickback (740), free standing. Staggered stance with the free side's foot forward, hinged forward to
 * torsoAngle (60) with the free hand braced on the front thigh above the knee. The working upper arm holds still
 * just past the trunk line (shoulderFlexion, -20: about level with the floor), tucked beside the ribs, and the
 * elbow straightens from ~95 deg (the forearm hanging, cue 4's right angle) until the arm points straight back
 * (research kickback: shoulder extended, elbow ~90-120 -> 0). One D-handle on a low pulley in front of the working
 * side, swivelling on its carabiner. The hips hold the centre of pressure of body and cable pull over the stance.
 */
const KICK = {
  step: 0.55,
  frontKnee: 30,
  lumbar: 4,
  thorax: 6,
  neck: -22,
  head: -8,
  /** working upper arm out from the ribs, deg; elbow at lockout and at the bottom, deg */
  abd: 8,
  lock: 5,
  bottom: 95,
  /** low pulley: height, ahead of the midfoot line and out to the working side, m */
  pulley: { y: 0.1, z: 0.75, x: 0.36 },
  kg: 6,
  /** free hand on the front thigh: this far from the hip towards the knee, above its surface, m */
  rest: { along: 0.82, above: 0.042 },
}

type S = 'l' | 'r'

export type CableKickback = Base & {
  kind: 'kickback-cable'
  work: S
  free: S
  stance: SplitStance
  tilt: number
  pulley: V3
  handle: ImplementSpec
  sway?: Sway
}

function spine(skel: Skeleton, q: Float64Array) {
  setDofs(skel, q, { 'lumbar.flex': KICK.lumbar, 'thorax.flex': KICK.thorax, 'neck.flex': KICK.neck, 'head.flex': KICK.head, 'grip_*.close': 1 })
}

function handlePose(skel: Skeleton, f: FK, v: Pick<CableKickback, 'work' | 'pulley' | 'handle'>): ImplementPose {
  const h = handFrame(skel, f, v.work)
  const rot = qfromBasis(h.axis, norm(sub(v.pulley, h.pos)))
  return { id: v.handle.id, pos: sub(h.pos, qrot(rot, v.handle.sites.c.pos)), rot }
}

function upper(skel: Skeleton, q: Float64Array, p: P, v: Pick<CableKickback, 'work' | 'free'>, e: number) {
  const keep = Float64Array.from(q)
  setArm(skel, q, { flex: p.shoulderFlexion, abd: KICK.abd, rot: 0, elbow: e, pro: 0, wrist: 0 })
  for (const [name, i] of Object.entries(skel.dof)) if (/^(scapula|shoulder|elbow|forearm|wrist|grip)_/.test(name) && name.includes(`_${v.free}.`)) q[i] = keep[i]
  // the free hand flat on top of the front thigh, just above the knee
  const f = fk(skel, q)
  const hip = segPos(skel, f, `femur_${v.free}`), knee = segPos(skel, f, `tibia_${v.free}`)
  const thigh = bodyCapsules(skel, f).filter((c) => c.region === `thigh_${v.free}`)
  const r = Math.max(...thigh.map((c) => c.r))
  const along = norm(sub(knee, hip))
  // the thigh's front-top face (the front thigh stands steep in the split stance)
  const face = norm(reject([0, 1, 1], along))
  const at = add(add(hip, scale(sub(knee, hip), KICK.rest.along)), scale(face, r + KICK.rest.above))
  const out = v.free === 'l' ? 1 : -1
  attachHand(skel, q, v.free, { pos: at, axis: [-out, 0, 0], palm: scale(face, -1) }, { pole: [out, 0, -0.3], planeHint: 60 })
  q[skel.dof[`grip_${v.free}.close`]] = 0.2
}

function place(skel: Skeleton, p: P, v: CableKickback, c: number, sway?: Sway) {
  const q = zeroQ(skel)
  spine(skel, q)
  const e = lerp(KICK.bottom, KICK.lock, c)
  const measure = (qq: Float64Array) => {
    const f = fk(skel, qq)
    return cablePressure(skel, f, handlePose(skel, f, v).pos, v.pulley, v.handle.mass, KICK.kg)
  }
  const bal = standSplit(skel, q, v.stance, { frontKnee: KICK.frontKnee, tilt: v.tilt }, (qq) => upper(skel, qq, p, v, e), measure, sway)
  return { q, bal }
}

export function cableKickbackContext(p: P, skel: Skeleton, tempo: Tempo): CableKickback {
  const work: S = p.side === 'left' ? 'l' : 'r'
  const free: S = work === 'l' ? 'r' : 'l'
  const tilt = root1d((t) => {
    const q = zeroQ(skel)
    spine(skel, q)
    setPelvis(skel, q, [0, 1, 0], t)
    return trunkAngle(skel, q) - p.torsoAngle
  }, 0, 90, { tol: 1e-6 }).x
  const stance = splitStance(skel, free, KICK.step)
  const sgn = work === 'l' ? 1 : -1
  const pulley: V3 = [sgn * KICK.pulley.x, KICK.pulley.y, stance.midfoot[2] + KICK.pulley.z]
  const handle = cableHandle({ id: 'handle', attachment: 'single_handle' })
  const cables: Cable[] = [{ pulley, implement: 'handle', point: [0, 0, 0], kg: KICK.kg }]
  const stack = stackSpec(pulley, false)
  stack.parts = stack.parts.map((part) => (part.shape === 'cylinder' ? { ...part, a: [pulley[0], part.a[1], part.a[2]], b: [pulley[0], part.b[1], part.b[2]] } : part))
  stack.parts[1] = { shape: 'cylinder', a: pulley, b: [pulley[0], pulley[1], pulley[2] + 0.12], r: 0.04 }
  const setup: Setup = {
    implements: [handle, stack],
    contacts: [...footContacts(skel, stance.feet), { site: `grip_${work}`, kind: 'grip', target: { implement: 'handle', grip: 'c' } }],
    tempo,
    symmetric: false,
    cables,
    balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL },
  }
  const v: CableKickback = { kind: 'kickback-cable', tempo, setup, work, free, stance, tilt, pulley, handle }
  v.sway = limitSway((u, sway) => place(skel, p, v, phaseAt(u, tempo).c, sway).bal)
  return v
}

export function sampleCableKickback(u: number, p: P, skel: Skeleton, v: CableKickback): Sampled {
  const { q } = place(skel, p, v, phaseAt(u, v.tempo).c, v.sway)
  return { q, implements: [handlePose(skel, fk(skel, q), v), { id: 'stack', pos: [0, 0, 0], rot: qid() }] }
}
