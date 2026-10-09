import { handFrame } from '../../constraints.ts'
import { fk, type FK } from '../../fk.ts'
import { siteWorld, type Cable, type ImplementSpec } from '../../implements.ts'
import { pushdownV } from '../../implements/arms.ts'
import { add, cross, dot, lerp, norm, qid, qrot, RAD, scale, sub, type V3 } from '../../math.ts'
import { setDofs, zeroQ, type ImplementPose, type Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { limitSway, makeStance, plantedContacts, stanceWidth, standBalanced, type StanceSetup, type Sway } from '../standing.ts'
import type { Setup } from '../types.ts'
import { frameY, mirrorArm, setArm, type Base, type P, type Sampled } from './common.ts'
import { CABLE_KG, cablePressure, HIGH } from './pushdown.ts'
import { stackSpec } from './rope.ts'

/**
 * V-bar pushdown (735): the pushdown body (pushdown.ts: slight knee bend, trunk leaning ~10 deg, the upper arms at the
 * sides a little ahead of vertical) on an angled V-bar (implements/arms.ts pushdownV), whose handles slope down and
 * out from a hub, so the hands sit close together, thumbs on top, palms angled in (cue 1). The elbows run from ~110
 * deg (the bar at chest height, cue 4) to lockout. Each frame humeral rotation, forearm turn and wrist deviation are
 * solved (Newton, 3 x 3) so the grips land on the handles with each hand along its handle; the V hangs from the
 * cable with its grips' midpoint between the hands.
 */
const VB = {
  knee: 10,
  tilt: 6,
  lumbar: 2,
  thorax: 2,
  forward: 24,
  drift: 3,
  elbow: [10, 100] as const,
  pulleyZ: 0.7,
  /** upper arms drawn in a little against the ribs, deg; start of the solve: humeral rotation (the forearms angle in to the close hands), forearm turn, deviation, deg */
  abd: -4,
  start: { rot: 45, pro: 45, dev: 0 },
  tol: 0.05,
}

export type VBar = Base & {
  kind: 'vbar'
  stance: StanceSetup
  pulley: V3
  bar: ImplementSpec
  sway?: Sway
  target: number
}

type Hold = { rot: number; pro: number; dev: number }

function base(skel: Skeleton) {
  const q = zeroQ(skel)
  setDofs(skel, q, { 'lumbar.flex': VB.lumbar, 'thorax.flex': VB.thorax, 'neck.flex': -7, 'head.flex': -2, 'clavicle_*.prot': -3 })
  return q
}

/** the V hanging towards the pulley (X across) with its grips' midpoint on `center` */
function hang(v: Pick<VBar, 'bar' | 'pulley'>, center: V3): ImplementPose {
  const rot = frameY(norm(sub(v.pulley, center)))
  const mid = scale(add(v.bar.sites.l.pos, v.bar.sites.r.pos), 0.5)
  return { id: v.bar.id, pos: sub(center, qrot(rot, mid)), rot }
}

/** both arms at elbow e: humeral rotation, turn and deviation solved so the left hand lies along the left handle */
function hold(skel: Skeleton, q: Float64Array, v: Pick<VBar, 'bar' | 'pulley'>, c: number): ImplementPose {
  const keep = Float64Array.from(q)
  const flex = VB.forward + VB.drift * (1 - c) * (1 - c)
  const e = lerp(VB.elbow[1], VB.elbow[0], c)
  const apply = (a: Hold) => {
    q.set(keep)
    setArm(skel, q, { flex, abd: VB.abd, rot: a.rot, elbow: e, pro: a.pro, wrist: 0, dev: a.dev })
    const h = handFrame(skel, fk(skel, q), 'l')
    const pose = hang(v, [0, h.pos[1], h.pos[2]])
    const site = siteWorld(v.bar, pose, 'l')
    const t = site.axis!
    const e1 = norm(cross(t, [0, 0, 1])), e2 = cross(t, e1)
    const w = RAD / (1 + dot(h.axis, t))
    return { pose, r: [(h.pos[0] - site.pos[0]) * 1000, dot(h.axis, e1) * w, dot(h.axis, e2) * w] }
  }
  let a: Hold = { ...VB.start }
  const keys = ['rot', 'pro', 'dev'] as const
  let cur = apply(a)
  for (let it = 0; it < 40 && Math.max(...cur.r.map(Math.abs)) > 0.01; it++) {
    const J = keys.map((k) => apply({ ...a, [k]: a[k] + 0.1 }).r.map((x, i) => (x - cur.r[i]) / 0.1))
    const m = [0, 1, 2].map((i) => J.map((col) => col[i]))
    const det3 = (x: number[][]) => x[0][0] * (x[1][1] * x[2][2] - x[1][2] * x[2][1]) - x[0][1] * (x[1][0] * x[2][2] - x[1][2] * x[2][0]) + x[0][2] * (x[1][0] * x[2][1] - x[1][1] * x[2][0])
    const d = det3(m)
    const dx = [0, 1, 2].map((k) => det3(m.map((row, i) => row.map((x, j) => (j === k ? -cur.r[i] : x)))) / d)
    const s = Math.min(1, 5 / Math.max(...dx.map(Math.abs)))
    a = { ...a }
    keys.forEach((k, n) => (a[k] += dx[n] * s))
    cur = apply(a)
  }
  mirrorArm(skel, q)
  return cur.pose
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
