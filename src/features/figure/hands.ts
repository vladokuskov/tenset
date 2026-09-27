import { Euler, Quaternion, Vector3 } from 'three'
import { mirrorSpec, type JointSpec, type Rig, type Vec3 } from './rig.ts'

// Finger poses. Wrap grips close each finger joint until it touches a handle cylinder placed against the palm,
// then fit the thumb around it, on a capsule model of the left hand in the wrist frame
// (+X palmar, +Y towards the fingers, +Z towards the thumb). The right hand is the mirror image.

export type HandSide = 'L' | 'R'
export type GripName = 'relaxed' | 'open' | 'pronated' | 'supinated' | 'neutral' | 'hook' | 'rope' | 'd-handle'

export const gripNames: GripName[] = ['relaxed', 'open', 'pronated', 'supinated', 'neutral', 'hook', 'rope', 'd-handle']

/** handle diameter in metres when none is given */
export const defaultDiameter: Record<GripName, number> = {
  relaxed: 0.033,
  open: 0.033,
  pronated: 0.033,
  supinated: 0.033,
  neutral: 0.033,
  hook: 0.029,
  rope: 0.03,
  'd-handle': 0.03,
}

type Q4 = [number, number, number, number]
// rest pose from public/models/body.glb (hands.test.ts keeps it in sync); capsules fitted to the skinned vertices:
// axis offset (xc, zc) from the bone, palmar radius rz, side radius rx; palm = palmar skin depth at a metacarpal head
type BoneDef = { parent: string; t: Vec3; q: Q4; len?: number; zc?: number; xc?: number; rz?: number; rx?: number; palm?: number }
export const HAND: Record<string, BoneDef> = {
  'finger1-1': { parent: 'wrist', t: [0.00133, 0.04571, 0.02349], q: [0.42742, 0.84876, 0.27457, 0.14669], len: 0.0351, zc: 0.0062, xc: -0.0133, rz: 0.0191, rx: 0.0114 },
  'finger1-2': { parent: 'finger1-1', t: [0, 0.03507, 0], q: [0.05408, -0.02298, -0.1847, 0.98104], len: 0.0418, zc: 0.0035, xc: 0.0053, rz: 0.012, rx: 0.0152 },
  'finger1-3': { parent: 'finger1-2', t: [0, 0.0418, 0], q: [0.13721, 0.01118, -0.03886, 0.98972], len: 0.0324, zc: 0.005, xc: 0.0017, rz: 0.0091, rx: 0.011 },
  metacarpal1: { parent: 'wrist', t: [0, 0.0374, 0], q: [0.04555, 0.81179, 0.09778, 0.5739], palm: 0.0219 },
  metacarpal2: { parent: 'wrist', t: [0, 0.0374, 0], q: [-0.08524, 0.7644, -0.02222, 0.63869], palm: 0.0248 },
  metacarpal3: { parent: 'wrist', t: [0.00131, 0.04067, -0.02472], q: [-0.09399, 0.77464, -0.0025, 0.62537], palm: 0.0238 },
  metacarpal4: { parent: 'wrist', t: [0.00131, 0.04067, -0.02472], q: [-0.18752, 0.69022, -0.14867, 0.68288], palm: 0.0193 },
  'finger2-1': { parent: 'metacarpal1', t: [0, 0.08531, 0], q: [0.13871, -0.03883, -0.04189, 0.98868], len: 0.0297, zc: 0.0068, xc: -0.0001, rz: 0.0112, rx: 0.0122 },
  'finger2-2': { parent: 'finger2-1', t: [0, 0.02968, 0], q: [0.10593, -0.00615, 0.00711, 0.99433], len: 0.0266, zc: 0.0054, xc: -0.0007, rz: 0.0097, rx: 0.0111 },
  'finger2-3': { parent: 'finger2-2', t: [0, 0.0266, 0], q: [0.05879, 0.00324, 0.01676, 0.99812], len: 0.0297, zc: 0.0032, xc: -0.0007, rz: 0.0084, rx: 0.0098 },
  'finger3-1': { parent: 'metacarpal2', t: [0, 0.08057, 0], q: [0.18426, 0.00473, -0.01408, 0.98277], len: 0.0386, zc: 0.0094, xc: -0.0035, rz: 0.0143, rx: 0.0123 },
  'finger3-2': { parent: 'finger3-1', t: [0, 0.03858, 0], q: [0.04751, -0.00902, 0.03855, 0.99809], len: 0.0313, zc: 0.0054, xc: -0.0023, rz: 0.0094, rx: 0.0104 },
  'finger3-3': { parent: 'finger3-2', t: [0, 0.03135, 0], q: [0.06501, 0.00015, -0.00515, 0.99787], len: 0.0286, zc: 0.0036, xc: -0.0014, rz: 0.0083, rx: 0.0089 },
  'finger4-1': { parent: 'metacarpal3', t: [0, 0.06826, 0], q: [0.2043, -0.02789, -0.10978, 0.97233], len: 0.034, zc: 0.0084, xc: -0.0013, rz: 0.0123, rx: 0.0117 },
  'finger4-2': { parent: 'finger4-1', t: [0, 0.034, 0], q: [0.05702, -0.00473, 0.0475, 0.99723], len: 0.0284, zc: 0.0052, xc: -0.0009, rz: 0.0087, rx: 0.0096 },
  'finger4-3': { parent: 'finger4-2', t: [0, 0.02843, 0], q: [0.06362, -0.00689, -0.02631, 0.9976], len: 0.0306, zc: 0.0036, xc: -0.0003, rz: 0.0077, rx: 0.0088 },
  'finger5-1': { parent: 'metacarpal4', t: [0, 0.06145, 0], q: [0.18247, -0.01123, -0.02626, 0.9828], len: 0.0245, zc: 0.0051, xc: -0.0005, rz: 0.01, rx: 0.0094 },
  'finger5-2': { parent: 'finger5-1', t: [0, 0.02448, 0], q: [0.08186, -0.0049, 0.02121, 0.99641], len: 0.0178, zc: 0.0034, xc: 0.0002, rz: 0.0077, rx: 0.0077 },
  'finger5-3': { parent: 'finger5-2', t: [0, 0.01781, 0], q: [-0.00554, -0.00473, -0.00992, 0.99992], len: 0.023, zc: 0.0026, xc: 0.0005, rz: 0.0065, rx: 0.0073 },
}

