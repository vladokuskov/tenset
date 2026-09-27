import type { ImplementSpec } from './implements.ts'
import { qdot, qnorm, type Quat, type V3 } from './math.ts'
import type { Contact, ImplementPose, Pose, Skeleton } from './skeleton.ts'
import type { AnyTemplate, BalanceSpec } from './templates/types.ts'
import { frameCount, loopDuration, type Tempo } from './timing.ts'

// Baked loop: every DOF plus implement transforms (position + quaternion) at a fixed rate; frame i sits at loop
// fraction i / frames. The compact form quantizes each channel to a fixed step and stores second differences as
// zigzag varints in base64, which keeps a typical exercise at a few KB.

export type Baked = {
  template: string
  params: Record<string, unknown>
  fps: number
  frames: number
  duration: number
  tempo: Tempo
  nDof: number
  /** frames x nDof */
  q: Float32Array
  implements: ImplementSpec[]
  /** frames x implements x [px, py, pz, qx, qy, qz, qw] */
  ip: Float32Array
  contacts: Contact[]
  balance?: BalanceSpec
  symmetric: boolean
}

export function bake(t: AnyTemplate, params: Record<string, unknown>, skel: Skeleton, fps = 30): Baked {
  const setup = t.setup(params, skel)
  const n = frameCount(setup.tempo, fps)
  const nd = skel.dofs.length
  const ni = setup.implements.length
  const q = new Float32Array(n * nd)
  const ip = new Float32Array(n * ni * 7)
  const prev: Quat[] = []
  for (let i = 0; i < n; i++) {
    const pose = t.sample(i / n, params, skel)
    q.set(pose.q, i * nd)
    setup.implements.forEach((spec, k) => {
      const p = pose.implements.find((x) => x.id === spec.id)
      if (!p) throw new Error(`${t.id}: frame ${i} has no pose for implement ${spec.id}`)
      let r = qnorm(p.rot)
      if (prev[k] && qdot(prev[k], r) < 0) r = [-r[0], -r[1], -r[2], -r[3]]
      prev[k] = r
      ip.set([...p.pos, ...r], (i * ni + k) * 7)
    })
  }
  return {
    template: t.id,
    params,
    fps,
    frames: n,
    duration: loopDuration(setup.tempo),
    tempo: setup.tempo,
    nDof: nd,
    q,
    implements: setup.implements,
    ip,
    contacts: setup.contacts,
    balance: setup.balance,
    symmetric: setup.symmetric,
  }
}

export function frameQ(b: Baked, i: number): Float64Array {
  const k = ((i % b.frames) + b.frames) % b.frames
  return Float64Array.from(b.q.subarray(k * b.nDof, (k + 1) * b.nDof))
}

export function frameImplements(b: Baked, i: number): ImplementPose[] {
  const k = ((i % b.frames) + b.frames) % b.frames
  const ni = b.implements.length
  return b.implements.map((spec, j) => {
    const o = (k * ni + j) * 7
    const a = b.ip
    return { id: spec.id, pos: [a[o], a[o + 1], a[o + 2]] as V3, rot: [a[o + 3], a[o + 4], a[o + 5], a[o + 6]] as Quat }
  })
}

export function framePose(b: Baked, i: number): Pose {
  return { q: frameQ(b, i), implements: frameImplements(b, i), contacts: b.contacts }
}

const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))

/** pose at time t (seconds, wraps) by cyclic Catmull-Rom between baked frames; for live playback and scrubbing */
export function sampler(b: Baked): (t: number) => Pose {
  const n = b.frames
  const ni = b.implements.length
  return (t: number) => {
    const u = t / b.duration
    const x = (u - Math.floor(u)) * n
    const i1 = Math.floor(x) % n
    const f = x - Math.floor(x)
    const i0 = (i1 - 1 + n) % n, i2 = (i1 + 1) % n, i3 = (i1 + 2) % n
    const q = new Float64Array(b.nDof)
    for (let d = 0; d < b.nDof; d++) q[d] = cr(b.q[i0 * b.nDof + d], b.q[i1 * b.nDof + d], b.q[i2 * b.nDof + d], b.q[i3 * b.nDof + d], f)
    const implements_: ImplementPose[] = b.implements.map((spec, j) => {
      const v = new Array<number>(7)
      for (let c = 0; c < 7; c++) {
        const at = (i: number) => b.ip[(i * ni + j) * 7 + c]
        v[c] = cr(at(i0), at(i1), at(i2), at(i3), f)
      }
      return { id: spec.id, pos: [v[0], v[1], v[2]], rot: qnorm([v[3], v[4], v[5], v[6]]) }
    })
    return { q, implements: implements_, contacts: b.contacts }
  }
}

// ---------- compact shipping format ----------

export const STEP = { deg: 0.01, m: 0.00005, ratio: 0.001, quat: 0.00005 } as const

