// Numeric QA gates over every baked frame. Pure functions so tests can inject faults.
import { frameImplements, frameQ, type Baked } from '../../src/motion/bake.ts'
import { centerOfMass, fk, sitePos, type FK } from '../../src/motion/fk.ts'
import { comWorld, siteWorld } from '../../src/motion/implements.ts'
import { dist, qconj, qlog, qmul, type V3 } from '../../src/motion/math.ts'
import { pairedDofs, type Skeleton } from '../../src/motion/skeleton.ts'

export type Gate = {
  name: string
  pass: boolean
  value: number
  limit: number
  unit: string
  frame?: number
  detail?: string
}

export const LIMITS = {
  footMm: 5,
  gripMm: 5,
  limitTolDeg: 0.5,
  hingeMinDeg: -2,
  /** DOF angular acceleration and jerk, per second^2 / second^3 */
  accelDeg: 4000,
  jerkDeg: 60000,
  /** segment angular velocity / acceleration, rad/s and rad/s^2 */
  segOmega: 20,
  segAlpha: 100,
  symmetryDeg: 1,
  symmetryMm: 5,
  seamRatio: 1.5,
  sizeBytes: 12 * 1024,
}

type Frames = { q: Float64Array[]; f: FK[]; impl: ReturnType<typeof frameImplements>[] }

function frames(b: Baked, skel: Skeleton): Frames {
  const q: Float64Array[] = [], f: FK[] = [], impl: ReturnType<typeof frameImplements>[] = []
  for (let i = 0; i < b.frames; i++) {
    q.push(frameQ(b, i))
    f.push(fk(skel, q[i]))
    impl.push(frameImplements(b, i))
  }
  return { q, f, impl }
}

const worst = (name: string, unit: string, limit: number, vals: { v: number; frame: number; detail?: string }[], le = true): Gate => {
  const w = vals.reduce((a, x) => (x.v > a.v ? x : a), { v: 0, frame: -1 } as { v: number; frame: number; detail?: string })
  return { name, unit, limit, value: round(w.v), frame: w.frame >= 0 ? w.frame : undefined, detail: w.detail, pass: le ? w.v <= limit : w.v >= limit }
}

const round = (x: number) => Math.round(x * 1000) / 1000

/** humeral axial rotation (and the swing chart) is undefined near the swing-twist pole at 180 deg elevation */
export const POLE_ELEV = 160
function nearPole(skel: Skeleton, q: Float64Array, name: string) {
  const m = /^shoulder_([lr])\.(rot|swing_x|swing_z)$/.exec(name)
  return !!m && q[skel.dof[`shoulder_${m[1]}.elev`]] > POLE_ELEV
}

function contactGates(b: Baked, skel: Skeleton, F: Frames): Gate[] {
  const drift: { v: number; frame: number; detail?: string }[] = []
  const slip: { v: number; frame: number; detail?: string }[] = []
  const grip: { v: number; frame: number; detail?: string }[] = []
  for (const c of b.contacts) {
    const first = sitePos(skel, F.f[0], c.site)
    for (let i = 0; i < b.frames; i++) {
      const p = sitePos(skel, F.f[i], c.site)
      let target: V3
      if ('world' in c.target) target = c.target.world
      else {
        const { implement, grip: g } = c.target
        const spec = b.implements.find((s) => s.id === implement)!
        const pose = F.impl[i].find((x) => x.id === implement)!
        target = siteWorld(spec, pose, g).pos
      }
      const e = dist(p, target) * 1000
      if (c.kind === 'grip') grip.push({ v: e, frame: i, detail: c.site })
      else {
        drift.push({ v: e, frame: i, detail: c.site })
        slip.push({ v: dist(p, first) * 1000, frame: i, detail: c.site })
      }
    }
  }
  const out: Gate[] = []
  if (drift.length) {
    out.push(worst('foot target error', 'mm', LIMITS.footMm, drift))
    out.push(worst('foot slip', 'mm', LIMITS.footMm, slip))
  }
  if (grip.length) out.push(worst('grip error', 'mm', LIMITS.gripMm, grip))
  return out
}

