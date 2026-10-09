import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts, segmentDistance, type Capsule } from '../../collide.ts'
import { handFrame, plantFoot, root1d, type FootTarget } from '../../constraints.ts'
import { dls } from '../../ik.ts'
import { centerOfMass, fk } from '../../fk.ts'
import { BAND, band, bandGrip, bandNode, bandPose, poseHandle, type BandPoint } from '../../implements/index.ts'
import type { ImplementSpec } from '../../implements.ts'
import { add, len, lerp, norm, qrot, scale, sub, type V3 } from '../../math.ts'
import type { ImplementPose, Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { ARM_BALANCE_TOL } from '../standing.ts'
import type { Setup } from '../types.ts'
import { armDir, footContacts, type Base, type P, type Sampled } from './common.ts'
import { body, OVER, trunkAngle, trunkBase } from './overhead.ts'

// Band overhead triceps extension (742): the overhead cable extension's stagger, trunk and arms (upper arms up beside
// the head, elbows pointing forward, only the elbows moving), a loop band under the rear foot's arch held in both
// fists behind the head. The band's pull runs from the foot to the hands, inside the body, so the balance is the
// centre of mass alone; the pelvis holds still and the gate's band sits round where it falls over the rep.
// Each strand leaves the sole behind the heel, so it runs up clear of the calf and buttock; a node on the back sits on
// the straight run while it clears the body and pushes out just far enough to wrap the upper back when it would not
// (the far strand at lockout).

const BAND_OVER = {
  /** fists and band keep this far off the head, neck and upper back at the stretch, m */
  clear: 0.02,
  /** the strip under the rear foot: points this far either side of the ball, just above the floor, m */
  under: { x: 0.03, y: 0.003 },
  /** behind the heel: past the heel's back by this much, at this height, m */
  heel: { back: 0.03, y: 0.003 },
  /** the strands keep this far off the body where they wrap it, m */
  wrap: 0.008,
}

/** the body regions the back node wraps */
const BACK = /^(trunk|neck|head)$/

const runClear = (a: V3, b: V3, caps: readonly Capsule[]) => Math.min(...caps.map((k) => segmentDistance(a, b, k.a, k.b).d - k.r)) - BAND.thick / 2

/**
 * a node on the run a-b: on it where the run clears these capsules by the wrap margin, else at the deepest point
 * pushed out from the capsule's axis just far enough that both halves clear
 */
function wrapNode(a: V3, b: V3, caps: readonly Capsule[]): V3 {
  let worst = Infinity, at: V3 = scale(add(a, b), 0.5), out: V3 = [0, 0, -1]
  for (const k of caps) {
    const { d, s, t } = segmentDistance(a, b, k.a, k.b)
    if (d - k.r >= worst) continue
    worst = d - k.r
    at = add(a, scale(sub(b, a), s))
    const off = sub(at, add(k.a, scale(sub(k.b, k.a), t)))
    out = len(off) > 1e-4 ? norm(off) : [0, 0, -1]
  }
  const gap = (h: number) => {
    const p = add(at, scale(out, h))
    return Math.min(runClear(a, p, caps), runClear(p, b, caps)) - BAND_OVER.wrap
  }
  if (gap(0) >= 0) return at
  if (gap(0.3) < 0) return add(at, scale(out, 0.3))
  return add(at, scale(out, root1d(gap, 0, 0.3, { tol: 1e-5 }).x))
}

export type BandOverhead = Base & {
  kind: 'band-overhead'
  feet: FootTarget[]
  tilt: number
  u: V3
  hip: V3
  elbow: readonly [number, number]
  fists: Record<'l' | 'r', ImplementSpec>
  /** under the rear foot, world (the floor node sits at the origin) */
  foot: V3
  /** behind the rear heel, world, for the right and left fists' strands */
  heels: Record<'l' | 'r', V3>
  /** each fist's site the strand leaves from */
  lows: Record<'l' | 'r', string>
}

const elbowAt = (v: Pick<BandOverhead, 'elbow'>, c: number) => lerp(v.elbow[1], v.elbow[0], c)

/** fists on the hands, the band leaving them towards the rear foot */
function fistPoses(skel: Skeleton, q: Float64Array, v: Pick<BandOverhead, 'fists' | 'foot'>): ImplementPose[] {
  const f = fk(skel, q)
  return (['l', 'r'] as const).map((s) => {
    const h = handFrame(skel, f, s)
    return poseHandle(v.fists[s], 'c', h.pos, h.axis, v.foot)
  })
}

export function bandOverheadContext(p: P, skel: Skeleton, tempo: Tempo): BandOverhead {
  const half = (skel.data.hipWidth + 0.03) / 2
  // left foot forward, the band under the right (rear) foot
  const feet = [plantFoot(skel, 'l', [half, 0, OVER.step / 2], 8), plantFoot(skel, 'r', [-half, 0, -OVER.step / 2], 14)]
  const tilt = root1d((t) => trunkAngle(skel, trunkBase(skel, t)) - p.torsoAngle, -10, 60, { tol: 1e-6 }).x
  const u = armDir(p.shoulderFlexion + OVER.lift, -OVER.inward)
  const rear = feet[1]
  // under the arch, so the strands run up behind the buttocks rather than through them
  const ball = add(rear.ankle, qrot(rear.rot, skel.data.sites.midfoot_r.local))
  const { x, y } = BAND_OVER.under
  const foot: V3 = [ball[0], y, ball[2]]
  const fists = { l: bandGrip({ id: 'fist_l' }), r: bandGrip({ id: 'fist_r' }) }
  const heels = { r: [foot[0] - x, 0, 0] as V3, l: [foot[0] + x, 0, 0] as V3 }
  const v: BandOverhead = { kind: 'band-overhead', tempo, setup: undefined as unknown as Setup, feet, tilt, u, hip: [0, 0.9, 0], elbow: [OVER.lock, OVER.maxElbow], fists, foot, heels, lows: { l: 'a', r: 'a' } }
  const knees = (hip: V3) => {
    const q = body(skel, v, hip, OVER.lock, 1)
    return [q[skel.dof['knee_l.flex']] - OVER.frontKnee, q[skel.dof['knee_r.flex']] - OVER.rearKnee]
  }
  const hs = dls((xx) => knees([0, xx[0], xx[1]]), [0.9, 0], { tol: 1e-8, iters: 60 })
  v.hip = [0, hs.x[0], hs.x[1]]
  // the deepest stretch the head, neck and upper back allow
  const gap = (e: number) => {
    const q = body(skel, v, v.hip, e, 0)
    const caps = bodyCapsules(skel, fk(skel, q))
    const arms = caps.filter((k) => /^(hand|forearm)_/.test(k.region))
    const trunk = caps.filter((k) => k.region === 'head' || k.region === 'neck' || k.region === 'trunk')
    const poses = fistPoses(skel, q, v)
    const solids = [fists.l, fists.r].flatMap((s, k) => placeParts(s, poses[k]))
    return Math.min(...arms.flatMap((a) => trunk.map((t) => capsuleClearance(t, a))), ...solids.flatMap((sd) => trunk.map((t) => capsuleSolidClearance(t, sd)))) - BAND_OVER.clear
  }
  if (gap(OVER.maxElbow) < 0) v.elbow = [OVER.lock, root1d(gap, 90, OVER.maxElbow, { tol: 1e-4 }).x]
  // the heel's back: the rear foot capsule's far end
  const heel = bodyCapsules(skel, fk(skel, body(skel, v, v.hip, OVER.lock, 1))).find((k) => k.name === 'rearfoot_r')!
  const back = heel.a[2] < heel.b[2] ? heel.a : heel.b
  for (const s of ['l', 'r'] as const) v.heels[s] = [v.heels[s][0], BAND_OVER.heel.y, back[2] - heel.r - BAND_OVER.heel.back]
  // the strip: up from under the rear foot to the little-finger side of one fist, across both, and back down
  const q0 = body(skel, v, v.hip, elbowAt(v, 0), 0)
  const down = (s: 'l' | 'r') => {
    const pose = fistPoses(skel, q0, v)[s === 'l' ? 0 : 1]
    const a = add(pose.pos, qrot(pose.rot, fists[s].sites.a.pos)), b = add(pose.pos, qrot(pose.rot, fists[s].sites.b.pos))
    return a[1] < b[1] ? ['a', 'b'] : ['b', 'a']
  }
  const [rLow, rHigh] = down('r'), [lLow, lHigh] = down('l')
  const floor = (dx: number): BandPoint => ({ implement: 'floor', at: [foot[0] + dx, foot[1], foot[2]], face: [0, 1, 0] })
  const heelPoint = (s: 'l' | 'r'): BandPoint => ({ implement: 'floor', at: v.heels[s], face: [0, 1, 0] })
  const strip = band({
    path: [
      floor(-x), heelPoint('r'), { implement: 'back_r' },
      { implement: 'fist_r', site: rLow }, { implement: 'fist_r', site: rHigh }, { implement: 'fist_l', site: lHigh }, { implement: 'fist_l', site: lLow },
      { implement: 'back_l' }, heelPoint('l'), floor(x),
    ],
    closed: true,
  })
  v.lows = { r: rLow, l: lLow }
  const contacts = [
    ...footContacts(skel, feet),
    { site: 'grip_l', kind: 'grip' as const, target: { implement: 'fist_l', grip: 'c' } },
    { site: 'grip_r', kind: 'grip' as const, target: { implement: 'fist_r', grip: 'c' } },
  ]
  const coms = Array.from({ length: 9 }, (_, i) => centerOfMass(skel, fk(skel, body(skel, v, v.hip, elbowAt(v, i / 8), i / 8)))[2])
  const target = Math.round(((Math.max(...coms) + Math.min(...coms)) / 2) * 1000) / 1000
  v.setup = {
    implements: [fists.l, fists.r, bandNode('floor'), bandNode('back_r'), bandNode('back_l'), strip],
    contacts,
    tempo,
    symmetric: false,
    balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL, target },
  }
  return v
}

export function sampleBandOverhead(u: number, _p: P, skel: Skeleton, v: BandOverhead): Sampled {
  const c = phaseAt(u, v.tempo).c
  const q = body(skel, v, v.hip, elbowAt(v, c), c)
  const fists = fistPoses(skel, q, v)
  const trunk = bodyCapsules(skel, fk(skel, q)).filter((c) => BACK.test(c.region))
  const nodes = (['r', 'l'] as const).map((s): ImplementPose => {
    const pose = fists[s === 'l' ? 0 : 1]
    const top = add(pose.pos, qrot(pose.rot, v.fists[s].sites[v.lows[s]].pos))
    return { id: `back_${s}`, pos: wrapNode(v.heels[s], top, trunk), rot: [0, 0, 0, 1] }
  })
  return { q, implements: [...fists, { id: 'floor', pos: [0, 0, 0], rot: [0, 0, 0, 1] }, ...nodes, bandPose()] }
}