/** bones posed by a grip, parents first */
export const HAND_BONES = Object.keys(HAND)
const FINGERS = [2, 3, 4, 5] as const
const seg = (f: number, s: number) => `finger${f}-${s}`
const DEG = Math.PI / 180

type Frame = { p: Vector3; q: Quaternion }
type Deltas = Record<string, Quaternion>

const REST: Record<string, Quaternion> = Object.fromEntries(HAND_BONES.map((n) => [n, new Quaternion(...HAND[n].q).normalize()]))

function fk(deltas: Deltas): Record<string, Frame> {
  const out: Record<string, Frame> = { wrist: { p: new Vector3(), q: new Quaternion() } }
  for (const n of HAND_BONES) {
    const b = HAND[n]
    const parent = out[b.parent]
    const q = parent.q.clone().multiply(REST[n])
    if (deltas[n]) q.multiply(deltas[n])
    out[n] = { p: new Vector3(...b.t).applyQuaternion(parent.q).add(parent.p), q }
  }
  return out
}

type Capsule = { a: Vector3; b: Vector3; r: number; rs: number }

function capsule(frames: Record<string, Frame>, n: string): Capsule {
  const b = HAND[n]
  const f = frames[n]
  const a = new Vector3(b.xc ?? 0, 0, b.zc ?? 0).applyQuaternion(f.q).add(f.p)
  return { a, b: new Vector3(0, b.len ?? 0, 0).applyQuaternion(f.q).add(a), r: b.rz ?? 0, rs: ((b.rz ?? 0) + (b.rx ?? 0)) / 2 }
}

/** distance from segment p0p1 to the infinite line through c along the unit axis */
function segLine(p0: Vector3, p1: Vector3, c: Vector3, axis: Vector3) {
  const u = p0.clone().sub(c)
  const d = p1.clone().sub(p0)
  u.addScaledVector(axis, -u.dot(axis))
  d.addScaledVector(axis, -d.dot(axis))
  const dd = d.lengthSq()
  const s = dd > 1e-12 ? Math.min(1, Math.max(0, -u.dot(d) / dd)) : 0
  return u.addScaledVector(d, s).length()
}

