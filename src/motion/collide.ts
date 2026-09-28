import type { FK } from './fk.ts'
import type { ImplementSpec, Part } from './implements.ts'
import { add, clamp, dist, dot, len, norm, qconj, qmul, qrot, scale, sub, type Quat, type V3 } from './math.ts'
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

/** a part's placed geometry */
export type PlacedGeo = { shape: 'cylinder'; a: V3; b: V3; r: number } | { shape: 'box'; center: V3; half: V3; rot: Quat }

/** an implement part placed in the world, with a bounding sphere for cheap culling */
export type Solid = { sd: (p: V3) => number; center: V3; radius: number; part: Part; index: number; geo: PlacedGeo }

export function placeParts(spec: ImplementSpec, pose: ImplementPose): Solid[] {
  const w = (v: V3) => add(pose.pos, qrot(pose.rot, v))
  return spec.parts.map((part, index) => {
    if (part.shape === 'cylinder') {
      const a = w(part.a), b = w(part.b)
      return { sd: (p: V3) => sdCylinder(p, a, b, part.r), center: scale(add(a, b), 0.5), radius: Math.hypot(dist(a, b) / 2, part.r), part, index, geo: { shape: 'cylinder', a, b, r: part.r } }
    }
    const c = w(part.center)
    const rot = part.rot ? qmul(pose.rot, part.rot) : pose.rot
    const half = scale(part.size, 0.5)
    return { sd: (p: V3) => sdBox(p, c, half, rot), center: c, radius: len(half), part, index, geo: { shape: 'box', center: c, half, rot } }
  })
}

/** the capsule enclosing a placed part (a box along its longest side): a lower bound on clearances, for culling */
export function enclosingCapsule(s: Pick<Solid, 'geo'>): Pick<Capsule, 'a' | 'b' | 'r'> {
  const g = s.geo
  if (g.shape === 'cylinder') return { a: g.a, b: g.b, r: g.r }
  const k = g.half.indexOf(Math.max(...g.half))
  const axis: V3 = [0, 0, 0]
  axis[k] = g.half[k]
  const u = qrot(g.rot, axis)
  return { a: sub(g.center, u), b: add(g.center, u), r: Math.hypot(...g.half.filter((_, j) => j !== k)) }
}

/** points on the surface of a placed part, at most about `step` apart */
export function surfacePoints(s: Pick<Solid, 'geo'>, step = 0.01): V3[] {
  const g = s.geo
  const out: V3[] = []
  if (g.shape === 'cylinder') {
    const ax = sub(g.b, g.a)
    const h = len(ax)
    const u = h > 1e-9 ? scale(ax, 1 / h) : ([0, 1, 0] as V3)
    const t0: V3 = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    const e1 = norm(sub(t0, scale(u, dot(t0, u))))
    const e2: V3 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]]
    const ring = (at: V3, r: number) => {
      const n = Math.max(8, Math.ceil((2 * Math.PI * r) / step))
      for (let k = 0; k < n; k++) {
        const th = (2 * Math.PI * k) / n
        out.push(add(at, add(scale(e1, r * Math.cos(th)), scale(e2, r * Math.sin(th)))))
      }
    }
    const nt = Math.max(1, Math.ceil(h / step))
    for (let i = 0; i <= nt; i++) ring(add(g.a, scale(u, (h * i) / nt)), g.r)
    const nr = Math.ceil(g.r / step)
    for (const end of [g.a, g.b]) {
      out.push(end)
      for (let k = 1; k < nr; k++) ring(end, (g.r * k) / nr)
    }
    return out
  }
  const n = g.half.map((x) => Math.max(1, Math.ceil((2 * x) / step)))
  for (let k = 0; k < 3; k++) {
    const [i, j] = [(k + 1) % 3, (k + 2) % 3]
    for (const side of [-1, 1]) {
      for (let a = 0; a <= n[i]; a++) for (let b = 0; b <= n[j]; b++) {
        const l: V3 = [0, 0, 0]
        l[k] = side * g.half[k]
        l[i] = -g.half[i] + (2 * g.half[i] * a) / n[i]
        l[j] = -g.half[j] + (2 * g.half[j] * b) / n[j]
        out.push(add(g.center, qrot(g.rot, l)))
      }
    }
  }
  return out
}

/**
 * Clearance between two convex solids: the smaller of each one's signed distance over the other's surface samples
 * (exact at the samples, so it overstates the clearance by at most about half the sample step; containment shows up
 * as the contained part's samples going negative). Negative = penetration depth.
 */
export function solidClearance(A: Pick<Solid, 'sd' | 'geo'>, B: Pick<Solid, 'sd' | 'geo'>, step = 0.01): number {
  let best = Infinity
  for (const p of surfacePoints(A, step)) best = Math.min(best, B.sd(p))
  for (const p of surfacePoints(B, step)) best = Math.min(best, A.sd(p))
  return best
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
