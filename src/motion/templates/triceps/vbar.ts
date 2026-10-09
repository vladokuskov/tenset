import { handFrame } from '../../constraints.ts'
import { fk, type FK } from '../../fk.ts'
import { siteWorld, type Cable, type ImplementSpec } from '../../implements.ts'
import { pushdownV } from '../../implements/arms.ts'
import { dls } from '../../ik.ts'
import { add, cross, DEG, lerp, norm, qaxis, qid, qrot, scale, sub, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type ImplementPose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { limitSway, makeStance, plantedContacts, stanceWidth, standBalanced, type StanceSetup, type Sway } from '../standing.ts'
import type { Setup } from '../types.ts'
import { frameY, mirrorArm, setArm, type Base, type P, type Sampled } from './common.ts'
import { CABLE_KG, cablePressure, HIGH } from './pushdown.ts'
import { stackSpec } from './rope.ts'

/**
 * V-bar pushdown (735): the pushdown body (pushdown.ts: slight knee bend, trunk leaning ~10 deg, the upper arms at the
 * sides a little ahead of vertical) on an angled V-bar (implements/arms.ts pushdownV), whose handles slope ~40 deg
 * down and out from a hub, so the hands sit close together, thumbs on top, palms angled in (cue 1). The elbows run
 * from ~100 deg (the bar at chest height, cue 4) to lockout. The forearm turn is held near 45 deg; each frame humeral
 * rotation, the elbows' distance from the ribs, wrist deviation and the V's roll on its swivel are solved so the grips
 * land on the handles with each hand along its handle; the V hangs with its grips' midpoint between the hands.
 */
const VB = {
  knee: 10,
  tilt: 6,
  lumbar: 2,
  thorax: 2,
  forward: 24,
  drift: 3,
  elbow: [3, 100] as const,
  pulleyZ: 0.7,
  /** upper arms drawn in a little against the ribs (reference), deg; start of the solve: humeral rotation (the forearms angle in to the close hands), forearm turn (held), deviation, deg */
  abd: -4,
  start: { rot: 45, pro: 45, dev: 0 },
  /** solve weights: grip offset across (per m), handle alignment (cross product), then deg per unit of humeral rotation, abd, turn, deviation, the V's roll on its swivel */
  w: { x: 1000, axis: 20, rot: 10, abd: 3, pro: 6, dev: 8, roll: 15 },
  tol: 0.05,
  /** lead decision: at lockout the close hands bring the upper arms in against the ribs (the capsule flank is wider than the waist), mm */
  ribs: 30,
}

export type VBar = Base & {
  kind: 'vbar'
  stance: StanceSetup
  pulley: V3
  bar: ImplementSpec
  sway?: Sway
  target: number
}


function base(skel: Skeleton) {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': VB.lumbar, 'thorax.flex': VB.thorax, 'neck.flex': -7, 'head.flex': -2, 'clavicle_*.prot': -3 })
  return q
}

/** the V hanging towards the pulley (X across), turned `roll` deg about X on its swivel, its grips' midpoint on `center` */
function hang(v: Pick<VBar, 'bar' | 'pulley'>, center: V3, roll = 0): ImplementPose {
  const rot = frameY(qrot(qaxis([1, 0, 0], roll * DEG), norm(sub(v.pulley, center))))
  const mid = scale(add(v.bar.sites.l.pos, v.bar.sites.r.pos), 0.5)
  return { id: v.bar.id, pos: sub(center, qrot(rot, mid)), rot }
}

/**
 * both arms at elbow e: the forearm turn held near `pro` (thumbs up, palms angled in); humeral rotation, how far the
 * elbows sit out from the ribs and wrist deviation solved (damped least squares) so the left hand lies along the left
 * handle, the right mirrored
 */
function hold(skel: Skeleton, q: Float64Array, v: Pick<VBar, 'bar' | 'pulley'>, c: number): ImplementPose {
  const keep = Float64Array.from(q)
  const flex = VB.forward + VB.drift * (1 - c) * (1 - c)
  const e = lerp(VB.elbow[1], VB.elbow[0], c)
  const { start, w } = VB
  const apply = ([rot, abd, pro, dev, roll]: number[]) => {
    q.set(keep)
    setArm(skel, q, { flex, abd, rot, elbow: e, pro, wrist: 0, dev })
    const h = handFrame(skel, fk(skel, q), 'l')
    const pose = hang(v, [0, h.pos[1], h.pos[2]], roll)
    const site = siteWorld(v.bar, pose, 'l')
    const r = [(h.pos[0] - site.pos[0]) * w.x, ...scale(cross(h.axis, site.axis!), w.axis), (rot - start.rot) / w.rot, (abd - VB.abd) / w.abd, (pro - start.pro) / w.pro, dev / w.dev, roll / w.roll]
    return { pose, r }
  }
  const x0 = [start.rot, VB.abd, start.pro, start.dev, 0]
  const lim = ['shoulder_l.rot', null, 'forearm_l.pro', 'wrist_l.dev', null].map((n) => (n ? [skel.dofs[skel.dof[n]].min, skel.dofs[skel.dof[n]].max] : [-60, 60]))
  const { x } = dls((a) => apply(a).r, x0, { lo: lim.map((l) => l[0]), hi: lim.map((l) => l[1]), iters: 40, h: 1e-4 })
  const { pose } = apply(x)
  mirrorArm(skel, q)
  return pose
}

function frame(skel: Skeleton, q: Float64Array, v: VBar, c: number, sway = v.sway) {
  let pose: ImplementPose | undefined
  const measure = (qq: Float64Array) => {
    const f: FK = fk(skel, qq)
    return cablePressure(skel, f, pose!.pos, v.pulley, v.bar.mass) - v.target
  }
  const bal = standBalanced(skel, q, v.stance, { knee: VB.knee, tilt: VB.tilt }, measure, (qq) => (pose = hold(skel, qq, v, c)), undefined, sway)
  return { bal, pose: pose! }
}

export function vbarContext(p: P, skel: Skeleton, tempo: Tempo): VBar {
  void p
  const stance = makeStance(skel, stanceWidth(skel, 'hip'), 8)
  const pulley: V3 = [0, HIGH, stance.midfoot[2] + VB.pulleyZ]
  const bar = pushdownV()
  const cables: Cable[] = [{ pulley, implement: 'handle', point: [0, 0, 0], kg: CABLE_KG }]
  const setup: Setup = {
    implements: [bar, stackSpec(pulley, false)],
    contacts: [...plantedContacts(skel, stance), { site: 'grip_l', kind: 'grip', target: { implement: 'handle', grip: 'l' } }, { site: 'grip_r', kind: 'grip', target: { implement: 'handle', grip: 'r' } }],
    tempo,
    symmetric: true,
    cables,
    balance: { point: 'com', over: 'midfoot', tol: VB.tol },
    rests: [{ implement: 'handle', regions: ['thigh_l', 'thigh_r'], tol: -10 }],
    tolerances: { body: Object.fromEntries(['l', 'r'].flatMap((s) => [[`trunk / upperarm_${s}`, VB.ribs], [`trunk / upperarm_${s} (thorax2)`, VB.ribs]])) },
  }
  const v: VBar = { kind: 'vbar', tempo, setup, stance, pulley, bar, target: 0 }
  // the cable holds the hands up, so the centre of pressure swings with the forearms: centre the band on that swing
  // (as the pushdowns do) and let the ankles follow what is left
  const bal = (u: number, sway?: Sway) => frame(skel, base(skel), v, phaseAt(u, tempo).c, sway).bal
  const still = limitSway(bal, Infinity, 32).ref
  const offs = Array.from({ length: 32 }, (_, i) => bal(i / 32, { ref: still, follow: 0 }).offset)
  v.target = Math.round(((Math.max(...offs) + Math.min(...offs)) / 2) * 1000) / 1000
  setup.balance!.target = v.target
  v.sway = limitSway(bal, VB.tol - 0.004, 32)
  return v
}

export function sampleVbar(u: number, _p: P, skel: Skeleton, v: VBar): Sampled {
  const q = base(skel)
  const { pose } = frame(skel, q, v, phaseAt(u, v.tempo).c)
  return { q, implements: [pose, { id: 'stack', pos: [0, 0, 0], rot: qid() }] }
}
