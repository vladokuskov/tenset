import type { FK } from './fk.ts'
import type { ImplementSpec, Part } from './implements.ts'
import { add, clamp, dist, dot, len, qconj, qmul, qrot, scale, sub, type Quat, type V3 } from './math.ts'
import type { ImplementPose, Skeleton } from './skeleton.ts'

// Clearance geometry for the penetration gate: body capsules measured from the mesh (skeleton.json), implement
// parts as exact solid cylinders and boxes. Distances in metres; negative clearance is penetration depth.

export type Capsule = { name: string; region: string; segment: string; a: V3; b: V3; r: number }

/** world-space body capsules for one frame */
export function bodyCapsules(skel: Skeleton, f: FK): Capsule[] {
  return Object.entries(skel.data.capsules).map(([name, c]) => {
    const i = skel.seg[c.segment]
    const w = (v: V3) => add(f.pos[i], qrot(f.rot[i], v))
    return { name, region: c.region, segment: c.segment, a: w(c.a), b: w(c.b), r: c.r }
  })
}

/** closest points between segments p0-p1 and q0-q1 (Ericson, Real-Time Collision Detection 5.1.9) */
export function segmentDistance(p0: V3, p1: V3, q0: V3, q1: V3): { d: number; s: number; t: number } {
  const d1 = sub(p1, p0), d2 = sub(q1, q0), r = sub(p0, q0)
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r)
  let s = 0, t = 0
  if (a < 1e-12 && e < 1e-12) return { d: dist(p0, q0), s, t }
  if (a < 1e-12) t = clamp(f / e, 0, 1)
  else {
    const c = dot(d1, r)
    if (e < 1e-12) s = clamp(-c / a, 0, 1)
    else {
      const b = dot(d1, d2)
      const den = a * e - b * b
      s = den > 1e-12 ? clamp((b * f - c * e) / den, 0, 1) : 0
      t = (b * s + f) / e
      if (t < 0) [t, s] = [0, clamp(-c / a, 0, 1)]
      else if (t > 1) [t, s] = [1, clamp((b - c) / a, 0, 1)]
    }
  }
  const cp = add(p0, scale(d1, s)), cq = add(q0, scale(d2, t))
  return { d: dist(cp, cq), s, t }
}

export function capsuleClearance(A: Pick<Capsule, 'a' | 'b' | 'r'>, B: Pick<Capsule, 'a' | 'b' | 'r'>): number {
  return segmentDistance(A.a, A.b, B.a, B.b).d - A.r - B.r
}

/** signed distance from p to a solid finite cylinder a-b of radius r */
export function sdCylinder(p: V3, a: V3, b: V3, r: number): number {
  const ba = sub(b, a)
  const h = len(ba)
  if (h < 1e-9) return dist(p, a) - r
  const u = scale(ba, 1 / h)
  const pa = sub(p, a)
  const t = dot(pa, u)
  const dx = len(sub(pa, scale(u, t))) - r
  const dy = Math.abs(t - h / 2) - h / 2
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0)
}

/** signed distance from p to a solid box (centre, half extents, rotation) */
export function sdBox(p: V3, center: V3, half: V3, rot: Quat): number {
  const l = qrot(qconj(rot), sub(p, center))
  const q = [Math.abs(l[0]) - half[0], Math.abs(l[1]) - half[1], Math.abs(l[2]) - half[2]]
  return Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)) + Math.min(Math.max(q[0], q[1], q[2]), 0)
}

/** an implement part placed in the world, with a bounding sphere for cheap culling */
export type Solid = { sd: (p: V3) => number; center: V3; radius: number; part: Part; index: number }

export function placeParts(spec: ImplementSpec, pose: ImplementPose): Solid[] {
  const w = (v: V3) => add(pose.pos, qrot(pose.rot, v))
  return spec.parts.map((part, index) => {
    if (part.shape === 'cylinder') {
      const a = w(part.a), b = w(part.b)
      return { sd: (p: V3) => sdCylinder(p, a, b, part.r), center: scale(add(a, b), 0.5), radius: Math.hypot(dist(a, b) / 2, part.r), part, index }
    }
    const c = w(part.center)
    const rot = part.rot ? qmul(pose.rot, part.rot) : pose.rot
    const half = scale(part.size, 0.5)
    return { sd: (p: V3) => sdBox(p, c, half, rot), center: c, radius: len(half), part, index }
  })
}

const GOLD = (Math.sqrt(5) - 1) / 2

/**
 * Clearance between a capsule and a convex solid: the solid's signed distance is convex, so its minimum along the
 * capsule axis is found by golden-section search.
 */
export function capsuleSolidClearance(c: Pick<Capsule, 'a' | 'b' | 'r'>, s: Pick<Solid, 'sd'>, iters = 40): number {
  const at = (t: number) => s.sd(add(c.a, scale(sub(c.b, c.a), t)))
  let lo = 0, hi = 1
  let x1 = hi - GOLD * (hi - lo), x2 = lo + GOLD * (hi - lo)
  let f1 = at(x1), f2 = at(x2)
  for (let k = 0; k < iters; k++) {
    if (f1 < f2) {
      hi = x2
      x2 = x1
      f2 = f1
      x1 = hi - GOLD * (hi - lo)
      f1 = at(x1)
    } else {
      lo = x1
      x1 = x2
      f1 = f2
      x2 = lo + GOLD * (hi - lo)
      f2 = at(x2)
    }
  }
  return Math.min(f1, f2, at(0), at(1)) - c.r
}

/** lower bound on the clearance from bounding volumes, for culling */
export function boundClearance(c: Pick<Capsule, 'a' | 'b' | 'r'>, s: Pick<Solid, 'center' | 'radius'>): number {
  return segmentDistance(c.a, c.b, s.center, s.center).d - c.r - s.radius
}

/**
 * Slide a support part (pad, seat) along `dir` (pointing away from the body) until its closest capsule sits at
 * `rest` clearance (negative: the body sinks into the padding). Returns the moved part. Used to place pads from the
 * measured body instead of guessed offsets.
 */
export function restAgainst<T extends Part>(caps: Capsule[], part: T, dir: V3, rest = -0.01): T {
  const moved = (t: number): T => {
    const d = scale(dir, t)
    return part.shape === 'cylinder' ? { ...part, a: add(part.a, d), b: add(part.b, d) } : { ...part, center: add(part.center, d) }
  }
  const spec: ImplementSpec = { id: 'tmp', kind: 'bench', mass: 0, com: [0, 0, 0], parts: [], sites: {} }
  const pose: ImplementPose = { id: 'tmp', pos: [0, 0, 0], rot: [0, 0, 0, 1] }
  const clear = (t: number) => {
    const [s] = placeParts({ ...spec, parts: [moved(t)] }, pose)
    return Math.min(...caps.map((c) => capsuleSolidClearance(c, s))) - rest
  }
  let lo = -0.3, hi = 0.3
  for (let k = 0; k < 50; k++) {
    const m = (lo + hi) / 2
    if (clear(m) < 0) lo = m
    else hi = m
  }
  return moved(hi)
}