/** closest distance between segments p0p1 and q0q1 */
function segSeg(p0: Vector3, p1: Vector3, q0: Vector3, q1: Vector3) {
  const d1 = p1.clone().sub(p0), d2 = q1.clone().sub(q0), r = p0.clone().sub(q0)
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r)
  let s = 0, t = 0
  if (a < 1e-12 && e < 1e-12) return r.length()
  if (a < 1e-12) t = Math.min(1, Math.max(0, f / e))
  else {
    const c = d1.dot(r)
    if (e < 1e-12) s = Math.min(1, Math.max(0, -c / a))
    else {
      const b = d1.dot(d2), den = a * e - b * b
      s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0
      t = (b * s + f) / e
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)) }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)) }
    }
  }
  return p0.clone().addScaledVector(d1, s).sub(q0.clone().addScaledVector(d2, t)).length()
}

// finger flexion about the knuckle line, spread about the palm normal (both in each bone's rest frame, as in rig.ts)
const rest = fk({})
const ACROSS = rest['finger5-1'].p.clone().sub(rest['finger2-1'].p).normalize()
const PALM_N = new Vector3(0, 1, 0).applyQuaternion(rest['finger3-1'].q).cross(ACROSS).normalize().negate()
const HINGE: Record<string, Vector3> = {}
const SPREAD: Record<string, { axis: Vector3; angle: number }> = {}
{
  const midDir = new Vector3(0, 1, 0).applyQuaternion(rest['finger3-1'].q)
  for (const f of FINGERS) {
    for (const s of [1, 2, 3]) {
      const n = seg(f, s)
      const q = rest[n].q
      const dir = new Vector3(0, 1, 0).applyQuaternion(q)
      const axis = ACROSS.clone().addScaledVector(dir, -ACROSS.dot(dir)).normalize()
      if (axis.dot(new Vector3(1, 0, 0).applyQuaternion(q)) < 0) axis.negate()
      const inv = q.clone().invert()
      HINGE[n] = axis.applyQuaternion(inv)
      if (s === 1) {
        const inPlane = (v: Vector3) => v.clone().addScaledVector(PALM_N, -v.dot(PALM_N)).normalize()
        const a = inPlane(dir), m = inPlane(midDir)
        SPREAD[n] = { axis: PALM_N.clone().applyQuaternion(inv), angle: Math.atan2(new Vector3().crossVectors(a, m).dot(PALM_N), a.dot(m)) }
      }
    }
  }
}

function fingerDelta(n: string, flexDeg: number, spread = 0) {
  const q = new Quaternion().setFromAxisAngle(HINGE[n], flexDeg * DEG)
  const s = SPREAD[n]
  if (s && spread) q.multiply(new Quaternion().setFromAxisAngle(s.axis, spread * s.angle))
  return q.normalize()
}

function nelderMead(f: (x: number[]) => number, x0: number[], step: number[], iters = 400) {
  const n = x0.length
  let pts = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[i] : v)))].map((x) => ({ x, v: f(x) }))
  for (let k = 0; k < iters; k++) {
    pts.sort((a, b) => a.v - b.v)
    const c = x0.map((_, j) => pts.slice(0, n).reduce((s, p) => s + p.x[j], 0) / n)
    const w = pts[n]
    const at = (t: number) => c.map((v, j) => v + t * (w.x[j] - v))
    const r = at(-1), fr = f(r)
    if (fr < pts[0].v) {
      const e = at(-2), fe = f(e)
      pts[n] = fe < fr ? { x: e, v: fe } : { x: r, v: fr }
    } else if (fr < pts[n - 1].v) pts[n] = { x: r, v: fr }
    else {
      const k2 = at(0.5), fk2 = f(k2)
      if (fk2 < w.v) pts[n] = { x: k2, v: fk2 }
      else pts = pts.map((p, i) => (i === 0 ? p : { x: p.x.map((v, j) => pts[0].x[j] + 0.5 * (v - pts[0].x[j])), v: 0 })).map((p, i) => (i === 0 ? p : { x: p.x, v: f(p.x) }))
    }
  }
  pts.sort((a, b) => a.v - b.v)
  return pts[0]
}

// the palmar pads bulge past the fitted metacarpal depth when the fingers flex
const PALM_CLEARANCE = 0.003

// finger curl synergy (degrees per step, knuckle / middle / tip joint) and joint limits past rest
const CURL_RATE = [1, 1.25, 0.85]
const CURL_MAX = [95, 105, 85]

type WrapDef = {
  /** handle axis tilt in the palm plane (deg): + puts the little-finger end nearer the wrist */
  tilt: number
  /** handle axis distance behind the middle knuckle, along the hand (m) */
  depth: number
  /** fingers towards the middle finger, 0..1 of their rest splay */
  spread: number
  thumb: 'wrap' | 'hook'
}

