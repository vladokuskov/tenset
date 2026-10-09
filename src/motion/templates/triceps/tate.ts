import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts, solidClearance } from '../../collide.ts'
import { handFrame, implementFromHand, root1d } from '../../constraints.ts'
import { fk } from '../../fk.ts'
import { lerp } from '../../math.ts'
import type { ImplementPose, Skeleton } from '../../skeleton.ts'
import { phaseAt, type Tempo } from '../../timing.ts'
import { setArm, type Base, type P, type Sampled } from './common.ts'
import { lyingBase, lyingContext, type Lying } from './lying.ts'

// Tate press (744): the skull crusher's body on the flat bench with a dumbbell in each hand, palms facing the feet.
// The upper arms point up over the chest, a little out (elbowFlare), and turned in so the elbows point out to the
// sides: the elbows bend sideways and the forearms fold in towards each other until the dumbbells' inner heads touch
// the chest, then straighten. Only the elbows move.

const TATE = {
  /** humeral internal rotation, deg: the elbows' bend plane lies across the chest */
  rot: 80,
  /** forearm turn that puts the palms towards the feet once the humerus is turned in, deg */
  pro: -10,
  lock: 5,
  max: 135,
  /** the inner heads stop this far into the chest at the bottom, m (a touch, inside the 3 mm prop tolerance) */
  touch: -0.002,
  flare: 5,
  /** extra upper-arm abduction by the time the elbows reach `spread`, deg */
  flareBend: 45,
  spread: 90,
  /** the dumbbells and fists stop this far apart, m */
  apart: 0.01,
}

export type Tate = Base & { kind: 'tate'; lying: Lying; elbow: [number, number]; flare: number }

function arms(skel: Skeleton, q: Float64Array, p: P, v: Pick<Tate, 'flare' | 'elbow'>, elbow: number): ImplementPose[] {
  // the elbows flare further as they bend, so the fists meet over the sternum instead of crossing
  const t = Math.min(1, Math.max(0, (elbow - TATE.lock) / (TATE.spread - TATE.lock)))
  const k = t * t * (3 - 2 * t)
  setArm(skel, q, { flex: p.shoulderFlexion, abd: v.flare + TATE.flareBend * k, rot: TATE.rot, elbow, pro: TATE.pro, wrist: 0 })
  const f = fk(skel, q)
  return (['l', 'r'] as const).map((s) => {
    const h = handFrame(skel, f, s)
    return { id: `db_${s}`, pos: h.pos, rot: implementFromHand(h.axis, h.palm) }
  })
}

export function tateContext(p: P, skel: Skeleton, tempo: Tempo): Tate {
  const lying = lyingContext(p, skel, tempo)
  const v: Tate = { kind: 'tate', tempo, setup: lying.setup, lying, elbow: [TATE.lock, TATE.max], flare: p.elbowFlare ?? TATE.flare }
  const dbs = lying.dbs!
  // the bottom: the inner heads touch the chest, or the dumbbells or the fists come within TATE.apart of each other
  const gap = (e: number) => {
    const q = lyingBase(skel, lying)
    const poses = arms(skel, q, p, v, e)
    const caps = bodyCapsules(skel, fk(skel, q))
    const trunk = caps.filter((k) => k.region === 'trunk' || k.region === 'head' || k.region === 'neck')
    const [hl, hr] = (['l', 'r'] as const).map((s) => caps.filter((k) => k.region === `hand_${s}`))
    const [sl, sr] = dbs.map((spec, k) => placeParts(spec, poses[k]))
    return Math.min(
      Math.min(...[...sl, ...sr].flatMap((sd) => trunk.map((t) => capsuleSolidClearance(t, sd)))) - TATE.touch,
      Math.min(...sl.flatMap((a) => sr.map((b) => solidClearance(a, b)))) - TATE.apart,
      Math.min(...hl.flatMap((a) => hr.map((b) => capsuleClearance(a, b)))) - TATE.apart,
      Math.min(...hl.flatMap((a) => sr.map((b) => capsuleSolidClearance(a, b))), ...hr.flatMap((a) => sl.map((b) => capsuleSolidClearance(a, b)))) - TATE.apart,
    )
  }
  for (let e = TATE.lock + 10; e <= TATE.max; e += 2) {
    if (gap(e) >= 0) continue
    v.elbow = [TATE.lock, root1d(gap, e - 2, e, { tol: 1e-4 }).x]
    break
  }
  return v
}

export function sampleTate(u: number, p: P, skel: Skeleton, v: Tate): Sampled {
  const q = lyingBase(skel, v.lying)
  const held = arms(skel, q, p, v, lerp(v.elbow[1], v.elbow[0], phaseAt(u, v.tempo).c))
  return { q, implements: [...held, v.lying.benchPose] }
}