export type CompactMotion = {
  format: 'gym-motion'
  v: 1
  template: string
  params: Record<string, unknown>
  fps: number
  frames: number
  duration: number
  tempo: Tempo
  /** DOF count and skeleton model hash the channels were baked against */
  dofs: number
  skeleton: string
  /** channel ids that vary: 0..dofs-1 are DOFs, then 7 per implement */
  vary: number[]
  /** [channel, value] for constant non-zero channels */
  fixed: [number, number][]
  data: string
  implements: ImplementSpec[]
  contacts: Contact[]
  balance?: BalanceSpec
  symmetric: boolean
}

function channelStep(skel: Skeleton, ch: number): number {
  if (ch < skel.dofs.length) return STEP[skel.dofs[ch].unit]
  return (ch - skel.dofs.length) % 7 < 3 ? STEP.m : STEP.quat
}

function channelValues(b: Baked, ch: number): Float32Array {
  const out = new Float32Array(b.frames)
  if (ch < b.nDof) for (let i = 0; i < b.frames; i++) out[i] = b.q[i * b.nDof + ch]
  else {
    const k = ch - b.nDof
    for (let i = 0; i < b.frames; i++) out[i] = b.ip[i * b.implements.length * 7 + k]
  }
  return out
}

function writeVarint(out: number[], v: number) {
  let z = v >= 0 ? v * 2 : -v * 2 - 1
  while (z >= 0x80) {
    out.push((z % 0x80) | 0x80)
    z = Math.floor(z / 0x80)
  }
  out.push(z)
}

function toBase64(bytes: number[]): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.slice(i, i + 0x8000))
  return btoa(s)
}

const round = (x: number, d = 5) => Math.round(x * 10 ** d) / 10 ** d
const roundDeep = <T>(v: T): T => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'number' ? round(x) : x)))

export function encode(b: Baked, skel: Skeleton): CompactMotion {
  const channels = b.nDof + b.implements.length * 7
  const vary: number[] = []
  const fixed: [number, number][] = []
  const bytes: number[] = []
  for (let ch = 0; ch < channels; ch++) {
    const step = channelStep(skel, ch)
    const ints = Array.from(channelValues(b, ch), (x) => Math.round(x / step))
    if (ints.every((x) => x === ints[0])) {
      if (ints[0] !== 0) fixed.push([ch, round(ints[0] * step, 6)])
      continue
    }
    vary.push(ch)
    for (let i = 0; i < ints.length; i++) writeVarint(bytes, i === 0 ? ints[0] : i === 1 ? ints[1] - ints[0] : ints[i] - 2 * ints[i - 1] + ints[i - 2])
  }
  return {
    format: 'gym-motion',
    v: 1,
    template: b.template,
    params: b.params,
    fps: b.fps,
    frames: b.frames,
    duration: round(b.duration, 4),
    tempo: b.tempo,
    dofs: b.nDof,
    skeleton: skel.data.source.sha256.slice(0, 12),
    vary,
    fixed,
    data: toBase64(bytes),
    implements: roundDeep(b.implements),
    contacts: roundDeep(b.contacts),
    balance: b.balance,
    symmetric: b.symmetric,
  }
}

export function decode(c: CompactMotion, skel: Skeleton): Baked {
  if (c.format !== 'gym-motion' || c.v !== 1) throw new Error('not a gym-motion v1 file')
  if (c.dofs !== skel.dofs.length) throw new Error(`motion baked for ${c.dofs} DOFs, skeleton has ${skel.dofs.length}`)
  const n = c.frames
  const ni = c.implements.length
  const q = new Float32Array(n * c.dofs)
  const ip = new Float32Array(n * ni * 7)
  const put = (ch: number, i: number, v: number) => {
    if (ch < c.dofs) q[i * c.dofs + ch] = v
    else ip[i * ni * 7 + (ch - c.dofs)] = v
  }
  for (const [ch, v] of c.fixed) for (let i = 0; i < n; i++) put(ch, i, v)
  const bin = atob(c.data)
  let pos = 0
  const readVarint = () => {
    let z = 0, mul = 1, byte = 0
    do {
      byte = bin.charCodeAt(pos++)
      z += (byte & 0x7f) * mul
      mul *= 0x80
    } while (byte & 0x80)
    return z % 2 === 0 ? z / 2 : -(z + 1) / 2
  }
  for (const ch of c.vary) {
    const step = channelStep(skel, ch)
    let x0 = 0, x1 = 0
    for (let i = 0; i < n; i++) {
      const d = readVarint()
      const v = i === 0 ? d : i === 1 ? x1 + d : 2 * x1 - x0 + d
      x0 = x1
      x1 = v
      put(ch, i, v * step)
    }
  }
  return {
    template: c.template,
    params: c.params,
    fps: c.fps,
    frames: n,
    duration: c.duration,
    tempo: c.tempo,
    nDof: c.dofs,
    q,
    implements: c.implements,
    ip,
    contacts: c.contacts,
    balance: c.balance,
    symmetric: c.symmetric,
  }
}

/** serialized size in bytes of the compact JSON */
export function compactSize(c: CompactMotion) {
  return new TextEncoder().encode(JSON.stringify(c)).length
}