const WRAPS: Partial<Record<GripName, WrapDef>> = {
  // bar across the base of the fingers
  pronated: { tilt: 8, depth: 0.012, spread: 0.55, thumb: 'wrap' },
  // deeper in the palm and more diagonal
  supinated: { tilt: 16, depth: 0.02, spread: 0.55, thumb: 'wrap' },
  // hammer grip: diagonal across the palm
  neutral: { tilt: 20, depth: 0.018, spread: 0.55, thumb: 'wrap' },
  // thumb wrapped first, index and middle fingers over it
  hook: { tilt: 6, depth: 0.01, spread: 0.6, thumb: 'hook' },
  // a rope runs straight through the fist
  rope: { tilt: 4, depth: 0.016, spread: 0.7, thumb: 'wrap' },
  // the D frame keeps the fingers together on a short bar
  'd-handle': { tilt: 10, depth: 0.014, spread: 0.8, thumb: 'wrap' },
}

export type GripSolution = {
  grip: GripName
  diameter: number
  /** local rotation deltas from the rest pose, left hand */
  deltas: Deltas
  /** handle axis in the left wrist frame: centre under the hand and direction little finger -> index */
  handle: { center: Vector3; axis: Vector3 }
}

type Pose0 = {
  mcp: number[]
  pip: number[]
  dip: number[]
  spread: number
  /** thumb pad target in the wrist frame, from the posed finger frames */
  thumb: (fr: Record<string, Frame>) => Vector3
}
const RADIAL = ACROSS.clone().negate()
const POSED: Partial<Record<GripName, Pose0>> = {
  // natural cascade: more curl towards the little finger, the thumb pad resting by the side of the index
  relaxed: {
    mcp: [14, 18, 22, 26],
    pip: [18, 24, 28, 32],
    dip: [6, 8, 10, 10],
    spread: 0.45,
    thumb: (fr) => {
      const c = capsule(fr, 'finger2-2')
      return c.a.clone().lerp(c.b, 0.2).addScaledVector(RADIAL, c.rs + 0.013).addScaledVector(PALM_N, 0.008)
    },
  },
  // flat, fingers straight and together, thumb out in the palm plane
  open: {
    mcp: [-16, -19, -21, -19],
    pip: [-8, -4, -5, -8],
    dip: [-4, -6, -6, 0],
    spread: 0.35,
    thumb: (fr) => fr['finger2-1'].p.clone().addScaledVector(RADIAL, 0.05).addScaledVector(new Vector3(0, 1, 0), -0.014).addScaledVector(PALM_N, 0.008),
  },
}

function thumbDeltas(x: readonly number[]): Deltas {
  return {
    'finger1-1': new Quaternion().setFromEuler(new Euler(x[0] * DEG, x[1] * DEG, x[2] * DEG, 'ZYX')),
    'finger1-2': new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), x[3] * DEG),
    'finger1-3': new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), x[4] * DEG),
  }
}

type Handle = { center: Vector3; axis: Vector3; R: number }

/** Thumb pose (metacarpal euler, then the two joint flexions) whose pad settles on `target` without entering the
 * handle or the listed finger segments. */
function fitThumb(deltas: Deltas, target: Vector3, obstacles: string[], handle?: Handle): Deltas {
  const cost = (x: number[]) => {
    const fr = fk({ ...deltas, ...thumbDeltas(x) })
    const pad = capsule(fr, 'finger1-3')
    const prox = capsule(fr, 'finger1-2')
    const base = capsule(fr, 'finger1-1')
    let c = 0
    if (handle) {
      for (const k of [prox, pad, base]) {
        const g = segLine(k.a, k.b, handle.center, handle.axis) - (handle.R + (k === base ? k.rs : k.r))
        if (g < 0) c += 1e6 * g * g
      }
    }
    for (const n of obstacles) {
      const o = capsule(fr, n)
      for (const k of [prox, pad]) {
        const g = segSeg(k.a, k.b, o.a, o.b) - (k.rs + o.rs)
        if (g < 0) c += 1e6 * g * g
      }
    }
    c += 2000 * pad.a.clone().add(pad.b).multiplyScalar(0.5).distanceToSquared(target)
    c += 1e-6 * (x[0] ** 2 + x[1] ** 2 + x[2] ** 2) + 2e-6 * (x[3] ** 2 + x[4] ** 2)
    c += 1e-3 * (Math.max(0, x[3] - 70) ** 2 + Math.max(0, -10 - x[3]) ** 2 + Math.max(0, x[4] - 85) ** 2 + Math.max(0, -20 - x[4]) ** 2)
    return c
  }
  let best: { x: number[]; v: number } | null = null
  for (const x0 of [[0, 0, 0, 20, 20], [20, -20, 10, 30, 30], [-20, 20, -10, 30, 30], [30, 10, 30, 20, 40], [0, -30, 0, 40, 30], [-30, 0, 30, 30, 30]]) {
    const r = nelderMead(cost, x0, [15, 15, 15, 15, 15], 600)
    if (!best || r.v < best.v) best = r
  }
  return thumbDeltas(best!.x)
}

