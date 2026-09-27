// Numeric QA gates over every baked frame. Pure functions so tests can inject faults.
import { frameImplements, frameQ, staleReason, type Baked, type CompactMotion } from '../../src/motion/bake.ts'
import { bodyCapsules, boundClearance, capsuleClearance, capsuleSolidClearance, placeParts, segmentDistance, type Capsule } from '../../src/motion/collide.ts'
import { centerOfPressure, fk, sitePos, type FK } from '../../src/motion/fk.ts'
import { cableForce, comWorld, siteWorld, type Part } from '../../src/motion/implements.ts'
import { add, dist, qconj, qlog, qmul, qrot, scale, type V3 } from '../../src/motion/math.ts'
import { pairedDofs, zeroQ, type ImplementPose, type Skeleton } from '../../src/motion/skeleton.ts'
import { machineColliders } from '../../src/features/figure/props/collision.ts'

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

export type Frames = { q: Float64Array[]; f: FK[]; impl: ReturnType<typeof frameImplements>[] }

export function frames(b: Baked, skel: Skeleton): Frames {
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
      const [min, max] = b.limits?.[d.name] ?? [d.min, d.max]
      const e = Math.max(0, v - max, min - v)
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
      const forces = (b.cables ?? []).map((c) => cableForce(c, impl.find((x) => x.id === c.implement)!))
      const [x, z] = centerOfPressure(skel, f, loads, forces)
      point = [x, 0, z]
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
    vals.push({ v: Math.abs(point[2] - support - (spec.target ?? 0)) * 1000, frame: i })
  }
  return [worst(spec.target ? `balance (forward offset from ${Math.round(spec.target * 1000)} mm)` : 'balance (forward offset)', 'mm', spec.tol * 1000, vals)]
}


// ---------- penetration ----------

/**
 * Tolerated penetration per body-region pair, mm. Hard contacts 3 mm; soft tissue that legitimately compresses
 * (upper arm on the lats, thigh on the belly in deep flexion, elbows inside the knees) 8-15 mm. `same`/`other`
 * restrict to the same or the opposite side; adjacent segments (upper arm and forearm of one arm, shoulder line
 * and upper arm) and the trunk-neck-head chain are not checked.
 */
export const BODY_PAIRS: [string, string, 'any' | 'same' | 'other', number][] = [
  ['upperarm', 'trunk', 'any', 12], ['forearm', 'trunk', 'any', 10], ['hand', 'trunk', 'any', 10],
  ['upperarm', 'head', 'any', 10], ['upperarm', 'neck', 'any', 10], ['forearm', 'head', 'any', 5], ['forearm', 'neck', 'any', 8],
  ['hand', 'head', 'any', 3], ['hand', 'neck', 'any', 5], ['hand', 'girdle', 'any', 10], ['forearm', 'girdle', 'any', 10],
  ['hand', 'thigh', 'any', 8], ['forearm', 'thigh', 'any', 12], ['upperarm', 'thigh', 'any', 12],
  ['hand', 'shank', 'any', 8], ['forearm', 'shank', 'any', 10], ['thigh', 'trunk', 'any', 15],
  ['hand', 'upperarm', 'same', 10], ['hand', 'upperarm', 'other', 5], ['forearm', 'upperarm', 'other', 8],
  ['hand', 'forearm', 'other', 5], ['hand', 'hand', 'other', 5], ['forearm', 'forearm', 'other', 8], ['upperarm', 'upperarm', 'other', 10],
  ['thigh', 'thigh', 'other', 15], ['shank', 'shank', 'other', 10], ['thigh', 'shank', 'other', 10], ['foot', 'foot', 'other', 3], ['foot', 'shank', 'other', 5],
]

export const PROP_TOL = {
  /** metal and frames */
  rigid: 3,
  /** bench pads, seats, knee pads, foot plates */
  pad: 15,
  /** the cable line against the body */
  cable: 10,
}

/** cylinders up to this radius on an implement a hand grips are handles or uprights it wraps (heads, plates, sleeves are not) */
export const HANDLE_R = 0.03

/** capsule pairs overlapping more than this standing relaxed are anatomical junctions (arm root, hip), not contacts */
export const JUNCTION_MM = 25

/**
 * Segment pairs that fold into each other about a joint: in hip flexion the thigh root presses into the belly below
 * the navel (the crease runs from the hip bone to the groin), so those are not checked. Between navel and ribs the
 * belly still gives way: every deep squat on this mesh puts 45-60 mm of thigh into it (vertex depth, rigid
 * skinning), so it gets 60 mm; the ribs and chest keep the 15 mm thigh-trunk default.
 */
