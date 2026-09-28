import { attachHand, root1d } from '../../constraints.ts'
import { centerOfPressure, fk, sitePos } from '../../fk.ts'
import { cableForce, comWorld, siteWorld, type Cable, type ImplementSpec } from '../../implements.ts'
import { twoHandHandle } from '../../implements/core.ts'
import { add, lerp, norm, qfromBasis, qid, qrot, reject, sub, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type Contact, type ImplementPose, type Pose, type Side, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import type { ParamsOf } from '../schemas.ts'
import { ARM_BALANCE_TOL, limitSway, makeStance, plantedContacts, standBalanced, stanceWidth, type StanceName, type StanceSetup, type Sway } from '../standing.ts'
import type { Setup } from '../types.ts'
import { stackSpec } from './cable.ts'

// Pallof press (808): standing side-on to a chest-high pulley on the working side, both fists stacked on a vertical
// handle in front of the sternum; the handle presses straight out to arm's length and comes back while hips and
// shoulders stay square to the front (anti-rotation: the trunk does not turn). The concentric is the press out, the
// top pause is the pause at arm's length. Author judgment (research: static trunk with an arm press).

type P = ParamsOf<'hold'>

/** handle centre in front of the sternum at the chest, m; elbow flexion at arm's length, deg */
const CHEST: V3 = [0, -0.05, 0.13]
const REACH_ELBOW = 10
/** pulley on the working side this far from the midline, m, level with the handle's path */
const PULLEY_OUT = 0.95
/** gap between the two fists along the handle, m */
const GAP = 0.1
const CABLE_KG = 10
const STANCE = { knee: 12, tilt: 4, toeOut: 8 }

export type Pallof = {
  kind: 'pallof'
  tempo: Tempo
  setup: Setup
  work: Side
  stance: StanceSetup
  handle: ImplementSpec
  cable: Cable
  /** handle centre at the chest and at arm's length, world */
  chest: V3
  reach: V3
  pulley: V3
  sway?: Sway
}

function trunk(skel: Skeleton, q: Float64Array) {
  setDofs(skel, q, { 'lumbar.flex': 2, 'thorax.flex': 1, 'neck.flex': -3, 'head.flex': 0, 'clavicle_*.prot': 4, 'clavicle_*.elev': 2, 'grip_*.close': 1 })
}

/** handle with its bar vertical (the upper fist on site l) and the rods towards the pulley */
function handlePose(v: Pick<Pallof, 'handle' | 'pulley'>, center: V3): ImplementPose {
  const toward = norm(reject(sub(v.pulley, center), [0, 1, 0]))
  const rot = qfromBasis([0, 1, 0], toward)
  const mid = qrot(rot, [0, v.handle.sites.l.pos[1], 0])
  return { id: v.handle.id, pos: sub(center, mid), rot }
}

function arms(skel: Skeleton, q: Float64Array, v: Pick<Pallof, 'handle' | 'pulley'>, pose: ImplementPose) {
  for (const s of ['l', 'r'] as const) {
    const g = siteWorld(v.handle, pose, s)
    const out = s === 'l' ? 1 : -1
    attachHand(skel, q, s, { pos: g.pos, axis: g.axis!, palm: [-out, 0, 0] }, { pole: [0.45 * out, -1, -0.25], planeHint: 60 })
  }
}

/** standing balanced (ankle lean from the centre of pressure, cable pull included) with the handle at c */
function frame(skel: Skeleton, v: Pallof, c: number, sway?: Sway) {
  const q = zeroQ(skel)
  trunk(skel, q)
  let pose = handlePose(v, v.chest)
  const measure = (qq: Float64Array) => {
    const { at, force } = cableForce(v.cable, pose)
    return centerOfPressure(skel, fk(skel, qq), [{ mass: v.handle.mass, pos: comWorld(v.handle, pose) }], [{ at, force }])[1]
  }
  const upper = (qq: Float64Array) => {
    pose = handlePose(v, [lerp(v.chest[0], v.reach[0], c), lerp(v.chest[1], v.reach[1], c), lerp(v.chest[2], v.reach[2], c)])
    arms(skel, qq, v, pose)
  }
  const bal = standBalanced(skel, q, v.stance, STANCE, measure, upper, undefined, sway)
  return { q, pose, ...bal }
}

export function pallofContext(p: P, skel: Skeleton, tempo: Tempo): Pallof {
  const work: Side = p.side === 'left' ? 'l' : 'r'
  const away = work === 'r' ? -1 : 1
  const stance = makeStance(skel, stanceWidth(skel, p.stance as StanceName), STANCE.toeOut)
  const q = zeroQ(skel)
  trunk(skel, q)
  standBalanced(skel, q, stance, STANCE, (qq) => centerOfPressure(skel, fk(skel, qq))[1])
  const chest = add(sitePos(skel, fk(skel, q), 'sternum'), CHEST)
  const handle = twoHandHandle({ gap: GAP })
  const pulley: V3 = [away * PULLEY_OUT, chest[1], chest[2] + 0.15]
  const cable: Cable = { pulley, implement: handle.id, point: [0, 0, 0], kg: CABLE_KG }
  const v: Pallof = { kind: 'pallof', tempo, setup: undefined as unknown as Setup, work, stance, handle, cable, chest, reach: chest, pulley }
  // arm's length: the handle straight out from the chest until the straighter arm's elbow is nearly straight (with
  // the body's balancing lean, which depends on the reach: two passes settle it)
  const reachFor = (sway?: Sway) => {
    const elbowAt = (d: number) => {
      v.reach = add(chest, [0, 0.02, d])
      const q1 = frame(skel, v, 1, sway).q
      return Math.min(q1[skel.dof['elbow_l.flex']], q1[skel.dof['elbow_r.flex']]) - REACH_ELBOW
    }
    v.reach = add(chest, [0, 0.02, root1d(elbowAt, 0.15, 0.55, { tol: 1e-5 }).x])
  }
  const contacts: Contact[] = [
    ...plantedContacts(skel, stance),
    { site: 'grip_l', kind: 'grip', target: { implement: handle.id, grip: 'l' } },
    { site: 'grip_r', kind: 'grip', target: { implement: handle.id, grip: 'r' } },
  ]
  v.setup = {
    implements: [handle, stackSpec(pulley, [away, 0, 0])],
    contacts,
    tempo,
    symmetric: false,
    cables: [cable],
    balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL },
  }
  reachFor()
  for (let k = 0; k < 2; k++) {
    v.sway = limitSway((u, sway) => frame(skel, v, phaseAt(u, tempo).c, sway))
    reachFor(v.sway)
  }
  return v
}

export function samplePallof(skel: Skeleton, v: Pallof, c: number): Pose {
  const { q, pose } = frame(skel, v, c, v.sway)
  return { q, implements: [pose, { id: 'stack', pos: [0, 0, 0], rot: qid() }], contacts: v.setup.contacts }
}