function solvePosed(grip: GripName, def: Pose0, diameter: number): GripSolution {
  const deltas: Deltas = {}
  FINGERS.forEach((f, i) => {
    deltas[seg(f, 1)] = fingerDelta(seg(f, 1), def.mcp[i], def.spread)
    deltas[seg(f, 2)] = fingerDelta(seg(f, 2), def.pip[i])
    deltas[seg(f, 3)] = fingerDelta(seg(f, 3), def.dip[i])
  })
  Object.assign(deltas, fitThumb(deltas, def.thumb(fk(deltas)), ['finger2-1', 'finger2-2', 'finger2-3']))
  return { grip, diameter, deltas, handle: handleFallback(fk(deltas)) }
}

function handleFallback(frames: Record<string, Frame>) {
  const center = frames['finger3-1'].p.clone().add(frames['finger4-1'].p).multiplyScalar(0.5).addScaledVector(PALM_N, 0.03)
  return { center, axis: ACROSS.clone().negate() }
}

function solveWrap(grip: GripName, def: WrapDef, diameter: number): GripSolution {
  const R = diameter / 2
  // handle: across the palm, tilted, touching the most prominent metacarpal head
  const axis = ACROSS.clone().negate().applyAxisAngle(PALM_N, def.tilt * DEG).normalize()
  const knuckle = rest['finger3-1'].p
  const along = new Vector3().crossVectors(PALM_N, axis).normalize()
  if (along.dot(new Vector3(0, 1, 0)) < 0) along.negate()
  const center = knuckle.clone().addScaledVector(along, -def.depth)
  let lift = -Infinity
  for (const f of FINGERS) {
    const mc = `metacarpal${f - 1}`
    const fr = rest[mc]
    const palmOff = new Vector3(0, 0, HAND[mc].palm! + PALM_CLEARANCE).applyQuaternion(fr.q)
    const len = HAND[seg(f, 1)].t[1]
    const p0 = new Vector3(0, len * 0.55, 0).applyQuaternion(fr.q).add(fr.p).add(palmOff)
    const p1 = new Vector3(0, len, 0).applyQuaternion(fr.q).add(fr.p).add(palmOff)
    // height of each palm point above the handle plane decides how far out the handle must sit
    for (const p of [p0, p1]) {
      const rel = p.clone().sub(center)
      rel.addScaledVector(axis, -rel.dot(axis))
      const h = rel.dot(PALM_N)
      const side = rel.addScaledVector(PALM_N, -h).length()
      if (side < R) lift = Math.max(lift, h + Math.sqrt(R * R - side * side))
    }
  }
  center.addScaledVector(PALM_N, lift)
  const handle = { center, axis, R }

  const deltas: Deltas = {}
  const gapTo = (n: string, frames: Record<string, Frame>, obstacles: Capsule[]) => {
    const c = capsule(frames, n)
    let g = segLine(c.a, c.b, center, axis) - (R + c.r)
    for (const o of obstacles) g = Math.min(g, segSeg(c.a, c.b, o.a, o.b) - (c.rs + o.rs))
    return g
  }
  const outward = (p: Vector3) => {
    const d = p.clone().sub(center)
    return d.addScaledVector(axis, -d.dot(axis)).normalize()
  }
  // curl the three joints together until a segment touches, then settle every segment onto the handle
  // (no overlap, gaps closed, the curl kept close to the natural knuckle / middle / tip ratio)
  const closeFinger = (f: number, obstacles: Capsule[]) => {
    const names = [1, 2, 3].map((s) => seg(f, s))
    const set = (a: readonly number[]) => names.forEach((n, i) => { deltas[n] = fingerDelta(n, a[i], i === 0 ? def.spread : 0) })
    const gaps = (a: readonly number[]) => {
      set(a)
      const fr = fk(deltas)
      return names.map((n) => gapTo(n, fr, obstacles))
    }
    let t = 0
    const at = (tt: number) => CURL_RATE.map((r, i) => Math.min(CURL_MAX[i], r * tt))
    while (t < 110 && Math.min(...gaps(at(t + 2))) > 0) t += 2
    const cost = (a: number[]) => {
      const g = gaps(a)
      let c = 0
      g.forEach((v, i) => { c += v < 0 ? 1e6 * v * v : [1, 2, 3][i] * 1e3 * v * v })
      c += 2e-5 * ((a[1] - 1.25 * a[0]) ** 2 + (a[2] - 0.68 * a[1]) ** 2)
      a.forEach((v, i) => { c += 1e-2 * (Math.max(0, v - CURL_MAX[i]) ** 2 + Math.max(0, -v) ** 2) })
      return c
    }
    set(nelderMead(cost, at(t), [6, 6, 6], 300).x)
  }

  if (def.thumb === 'hook') {
    // pad on the far side of the bar, under where the index and middle fingers will close
    const fr0 = fk(deltas)
    const under = fr0['finger2-1'].p.clone().add(fr0['finger3-1'].p).multiplyScalar(0.5).sub(center).dot(axis)
    const target = center.clone().addScaledVector(axis, under).addScaledVector(PALM_N, R + HAND['finger1-3'].rz!)
    Object.assign(deltas, fitThumb(deltas, target, [], handle))
    const fr = fk(deltas)
    const thumbObstacles = [capsule(fr, 'finger1-3'), capsule(fr, 'finger1-2')]
    for (const f of FINGERS) closeFinger(f, f <= 3 ? thumbObstacles : [])
  } else {
    for (const f of FINGERS) closeFinger(f, [])
    // pad resting on the index finger's middle segment, outside the wrap
    const idx = capsule(fk(deltas), 'finger2-2')
    const m = idx.a.clone().add(idx.b).multiplyScalar(0.5)
    const target = m.addScaledVector(outward(m), idx.rs + (HAND['finger1-3'].rz! + HAND['finger1-3'].rx!) / 2)
    Object.assign(deltas, fitThumb(deltas, target, ['finger2-1', 'finger2-2', 'finger2-3', 'finger3-2', 'finger3-3'], handle))
  }
  // centre the handle under the middle of the hand
  const fr = fk(deltas)
  const mid = fr['finger3-1'].p.clone().add(fr['finger4-1'].p).multiplyScalar(0.5).sub(center)
  return { grip, diameter, deltas, handle: { center: center.clone().addScaledVector(axis, mid.dot(axis)), axis } }
}