function limitGates(b: Baked, skel: Skeleton, F: Frames): Gate[] {
  const over: { v: number; frame: number; detail?: string }[] = []
  const hinge: { v: number; frame: number; detail?: string }[] = []
  for (let i = 0; i < b.frames; i++) {
    for (const d of skel.dofs) {
      if (d.unit !== 'deg') continue
      if (nearPole(skel, F.q[i], d.name)) continue
      const v = F.q[i][d.index]
      const e = Math.max(0, v - d.max, d.min - v)
      over.push({ v: e, frame: i, detail: `${d.name}=${v.toFixed(1)}` })
      if (/^(knee|elbow)_[lr]\.flex$/.test(d.name)) hinge.push({ v: -v, frame: i, detail: d.name })
    }
  }
  return [worst('joint limits', 'deg over', LIMITS.limitTolDeg, over), worst('knee/elbow hyperextension', 'deg', -LIMITS.hingeMinDeg, hinge)]
}

/** cyclic finite differences of a scalar channel */
function diffs(x: number[]) {
  const n = x.length
  const at = (i: number) => x[((i % n) + n) % n]
  const v = x.map((_, i) => at(i + 1) - at(i))
  const a = x.map((_, i) => at(i + 1) - 2 * at(i) + at(i - 1))
  const j = x.map((_, i) => at(i + 2) - 3 * at(i + 1) + 3 * at(i) - at(i - 1))
  return { v, a, j }
}

function flipGates(b: Baked, skel: Skeleton, F: Frames): Gate[] {
  const fps = b.frames / b.duration
  const acc: { v: number; frame: number; detail?: string }[] = []
  const jerk: { v: number; frame: number; detail?: string }[] = []
  // shoulder plane is ill-conditioned near zero elevation (swing-twist pole): test the swing as a smooth 2-D chart
  const channels: { name: string; x: number[] }[] = []
  for (const d of skel.dofs) {
    if (d.unit !== 'deg') continue
    if (d.key === 'plane' || (d.joint.startsWith('shoulder_') && d.key === 'elev')) continue
    channels.push({ name: d.name, x: F.q.map((q) => q[d.index]) })
  }
  for (const s of ['l', 'r']) {
    const pl = skel.dof[`shoulder_${s}.plane`], el = skel.dof[`shoulder_${s}.elev`]
    channels.push({ name: `shoulder_${s}.swing_x`, x: F.q.map((q) => q[el] * Math.cos((q[pl] * Math.PI) / 180)) })
    channels.push({ name: `shoulder_${s}.swing_z`, x: F.q.map((q) => q[el] * Math.sin((q[pl] * Math.PI) / 180)) })
  }
  const n = b.frames
  for (const { name, x } of channels) {
    const { a, j } = diffs(x)
    const masked = (i: number) => [-1, 0, 1, 2].some((k) => nearPole(skel, F.q[(i + k + n) % n], name))
    a.forEach((v, i) => masked(i) || acc.push({ v: Math.abs(v) * fps * fps, frame: i, detail: name }))
    j.forEach((v, i) => masked(i) || jerk.push({ v: Math.abs(v) * fps * fps * fps, frame: i, detail: name }))
  }
  const omega: { v: number; frame: number; detail?: string }[] = []
  const alpha: { v: number; frame: number; detail?: string }[] = []
  for (const s of skel.segments) {
    const w: V3[] = []
    for (let i = 0; i < b.frames; i++) {
      const r0 = F.f[i].rot[s.index], r1 = F.f[(i + 1) % b.frames].rot[s.index]
      const lw = qlog(qmul(r1, qconj(r0)))
      w.push([lw[0] * fps, lw[1] * fps, lw[2] * fps])
    }
    for (let i = 0; i < b.frames; i++) {
      omega.push({ v: Math.hypot(...w[i]), frame: i, detail: s.name })
      alpha.push({ v: dist(w[(i + 1) % b.frames], w[i]) * fps, frame: i, detail: s.name })
    }
  }
  return [
    worst('DOF acceleration (flip)', 'deg/s2', LIMITS.accelDeg, acc),
    worst('DOF jerk (flip)', 'deg/s3', LIMITS.jerkDeg, jerk),
    worst('segment angular velocity', 'rad/s', LIMITS.segOmega, omega),
    worst('segment angular acceleration (flip)', 'rad/s2', LIMITS.segAlpha, alpha),
  ]
}

