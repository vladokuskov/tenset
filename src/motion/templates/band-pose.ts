import { handFrame, implementFromHand, type FootTarget } from '../constraints.ts'
import { bodyCapsules, segmentDistance, type Capsule } from '../collide.ts'
import { fk } from '../fk.ts'
import type { ImplementSpec } from '../implements.ts'
import { bandGrip, bandNode, type BandPoint } from '../implements/index.ts'
import { add, dist, norm, qrot, scale, sub, type V3 } from '../math.ts'
import type { Contact, ImplementPose, Skeleton } from '../skeleton.ts'

// Band helpers for the shoulder and back templates (lane L2): bare band ends bunched in the fists, the band's run
// under the soles, and a free path point that keeps a straight run of the band off the body.

type Side = 'l' | 'r'

export const fistId = (s: Side) => `bg_${s}`

export function fistGrips(sides: readonly Side[] = ['l', 'r']): ImplementSpec[] {
  return sides.map((s) => bandGrip({ id: fistId(s) }))
}

export function fistContacts(sides: readonly Side[] = ['l', 'r']): Contact[] {
  return sides.map((s) => ({ site: `grip_${s}`, kind: 'grip' as const, target: { implement: fistId(s), grip: 'c' } }))
}

/** the bunched band in each fist, along the grip axis (little finger to index) */
export function fistPoses(skel: Skeleton, q: Float64Array, sides: readonly Side[] = ['l', 'r']): ImplementPose[] {
  const f = fk(skel, q)
  return sides.map((s) => {
    const h = handFrame(skel, f, s)
    return { id: fistId(s), pos: h.pos, rot: implementFromHand(h.axis, h.palm) }
  })
}

/** a still path point at the world origin: floor points ride on it through `at` */
export const FLOOR_NODE = 'band_floor'
export const floorNode = () => bandNode(FLOOR_NODE)
export const floorPose = (): ImplementPose => ({ id: FLOOR_NODE, pos: [0, 0, 0], rot: [0, 0, 0, 1] })

/** band height under a sole: inside the foot, so only the runs between and beside the feet show, m */
const UNDER_SOLE = 0.002
/** half the sole width at the midfoot, m */
const SOLE_HALF = 0.045

/**
 * Standing on the middle of the band: from the left foot's outer edge under its sole, across the floor, under the
 * right sole to its outer edge (floor points on FLOOR_NODE, facing up).
 */
export function underFeet(skel: Skeleton, feet: FootTarget[]): BandPoint[] {
  const out: BandPoint[] = []
  for (const side of ['l', 'r'] as const) {
    const ft = feet.find((x) => x.side === side)!
    const mid = add(ft.ankle, qrot(ft.rot, skel.data.sites[`midfoot_${side}`].local))
    const lat = norm(qrot(ft.rot, [side === 'l' ? 1 : -1, 0, 0]))
    const edge = (k: number): V3 => [mid[0] + lat[0] * k, UNDER_SOLE, mid[2] + lat[2] * k]
    const pts = side === 'l' ? [edge(SOLE_HALF + 0.004), edge(-SOLE_HALF)] : [edge(-SOLE_HALF), edge(SOLE_HALF + 0.004)]
    for (const at of pts) out.push({ implement: FLOOR_NODE, at, face: [0, 1, 0] })
  }
  return out
}

/** the band keeps this far off the body's capsules, m */
const BAND_CLEAR = 0.006

function nearest(p: V3, caps: Capsule[]) {
  let best = { d: Infinity, axis: p }
  for (const c of caps) {
    const r = segmentDistance(p, p, c.a, c.b)
    const axisPt = add(c.a, scale(sub(c.b, c.a), r.t))
    const d = dist(p, axisPt) - c.r
    if (d < best.d) best = { d, axis: axisPt }
  }
  return best
}

/**
 * A free point for the run from `a` to `b`: its midpoint when the straight run clears the body, otherwise the deepest
 * point of the run pushed out of the body (the band wraps over it). `pick` limits the capsules considered.
 */
export function detour(skel: Skeleton, q: Float64Array, a: V3, b: V3, pick: (c: Capsule) => boolean = () => true): V3 {
  const caps = bodyCapsules(skel, fk(skel, q)).filter(pick)
  let worst = { t: 0.5, d: Infinity }
  for (let k = 1; k < 24; k++) {
    const t = k / 24
    const d = nearest(add(a, scale(sub(b, a), t)), caps).d
    if (d < worst.d) worst = { t, d }
  }
  let p = add(a, scale(sub(b, a), worst.t))
  if (worst.d >= BAND_CLEAR) return add(a, scale(sub(b, a), 0.5))
  for (let k = 0; k < 6; k++) {
    const n = nearest(p, caps)
    if (n.d >= BAND_CLEAR - 1e-4) break
    p = add(n.axis, scale(norm(sub(p, n.axis)), dist(p, n.axis) + BAND_CLEAR - n.d))
  }
  return p
}

/** clearance of a point from the nearest capsule surface, m */
function clearance(p: V3, caps: Capsule[]) {
  let d = Infinity
  for (const c of caps) d = Math.min(d, segmentDistance(p, p, c.a, c.b).d - c.r)
  return d
}

/**
 * Free points at `ts` (fractions of the way from `a` to `b`, increasing) for a long run that drapes over the body (a
 * band hanging in front of the trunk and thigh): wherever the polyline through them comes within BAND_CLEAR of the
 * body, the two points around that spot move along `dir` until it clears. `pick` limits the capsules considered.
 */
export function drape(skel: Skeleton, q: Float64Array, a: V3, b: V3, ts: number[], dir: V3, pick: (c: Capsule) => boolean = () => true): V3[] {
  const caps = bodyCapsules(skel, fk(skel, q)).filter(pick)
  const along = (t: number, s: number) => add(add(a, scale(sub(b, a), t)), scale(dir, s))
  const knots = [0, ...ts, 1]
  const s = knots.map(() => 0)
  const last = knots.length - 1
  const M = 80
  for (let it = 0; it < 60; it++) {
    let moved = false
    for (let k = 1; k < M; k++) {
      const t = k / M
      let j = 0
      while (knots[j + 1] < t) j++
      const w = (t - knots[j]) / (knots[j + 1] - knots[j])
      const at = s[j] * (1 - w) + s[j + 1] * w
      if (clearance(along(t, at), caps) >= BAND_CLEAR) continue
      let lo = at, hi = at + 0.05
      while (clearance(along(t, hi), caps) < BAND_CLEAR && hi < at + 0.8) hi += 0.05
      for (let n = 0; n < 20; n++) {
        const m = (lo + hi) / 2
        if (clearance(along(t, m), caps) >= BAND_CLEAR) hi = m
        else lo = m
      }
      // raise the knots on either side (an end knot stays put, so its neighbour takes the whole raise)
      const deficit = hi - at + 1e-4
      if (j === 0) s[1] += deficit / w
      else if (j + 1 === last) s[j] += deficit / (1 - w)
      else {
        s[j] += deficit
        s[j + 1] += deficit
      }
      moved = true
    }
    if (!moved) break
  }
  return ts.map((t, k) => along(t, s[k + 1]))
}