/** A fresh solve (no memo, no baked table). */
export function computeGrip(grip: GripName, diameter = defaultDiameter[grip]): GripSolution {
  const w = WRAPS[grip]
  return w ? solveWrap(grip, w, diameter) : solvePosed(grip, POSED[grip]!, diameter)
}

const POSED_BONES = HAND_BONES.filter((n) => !n.startsWith('metacarpal'))

/** euler (ZYX, degrees) per posed bone, then handle centre and axis: the compact form of the baked table */
export function packGrip(s: GripSolution) {
  const r = (v: number, k: number) => Math.round(v * k) / k
  return [...POSED_BONES.flatMap((n) => eulerDeg(s.deltas[n])), ...s.handle.center.toArray().map((v) => r(v, 1e6)), ...s.handle.axis.toArray().map((v) => r(v, 1e6))]
}

function unpackGrip(grip: GripName, diameter: number, v: readonly number[]): GripSolution {
  const deltas: Deltas = {}
  POSED_BONES.forEach((n, i) => {
    deltas[n] = new Quaternion().setFromEuler(new Euler(v[i * 3] * DEG, v[i * 3 + 1] * DEG, v[i * 3 + 2] * DEG, 'ZYX'))
  })
  const k = POSED_BONES.length * 3
  return { grip, diameter, deltas, handle: { center: new Vector3(v[k], v[k + 1], v[k + 2]), axis: new Vector3(v[k + 3], v[k + 4], v[k + 5]) } }
}