function seamGates(b: Baked, skel: Skeleton, F: Frames): Gate[] {
  const n = b.frames
  let jumpRatio = 0, velRatio = 0
  let detail = ''
  for (const d of skel.dofs) {
    const x = F.q.map((q) => q[d.index])
    const step = Math.max(...x.slice(1).map((v, i) => Math.abs(v - x[i])))
    const acc = Math.max(...x.slice(2).map((v, i) => Math.abs(v - 2 * x[i + 1] + x[i])))
    const scale = d.unit === 'm' ? 0.0001 : 0.01
    const seamStep = Math.abs(x[0] - x[n - 1])
    const seamAcc = Math.max(Math.abs(x[1] - 2 * x[0] + x[n - 1]), Math.abs(x[0] - 2 * x[n - 1] + x[n - 2]))
    const jr = seamStep / (step + scale)
    const vr = seamAcc / (acc + scale)
    if (jr > jumpRatio) [jumpRatio, detail] = [jr, d.name]
    velRatio = Math.max(velRatio, vr)
  }
  return [
    { name: 'loop seam position', unit: 'x max step', limit: LIMITS.seamRatio, value: round(jumpRatio), pass: jumpRatio <= LIMITS.seamRatio, detail },
    { name: 'loop seam velocity', unit: 'x max accel', limit: LIMITS.seamRatio, value: round(velRatio), pass: velRatio <= LIMITS.seamRatio },
  ]
}

const MIDLINE_ASYM = ['pelvis.rot', 'pelvis.list', 'lumbar.bend', 'lumbar.rot', 'thorax.bend', 'thorax.rot', 'neck.bend', 'neck.rot', 'head.bend', 'head.rot']

function symmetryGates(b: Baked, skel: Skeleton, F: Frames): Gate[] {
  if (!b.symmetric) return []
  const pairs = pairedDofs(skel)
  const deg: { v: number; frame: number; detail?: string }[] = []
  const mm: { v: number; frame: number; detail?: string }[] = []
  for (let i = 0; i < b.frames; i++) {
    for (const [l, r] of pairs) if (skel.dofs[l].unit === 'deg') deg.push({ v: Math.abs(F.q[i][l] - F.q[i][r]), frame: i, detail: skel.dofs[l].name })
    for (const n of MIDLINE_ASYM) deg.push({ v: Math.abs(F.q[i][skel.dof[n]]), frame: i, detail: n })
    mm.push({ v: Math.abs(F.q[i][skel.dof['pelvis.tx']]) * 1000, frame: i, detail: 'pelvis.tx' })
  }
  return [worst('bilateral symmetry', 'deg', LIMITS.symmetryDeg, deg), worst('midline drift', 'mm', LIMITS.symmetryMm, mm)]
}

function balanceGates(b: Baked, skel: Skeleton, F: Frames): Gate[] {
  const spec = b.balance
  if (!spec) return []
  const vals: { v: number; frame: number; detail?: string }[] = []
  for (let i = 0; i < b.frames; i++) {
    const f = F.f[i]
    const impl = F.impl[i]
    let point: V3
    if (spec.point === 'com') {
      const loads = b.implements.filter((s) => s.mass > 0).map((s) => ({ mass: s.mass, pos: comWorld(s, impl.find((x) => x.id === s.id)!) }))
      point = centerOfMass(skel, f, loads)
    } else {
      const id = spec.point.implement
      point = comWorld(b.implements.find((s) => s.id === id)!, impl.find((x) => x.id === id)!)
    }
    let support: number
    if (spec.over === 'midfoot') {
      const feet = ['l', 'r'].map((s) => sitePos(skel, f, `midfoot_${s}`))
      support = (feet[0][2] + feet[1][2]) / 2
    } else {
      const { implement, sites } = spec.over
      const s = b.implements.find((x) => x.id === implement)!
      const pose = impl.find((x) => x.id === implement)!
      support = sites.reduce((a, n) => a + siteWorld(s, pose, n).pos[2], 0) / sites.length
    }
    vals.push({ v: Math.abs(point[2] - support) * 1000, frame: i })
  }
  return [worst('balance (forward offset)', 'mm', spec.tol * 1000, vals)]
}

export function runGates(b: Baked, skel: Skeleton, sizeBytes?: number): Gate[] {
  const F = frames(b, skel)
  const gates = [
    ...contactGates(b, skel, F),
    ...limitGates(b, skel, F),
    ...flipGates(b, skel, F),
    ...seamGates(b, skel, F),
    ...symmetryGates(b, skel, F),
    ...balanceGates(b, skel, F),
  ]
  if (sizeBytes !== undefined) gates.push({ name: 'compact size', unit: 'bytes', limit: LIMITS.sizeBytes, value: sizeBytes, pass: sizeBytes <= LIMITS.sizeBytes })
  return gates
}

/** per-DOF range over the loop, for the report */
export function romTable(b: Baked, skel: Skeleton): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {}
  for (const d of skel.dofs) {
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < b.frames; i++) {
      const v = b.q[i * b.nDof + d.index]
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    if (hi - lo > (d.unit === 'm' ? 0.001 : 0.5)) out[d.name] = [round(lo), round(hi)]
  }
  return out
}