const JUNCTION_SEGMENTS = [/^femur_[lr]\|(pelvis|lumbar1|lumbar2)$/]
/**
 * The upper chest at the arm root is the pec and lat folds of the armpit: they bunch when the arm is raised
 * forward or pulled in, so the upper arm gets 20 mm there instead of 12.
 */
const SEGMENT_TOL: [RegExp, number][] = [[/^femur_[lr]\|lumbar3$/, 60], [/^humerus_[lr]\|thorax2$/, 20]]

const baseOf = (region: string) => region.replace(/_[lr]$/, '')
const sideOf = (region: string) => region.match(/_([lr])$/)?.[1]

function bodyTol(ra: string, rb: string): number | null {
  const [ba, bb] = [baseOf(ra), baseOf(rb)]
  const [sa, sb] = [sideOf(ra), sideOf(rb)]
  for (const [x, y, rel, tol] of BODY_PAIRS) {
    if (!((ba === x && bb === y) || (ba === y && bb === x))) continue
    if (rel === 'same' && !(sa && sa === sb)) continue
    if (rel === 'other' && !(sa && sb && sa !== sb)) continue
    return tol
  }
  return null
}

type BodyPair = { i: number; j: number; label: string; tol: number; allowance: number }

/** a capsule around a placed part (a box along its longest side), a tight lower bound for culling long frame tubes */
function enclosing(part: Part, pose: ImplementPose): Pick<Capsule, 'a' | 'b' | 'r'> {
  const w = (v: V3) => add(pose.pos, qrot(pose.rot, v))
  if (part.shape === 'cylinder') return { a: w(part.a), b: w(part.b), r: part.r }
  const k = part.size.indexOf(Math.max(...part.size))
  const axis: V3 = [0, 0, 0]
  axis[k] = part.size[k] / 2
  const u = qrot(part.rot ?? [0, 0, 0, 1], axis)
  const r = Math.hypot(...part.size.filter((_, j) => j !== k)) / 2
  return { a: w(add(part.center, scale(u, -1))), b: w(add(part.center, u)), r }
}

const pairCache = new WeakMap<Skeleton, BodyPair[]>()

/** body capsule pairs to check, with the overlap they already have standing relaxed (zero pose) as an allowance */
export function bodyPairs(skel: Skeleton): BodyPair[] {
  let out = pairCache.get(skel)
  if (out) return out
  out = []
  const rest = bodyCapsules(skel, fk(skel, zeroQ(skel)))
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) {
      const tol = bodyTol(rest[i].region, rest[j].region)
      if (tol === null) continue
      const segs = [`${rest[i].segment}|${rest[j].segment}`, `${rest[j].segment}|${rest[i].segment}`]
      if (JUNCTION_SEGMENTS.some((re) => segs.some((x) => re.test(x)))) continue
      const c = capsuleClearance(rest[i], rest[j]) * 1000
      if (c < -JUNCTION_MM) continue
      const [a, b] = [rest[i].region, rest[j].region].sort()
      const override = SEGMENT_TOL.find(([re]) => segs.some((x) => re.test(x)))?.[1]
      const trunkSeg = rest[i].region === 'trunk' ? rest[i].segment : rest[j].segment
      out.push({ i, j, label: override ? `${a} / ${b} (${trunkSeg})` : `${a} / ${b}`, tol: override ?? tol, allowance: Math.max(0, -c) })
    }
  }
  pairCache.set(skel, out)
  return out
}

export type Clearance = {
  pair: string
  /** prop: the template's implements and cables; machine: the drawn machines and benches around them */
  kind: 'body' | 'prop' | 'machine'
  /** smallest clearance over the loop, mm (negative = penetration) */
  min: number
  frame: number
  tol: number
  /** overlap the pair already has in the relaxed standing pose, mm */
  allowance: number
  /** penetration beyond allowance + tolerance, mm (0 = within) */
  excess: number
}

/**
 * closest approach per body-region pair, per body region vs implement part (or cable) and per body region vs drawn
 * machine part (props/collision.ts: frames, rails, stacks, plates, pads where the composer draws them), over every frame
 */