// computeGrip at the default diameters, baked so loading the figure does not run the solver (hands.test.ts keeps it
// equal to a fresh solve; regenerate with packGrip after changing the model or the grip definitions)
const BAKED: Partial<Record<GripName, readonly number[]>> = {
  relaxed: [7.307, -47.114, -37.306, -7.984, 0, 0, -21.582, 0, 0, 15.724, 1.321, -1.303, 16.252, -1.078, 7.537, 5.315, -0.129, 2.777, 17.508, -0.625, 4.054, 23.352, -1.086, 5.25, 7.762, -0.131, 1.926, 20.928, -2.369, 7.36, 27.686, -0.958, 3.885, 9.918, -0.11, 1.268, 26.2, -2.467, 5.081, 31.84, 0.829, -2.905, 9.945, 0.09, -1.033, 0.020668, 0.105096, -0.019221, -0.015163, 0.339343, 0.94054],
  open: [-17.329, 2.144, -29.118, 1.504, 0, 0, 10.477, 0, 0, -12.575, -1.808, -10.949, -7.24, -0.214, -3.386, -3.544, -0.057, -1.853, -18.479, -0.695, -4.272, -3.897, -0.031, -0.899, -5.822, -0.074, -1.447, -21.258, 0.5, -0.051, -4.948, -0.031, -0.721, -5.951, -0.04, -0.763, -18.559, 2.271, 6.349, -7.963, 0.053, 0.763, 0, 0, 0, 0.020668, 0.105096, -0.019221, -0.015163, 0.339343, 0.94054],
  pronated: [69.379, 50.87, 87.797, 18.082, 0, 0, 25.076, 0, 0, 47.938, -0.454, 10.612, 32.325, -4.227, 14.514, 23.27, -2.464, 11.926, 47.303, -4.365, 9.946, 46.466, -4.144, 9.634, 24.809, -1.32, 5.995, 46.814, -7.052, 10.257, 37.849, -1.761, 5.134, 22.417, -0.557, 2.808, 35.203, -4.041, 5.435, 26.481, 0.578, -2.455, 16.841, 0.257, -1.733, 0.036809, 0.091271, -0.015416, -0.050886, 0.209368, 0.976512],
  supinated: [-22.362, -21.537, -36.208, 44.487, 0, 0, 1.341, 0, 0, 65.178, -4.709, 16.935, 22.407, -2.044, 10.291, 15.778, -1.135, 8.177, 58.881, -6.566, 11.606, 38.375, -2.872, 8.239, 19.562, -0.825, 4.78, 55.441, -8.618, 10.468, 32.18, -1.286, 4.455, 16.944, -0.32, 2.146, 42.268, -4.652, 4.463, 22.461, 0.418, -2.104, 8.866, 0.071, -0.922, 0.039713, 0.083773, -0.015964, -0.08562, 0.075317, 0.993477],
  neutral: [101.911, 63.586, 39.077, -52.501, 0, 0, 17.433, 0, 0, 64.442, -4.488, 16.69, 22.653, -2.089, 10.4, 16.433, -1.231, 8.509, 56.466, -6.079, 11.296, 39.62, -3.054, 8.465, 20.413, -0.897, 4.98, 51.15, -7.835, 10.393, 32.991, -1.349, 4.555, 18.804, -0.393, 2.373, 35.831, -4.1, 5.352, 20.251, 0.34, -1.906, 10.989, 0.11, -1.14, 0.040148, 0.086486, -0.017074, -0.102402, 0.007577, 0.994714],
  hook: [15.959, 22.638, 29.864, 41.056, 0, 0, 27.221, 0, 0, 46.263, 0.458, 9.326, 32.102, -4.17, 14.423, 7.548, -0.26, 3.94, 43.546, -3.728, 9.317, 36.047, -2.544, 7.807, 9.081, -0.179, 2.252, 44.67, -7.04, 10.505, 43.933, -2.344, 5.808, 26.995, -0.803, 3.343, 33.157, -4.244, 6.395, 31.621, 0.818, -2.888, 21.983, 0.435, -2.24, 0.032962, 0.093895, -0.015888, -0.042021, 0.242344, 0.96928],
  rope: [62.281, 49.34, 83.5, 21.932, 0, 0, 26.722, 0, 0, 55.97, -0.072, 12.148, 28.48, -3.291, 12.914, 21.689, -2.142, 11.146, 54.658, -5.724, 11.051, 42.685, -3.524, 9.004, 23.582, -1.194, 5.715, 56.05, -10.021, 11.246, 33.986, -1.43, 4.676, 19.782, -0.435, 2.492, 49.102, -6.856, 5.125, 26.356, 0.573, -2.445, 8.838, 0.071, -0.919, 0.037275, 0.086537, -0.013337, -0.033105, 0.275026, 0.960867],
  'd-handle': [65.895, 49.274, 86.969, 23.019, 0, 0, 31.443, 0, 0, 55.607, 1.388, 10.953, 31.227, -3.948, 14.062, 22.3, -2.264, 11.448, 51.383, -5.101, 10.58, 46.392, -4.131, 9.622, 25.125, -1.353, 6.067, 49.734, -9.587, 11.867, 38.016, -1.776, 5.153, 22.729, -0.572, 2.845, 38.33, -6.651, 8.277, 27.196, 0.609, -2.517, 16.281, 0.24, -1.677, 0.036042, 0.089769, -0.01554, -0.059689, 0.176136, 0.982554],
}

const memo = new Map<string, GripSolution>()

export function solveGrip(grip: GripName, diameter = defaultDiameter[grip]): GripSolution {
  const key = `${grip}:${diameter.toFixed(4)}`
  let s = memo.get(key)
  if (!s) {
    const baked = BAKED[grip]
    s = baked && diameter === defaultDiameter[grip] ? unpackGrip(grip, diameter, baked) : computeGrip(grip, diameter)
    memo.set(key, s)
  }
  return s
}

function eulerDeg(q: Quaternion): Vec3 {
  const e = new Euler().setFromQuaternion(q, 'ZYX')
  const r = (v: number) => Math.round((v / DEG) * 1000) / 1000
  return [r(e.x), r(e.y), r(e.z)]
}

/** Finger joint specs of a grip for one hand, to merge into a pose. */
export function gripJoints(side: HandSide, grip: GripName, diameter?: number): Record<string, JointSpec> {
  const s = solveGrip(grip, diameter)
  const out: Record<string, JointSpec> = {}
  for (const n of HAND_BONES) {
    if (n.startsWith('metacarpal') || !s.deltas[n]) continue
    const spec: JointSpec = { local: eulerDeg(s.deltas[n]) }
    out[`${n}_${side}`] = side === 'L' ? spec : mirrorSpec(spec)
  }
  return out
}

function mirrorQ(q: Quaternion) {
  return new Quaternion(q.x, -q.y, -q.z, q.w)
}

/** Poses the fingers of an already posed rig (motions, QA); the rest of the pose is left alone. */
export function applyGrip(rig: Rig, side: HandSide, grip: GripName, diameter?: number) {
  const joints = gripJoints(side, grip, diameter)
  for (const n of HAND_BONES) {
    const spec = joints[`${n}_${side}`]
    if (!spec?.local) continue
    const restQ = side === 'L' ? REST[n] : mirrorQ(REST[n])
    const d = new Quaternion().setFromEuler(new Euler(spec.local[0] * DEG, spec.local[1] * DEG, spec.local[2] * DEG, 'ZYX'))
    rig.bone(`${n}_${side}`).quaternion.copy(restQ).multiply(d)
  }
  rig.root.parent?.updateMatrixWorld(true)
}

/** The memoized grip whose finger pose the rig's hand currently shows (within half a degree), if any. */
export function detectGrip(rig: Rig, side: HandSide): GripSolution | null {
  const bones = HAND_BONES.filter((n) => !n.startsWith('metacarpal'))
  const local = bones.map((n) => rig.bones.get(`${n}_${side}`)?.quaternion)
  if (local.some((q) => !q)) return null
  for (const s of memo.values()) {
    let ok = true
    for (let i = 0; i < bones.length && ok; i++) {
      const n = bones[i]
      const want = REST[n].clone().multiply(s.deltas[n] ?? new Quaternion()).normalize()
      if ((side === 'L' ? want : mirrorQ(want)).angleTo(local[i]!.clone().normalize()) > 0.5 * DEG) ok = false
    }
    if (ok) return s
  }
  return null
}

/** Handle axis of a grip in a wrist frame of the given side (the right hand mirrors x). */
export function handleInWrist(s: GripSolution, side: HandSide) {
  const m = (v: Vector3) => (side === 'L' ? v.clone() : new Vector3(-v.x, v.y, v.z))
  return { center: m(s.handle.center), axis: m(s.handle.axis), palmar: m(PALM_N) }
}

/** capsule gaps against the handle per segment (m, negative = overlap), left hand; QA and tests */
export function gripGaps(s: GripSolution) {
  const fr = fk(s.deltas)
  const R = s.diameter / 2
  const out: Record<string, number> = {}
  for (const n of HAND_BONES) {
    if (n.startsWith('metacarpal') || n === 'finger1-1') continue
    const c = capsule(fr, n)
    out[n] = segLine(c.a, c.b, s.handle.center, s.handle.axis) - (R + c.r)
  }
  return out
}