export function clearances(b: Baked, skel: Skeleton, F?: Frames): Clearance[] {
  F ??= frames(b, skel)
  const pairs = bodyPairs(skel)
  const machines = machineColliders(b)
  const rows = new Map<string, Clearance>()
  const note = (pair: string, kind: Clearance['kind'], mm: number, frame: number, tol: number, allowance: number) => {
    const excess = Math.max(0, -mm - allowance - tol)
    const r = rows.get(pair)
    // keep the frame with the worst excess, then the smallest clearance
    if (!r || excess > r.excess || (excess === r.excess && mm + allowance < r.min + r.allowance)) rows.set(pair, { pair, kind, min: mm, frame, tol, allowance, excess })
  }
  const grips = new Map<string, Set<string>>()
  for (const c of b.contacts) {
    if (c.kind !== 'grip' || !('implement' in c.target)) continue
    const side = c.site.match(/_([lr])$/)?.[1]
    if (!side || !/^(grip|fingers)_/.test(c.site)) continue
    if (!grips.has(c.target.implement)) grips.set(c.target.implement, new Set())
    grips.get(c.target.implement)!.add(`hand_${side}`)
  }
  const REACH = 0.25
  // drawn machines hold hundreds of parts; only near ones make useful rows
  const MACHINE_REACH = 0.1
  for (let i = 0; i < b.frames; i++) {
    const caps = bodyCapsules(skel, F.f[i])
    for (const p of pairs) note(p.label, 'body', round(capsuleClearance(caps[p.i], caps[p.j]) * 1000), i, p.tol, p.allowance)
    b.implements.forEach((spec, k) => {
      const solids = placeParts(spec, F.impl[i][k])
      const held = grips.get(spec.id)
      const rest = b.rests?.find((r) => r.implement === spec.id)
      for (const s of solids) {
        const label = `${spec.id}#${s.index}`
        for (const c of caps) {
          if (held?.has(c.region) && s.part.shape === 'cylinder' && s.part.r <= HANDLE_R) continue
          const bound = boundClearance(c, s)
          if (bound > REACH) continue
          const tol = s.part.pad ? PROP_TOL.pad : rest?.regions.includes(c.region) ? rest.tol : PROP_TOL.rigid
          note(`${c.region} / ${label}`, 'prop', round(capsuleSolidClearance(c, s) * 1000), i, tol, 0)
        }
      }
    })
    const poses = new Map<string, ImplementPose>(F.impl[i].map((p) => [p.id, p]))
    for (const m of machines) {
      const { pose, colliders } = m.at(poses)
      const held = new Set(m.holds.flatMap((id) => [...(grips.get(id) ?? [])]))
      for (const s of placeParts({ id: m.key, kind: 'bench', mass: 0, com: [0, 0, 0], parts: colliders, sites: {} }, pose)) {
        const label = `${m.key}:${colliders[s.index].kind}#${s.index}`
        const hull = enclosing(s.part, pose)
        for (const c of caps) {
          if (held.has(c.region) && s.part.shape === 'cylinder' && s.part.r <= HANDLE_R) continue
          if (capsuleClearance(c, hull) > MACHINE_REACH) continue
          note(`${c.region} / ${label}`, 'machine', round(capsuleSolidClearance(c, s) * 1000), i, s.part.pad ? PROP_TOL.pad : PROP_TOL.rigid, 0)
        }
      }
    }
    for (const cable of b.cables ?? []) {
      const k = b.implements.findIndex((x) => x.id === cable.implement)
      const { at } = cableForce(cable, F.impl[i][k])
      const line: Capsule = { name: 'cable', region: 'cable', segment: '', a: cable.pulley, b: at, r: 0.003 }
      const held = grips.get(cable.implement)
      for (const c of caps) {
        if (held?.has(c.region)) continue
        const mm = (segmentDistance(c.a, c.b, line.a, line.b).d - c.r - line.r) * 1000
        if (mm > REACH * 1000) continue
        note(`${c.region} / cable:${cable.implement}`, 'prop', round(mm), i, PROP_TOL.cable, 0)
      }
    }
  }
  return [...rows.values()].sort((x, y) => y.excess - x.excess || x.min + x.allowance - (y.min + y.allowance))
}

function penetrationGates(b: Baked, skel: Skeleton, F: Frames): Gate[] {
  const rows = clearances(b, skel, F)
  const gate = (kind: Clearance['kind'], name: string): Gate => {
    const mine = rows.filter((r) => r.kind === kind)
    const w = mine[0]
    const value = w ? round(w.excess) : 0
    const detail = w ? `${w.pair} clearance ${w.min} mm${w.allowance ? ` (relaxed ${round(-w.allowance)})` : ''}, tol ${w.tol}` : undefined
    return { name, unit: 'mm past tol', limit: 0, value, frame: w?.frame, detail, pass: value <= 0 }
  }
  return [gate('body', 'penetration body-body'), gate('prop', 'penetration body-prop'), gate('machine', 'penetration body-machine')]
}

// ---------- skeleton freshness ----------

/** a baked file must have been baked against the current skeleton */
export function skeletonGate(c: CompactMotion, skel: Skeleton): Gate {
  const why = staleReason(c, skel)
  return { name: 'skeleton hash', unit: '', limit: 0, value: why ? 1 : 0, pass: !why, detail: why ?? c.skeleton }
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
    ...penetrationGates(b, skel, F),
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

