// Numeric QA gates over every baked frame. Pure functions so tests can inject faults.
import { frameImplements, frameQ, staleReason, type Baked, type CompactMotion } from '../../src/motion/bake.ts'
import { bodyCapsules, boundClearance, capsuleClearance, capsuleSolidClearance, enclosingCapsule, placeParts, segmentDistance, solidClearance, type Capsule, type Solid } from '../../src/motion/collide.ts'
import { centerOfPressure, fk, sitePos, type FK } from '../../src/motion/fk.ts'
import { cableForce, comWorld, siteWorld, type ImplementSpec, type Part } from '../../src/motion/implements.ts'
import { bandPath, isBand, isRingStrap, strapPath, MOVING_KINDS } from '../../src/motion/implements/index.ts'
import { add, dist, qconj, qlog, qmul, qrot, scale, sub, type V3 } from '../../src/motion/math.ts'
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

/**
 * A foot with no planted contact that touches down (a stepping loop: lateral band walk, lunges stepping out and back)
 * must stay put while it is down: the heel and the ball sites each, per stretch of frames with that site on the floor
 * (within `contactMm`; the last centimetre of a step still travels as the foot lands), may move at most
 * LIMITS.footMm horizontally through the stance. The first and last tenth of a second of a stretch are the landing
 * and the lift-off: there the site may skim up to `glideMm` (the approved lunges skim 17-38 mm as the stepping foot
 * lands or pushes off, a blur at 30 fps on a phone; a foot skating through the stance is not). Per site, so a roll onto the ball
 * or the heel is not a slide; the toe is left out (a lunge's back toes sink into the floor where they would bend).
 * Only judged when such a foot exists.
 */
export const STEP = { contactMm: 2, settleS: 0.1, glideMm: 40 }

export function steppingSlip(b: Baked, skel: Skeleton, F: Frames): { stance: Slip[]; landing: Slip[] } {
  const planted = new Set(b.contacts.filter((c) => c.kind === 'planted').map((c) => FOOT_SITE.exec(c.site)?.[2]))
  const resting = new Set(['l', 'r'].filter((s) => (b.rests ?? []).some((r) => r.regions.includes(`foot_${s}`))))
  const n = b.frames
  const settle = Math.max(1, Math.round(STEP.settleS * b.fps))
  const top = floorTop(b, F)
  const stance: Slip[] = [], landing: Slip[] = []
  for (const side of ['l', 'r']) {
    if (planted.has(side) || resting.has(side)) continue
    for (const site of [`heel_${side}`, `ball_${side}`]) {
      const p = F.f.map((f) => sitePos(skel, f, site))
      const on = p.map((x) => (x[1] - top) * 1000 <= STEP.contactMm)
      if (!on.some(Boolean)) continue
      const always = on.every(Boolean)
      // stretches of consecutive frames on the floor, cyclic: from each touch-down (or frame 0 when always down)
      const starts = always ? [0] : on.map((d, i) => (d && !on[(i - 1 + n) % n] ? i : -1)).filter((i) => i >= 0)
      for (const start of starts) {
        let len = 0
        while (len < n && on[(start + len) % n]) len++
        const at = (k: number) => p[(start + k) % n]
        const h = (q: V3, r: V3) => Math.hypot(q[0] - r[0], q[2] - r[2]) * 1000
        // the first and last `settle` frames land and lift off; the stance between them holds still
        const lo = always ? 0 : Math.min(settle, Math.floor((len - 1) / 2)), hi = always ? len - 1 : Math.max(lo, len - 1 - settle)
        const anchor = at(lo)
        let s = { v: 0, frame: start }, g = { v: 0, frame: start }
        for (let k = 0; k < len; k++) {
          const v = h(at(k), k < lo ? anchor : k > hi ? at(hi) : anchor)
          if (k >= lo && k <= hi) {
            if (v > s.v) s = { v, frame: (start + k) % n }
          } else if (v > g.v) g = { v, frame: (start + k) % n }
        }
        stance.push({ ...s, detail: `${site} down from frame ${start}` })
        landing.push({ ...g, detail: `${site} down from frame ${start}` })
      }
    }
  }
  return { stance, landing }
}

type Slip = { v: number; frame: number; detail?: string }

function steppingGates(b: Baked, skel: Skeleton, F: Frames): Gate[] {
  const { stance, landing } = steppingSlip(b, skel, F)
  if (!stance.length) return []
  return [
    worst('foot slip (stepping)', 'mm', b.tolerances?.stepSlip ?? LIMITS.footMm, stance),
    worst('foot landing glide (stepping)', 'mm', STEP.glideMm, landing),
  ]
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

// ---------- horizontal abduction ----------

/**
 * The upper arm may go at most `maxDeg` behind the thorax frontal plane, measured in the thorax transverse plane:
 * normal passive horizontal abduction from 90 deg of abduction is about 45 deg (AAOS, Greene & Heckman 1994;
 * Norkin & White). The angle only means horizontal abduction with the arm near the horizontal: below ~60 deg of
 * elevation an arm behind the trunk is shoulder extension (rows, dips, the incline curl hang, a pure extension
 * reads 90 deg here), which the joint limits cover, and overhead the transverse plane no longer describes it.
 */
export const HORIZONTAL_ABDUCTION = { maxDeg: 45, elev: [60, 120] as const }

/** upper arm elevation from hanging and its angle behind the frontal plane (+ behind), thorax frame, deg */
export function armAngles(skel: Skeleton, f: FK, side: 'l' | 'r'): { elev: number; behind: number } {
  const thorax = f.rot[skel.segments[skel.seg[`clavicle_${side}`]].parent]
  const [x, y, z] = qrot(qconj(thorax), sub(f.pos[skel.seg[`forearm_${side}`]], f.pos[skel.seg[`humerus_${side}`]]))
  const n = Math.hypot(x, y, z)
  const lateral = side === 'l' ? x : -x
  return { elev: (Math.acos(Math.max(-1, Math.min(1, -y / n))) * 180) / Math.PI, behind: (Math.atan2(-z, lateral) * 180) / Math.PI }
}

function abductionGates(b: Baked, skel: Skeleton, F: Frames): Gate[] {
  const [lo, hi] = HORIZONTAL_ABDUCTION.elev
  const vals: { v: number; frame: number; detail?: string }[] = []
  for (let i = 0; i < b.frames; i++) {
    for (const s of ['l', 'r'] as const) {
      const { elev, behind } = armAngles(skel, F.f[i], s)
      if (elev >= lo && elev <= hi) vals.push({ v: behind, frame: i, detail: `shoulder_${s} at ${Math.round(elev)} deg elevation` })
    }
  }
  return [worst('shoulder horizontal abduction', 'deg behind frontal plane', b.tolerances?.horizontalAbduction ?? HORIZONTAL_ABDUCTION.maxDeg, vals)]
}

// ---------- lateral balance ----------

/**
 * Free standing work keeps the centre of pressure (body, loads and cable pulls, as the fore-aft balance) inside the
 * base of support sideways: between the outer edges of the feet on a bilateral stance, over the stance foot on
 * single-leg work. The feet's edges are the foot capsules (about 96 mm wide), so the default tolerance is 0.
 */
export const LATERAL = {
  /** a foot this close to the floor (lowest capsule point, mm) stands on it */
  footDownMm: 10,
  /** a trunk, pelvis, thigh or arm this close to fixed equipment (mm) rests on it: the setup is supported */
  restMm: 10,
  /** standing: the pelvis rises at least this share of its relaxed standing height above the feet at some frame */
  standing: 0.8,
  /** fixed equipment a hand only touches for balance (it cannot hold a lean) */
  lightTouch: new Set(['grab_handle', 'wall']),
}

const FOOT_SITE = /^(heel|ball|toe|midfoot)_([lr])$/

/** why the lateral balance gate does not judge this setup, or null when it does */
export function lateralSkip(b: Baked, skel: Skeleton, F: Frames, rows: Clearance[]): string | null {
  if (b.balance?.lateral === false) return 'declared off'
  const feet = new Set(b.contacts.filter((c) => c.kind === 'planted').map((c) => FOOT_SITE.exec(c.site)?.[2]).filter((s) => s !== undefined))
  // a stepping loop (lateral band walk) has no foot planted for the whole rep: its feet are the ones that touch down
  if (!feet.size) for (const s of footDownFrames(skel, F).filter((d) => d.down.some(Boolean))) feet.add(s.side)
  if (!feet.size) return 'no planted feet'
  if (b.balance?.lateral) return null
  const fixed = (id: string) => {
    const s = b.implements.find((x) => x.id === id)
    return !!s && !MOVING_KINDS.has(s.kind) && !(b.cables ?? []).some((c) => c.implement === id)
  }
  for (const c of b.contacts) {
    if (c.kind === 'planted' || !('implement' in c.target) || FOOT_SITE.test(c.site)) continue
    const s = b.implements.find((x) => x.id === (c.target as { implement: string }).implement)!
    if (fixed(s.id) && !LATERAL.lightTouch.has(s.kind)) return `${c.site} on ${s.id}`
  }
  for (const r of rows) {
    if ((r.kind !== 'prop' && r.kind !== 'machine') || r.min > LATERAL.restMm) continue
    const [region, other] = r.pair.split(' / ')
    if (/^(hand|foot)_/.test(region)) continue
    if (r.kind === 'prop' && !fixed(other.split('#')[0])) continue
    return `${region} rests on ${other}`
  }
  const rest = fk(skel, zeroQ(skel))
  const height = rest.pos[0][1] - sitePos(skel, rest, 'midfoot_l')[1]
  let top = -Infinity
  for (const f of F.f) top = Math.max(top, f.pos[0][1] - Math.min(...[...feet].map((s) => sitePos(skel, f, `midfoot_${s}`)[1])))
  return top < LATERAL.standing * height ? 'not standing' : null
}

/** per side, whether the foot is down on the floor (its lowest capsule point within LATERAL.footDownMm) at each frame */
export function footDownFrames(skel: Skeleton, F: Frames, mm = LATERAL.footDownMm): { side: 'l' | 'r'; down: boolean[] }[] {
  return (['l', 'r'] as const).map((side) => ({
    side,
    down: F.f.map((f) => Math.min(...bodyCapsules(skel, f).filter((c) => c.region === `foot_${side}`).map((c) => Math.min(c.a[1], c.b[1]) - c.r)) * 1000 <= mm),
  }))
}

function lateralGates(b: Baked, skel: Skeleton, F: Frames, rows: Clearance[]): Gate[] {
  const name = 'balance (lateral, past the feet)'
  const skip = lateralSkip(b, skel, F, rows)
  if (skip) return [{ name, unit: 'mm', limit: 0, value: 0, pass: true, detail: `not judged: ${skip}` }]
  const planted = new Set(b.contacts.filter((c) => c.kind === 'planted').map((c) => FOOT_SITE.exec(c.site)?.[2]))
  const resting = new Set(['l', 'r'].filter((s) => (b.rests ?? []).some((r) => r.regions.includes(`foot_${s}`))))
  const tol = b.tolerances?.lateral ?? 0
  const feetOf = (caps: Capsule[], s: string) => caps.filter((c) => c.region === `foot_${s}`)
  const caps = F.f.map((f) => bodyCapsules(skel, f))
  const downs = Object.fromEntries(footDownFrames(skel, F).map((d) => [d.side, d.down]))
  const down = (i: number, s: string) => downs[s][i]
  // a foot that is down in some frames and up in others steps: while it is in the air over a foot planted for the
  // whole rep the rep is dynamic (gait), not a static stance, so those frames are not judged. A loop with no foot
  // down in every frame (a slow lateral band walk) is judged on every frame with a foot down, over the feet down then.
  const stepping = ['l', 'r'].filter((s) => !planted.has(s) && !resting.has(s) && F.f.some((_, i) => down(i, s)) && F.f.some((_, i) => !down(i, s)))
  const anchored = ['l', 'r'].some((s) => planted.has(s) || resting.has(s) || F.f.every((_, i) => down(i, s)))
  const vals: { v: number; frame: number; detail?: string }[] = []
  for (let i = 0; i < b.frames; i++) {
    if (anchored && stepping.some((s) => !down(i, s))) continue
    const support = ['l', 'r'].filter((s) => planted.has(s) || resting.has(s) || down(i, s))
    if (!support.length) continue
    const xs = support.flatMap((s) => feetOf(caps[i], s).flatMap((c) => [c.a[0] - c.r, c.a[0] + c.r, c.b[0] - c.r, c.b[0] + c.r]))
    const impl = F.impl[i]
    const loads = b.implements.filter((s) => s.mass > 0).map((s) => ({ mass: s.mass, pos: comWorld(s, impl.find((x) => x.id === s.id)!) }))
    const forces = (b.cables ?? []).map((c) => cableForce(c, impl.find((x) => x.id === c.implement)!))
    const [x] = centerOfPressure(skel, F.f[i], loads, forces)
    const [lo, hi] = [Math.min(...xs), Math.max(...xs)]
    vals.push({ v: Math.max(lo - x, x - hi) * 1000, frame: i, detail: `${support.length === 2 ? 'between the feet' : `over foot_${support[0]}`}, pressure at x ${Math.round(x * 1000)} mm, feet ${Math.round(lo * 1000)}..${Math.round(hi * 1000)}` })
  }
  if (!vals.length) return [{ name, unit: 'mm', limit: tol, value: 0, pass: true, detail: 'not judged: a foot steps in every frame' }]
  const w = vals.reduce((a, v) => (v.v > a.v ? v : a))
  return [{ name, unit: 'mm', limit: tol, value: round(w.v), frame: w.frame, detail: w.detail, pass: w.v <= tol }]
}


// ---------- machine travel ----------

/**
 * A machine part the body drives (lever arms, sleds, cable attachments, the landmine bar) must travel over the loop:
 * a template can pass every other gate with the lever nearly frozen while the limbs move (338 once did). Measured as
 * the largest distance between two frames of any of its sites (its parts' ends when it has none). The shortest real
 * stroke in the catalog is a calf raise (about 9 cm at the seated calf pad, 9 cm on the cable shrug), so half that
 * flags a frozen lever without touching a short honest stroke. Free weights, rings and floor supports are not
 * levers: an isometric hold keeps them still on purpose. Levers count as moving for the fixed equipment check (they
 * pivot in their frame).
 */
export const LEVER = {
  minMm: 50,
  /** kinds that are always a driven part */
  kinds: new Set(['cable_handle', 'rope_end', 'row_rope_end', 'press_arms', 'press_handles', 'pec_deck_arm', 'tbar_lever', 'hack_sled', 'pendulum_arm', 'knee_lever', 'belt_lever', 'landmine_bar', 'ab_wheel']),
  /** `kind:id` of driven parts whose kind also names a machine's fixed parts (the hip machine seat, the leg press frame) */
  parts: new Set(['hip_machine:arm_l', 'hip_machine:arm_r', 'seated_calf:lever', 'calf_machine:yoke', 'bench:sled']),
}

export const isLever = (b: Baked, s: ImplementSpec) => LEVER.kinds.has(s.kind) || LEVER.parts.has(`${s.kind}:${s.id}`) || (b.cables ?? []).some((c) => c.implement === s.id)

/** travel of each machine part the body drives, mm */
export function leverTravel(b: Baked, F: Frames): { id: string; mm: number }[] {
  const out: { id: string; mm: number }[] = []
  b.implements.forEach((s, k) => {
    if (!isLever(b, s)) return
    const pts = Object.values(s.sites).map((x) => x.pos)
    if (!pts.length) for (const p of s.parts) pts.push(...(p.shape === 'cylinder' ? [p.a, p.b] : [p.center]))
    if (!pts.length) pts.push([0, 0, 0])
    let mm = 0
    for (const p of pts) {
      const w = F.impl.map((ps) => add(ps[k].pos, qrot(ps[k].rot, p)))
      for (let i = 0; i < w.length; i++) for (let j = i + 1; j < w.length; j++) mm = Math.max(mm, dist(w[i], w[j]) * 1000)
    }
    out.push({ id: s.id, mm })
  })
  return out
}

function travelGates(b: Baked, F: Frames): Gate[] {
  const t = leverTravel(b, F)
  if (!t.length) return []
  const w = t.reduce((a, x) => (x.mm < a.mm ? x : a))
  return [{ name: 'machine travel', unit: 'mm', limit: LEVER.minMm, value: round(w.mm), detail: w.id, pass: w.mm >= LEVER.minMm }]
}

// ---------- hand-supported floor balance ----------

/**
 * A floor plank or push-up holds the centre of pressure (body, loads, cable pulls) inside the support polygon of
 * everything on the floor: the hands, forearms, knees and feet down (capsule ends within SUPPORT.downMm of the floor,
 * widened by their radius) and hands on a held implement that rests on the floor (renegade row). Judged on every
 * frame with a hand support; skipped when the trunk lies on the floor or the body rests on equipment. Hands that
 * hold a moving implement off the floor are not supports. Default tolerance 15 mm for the capsule footprints and the
 * segment-mass centre of mass: the approved planks and push-ups sit inside, the renegade row 12 mm out at the top of
 * the row; 828 shoulder tap was once 54 mm outside its tripod.
 */
export const SUPPORT = { downMm: 10, tolMm: 15, lying: new Set(['trunk', 'girdle', 'head']) }

/** the floor surface: the top of a floor mat when the setup has one (the body lies, kneels and plants on it), else 0 */
export function floorTop(b: Baked, F: Frames): number {
  let y = 0
  b.implements.forEach((s, k) => {
    if (FIXED.matKinds.has(s.kind)) for (const sd of placeParts(s, F.impl[0][k])) y = Math.max(y, extremeY(sd.geo, 1))
  })
  return y
}

/** why the support polygon gate does not judge this setup, or null when it does */
export function supportSkip(b: Baked, skel: Skeleton, F: Frames, rows: Clearance[]): string | null {
  const top = floorTop(b, F)
  const caps = F.f.map((f) => bodyCapsules(skel, f))
  const low = (c: Capsule) => (Math.min(c.a[1], c.b[1]) - c.r - top) * 1000 <= SUPPORT.downMm
  const holding = handsHolding(b)
  if (!caps.some((cs, i) => cs.some((c) => /^(hand|forearm)_/.test(c.region) && !holding.has(c.region) && low(c)) || handsOnFloorImplements(b, F, i, top).length)) return 'no hand on the floor'
  if (caps.some((cs) => cs.some((c) => SUPPORT.lying.has(c.region) && low(c)))) return 'lying on the floor'
  for (const r of rows) {
    if ((r.kind !== 'prop' && r.kind !== 'machine') || r.min > LATERAL.restMm) continue
    const [region, other] = r.pair.split(' / ')
    if (/^(hand|foot)_/.test(region) || other.startsWith('cable:') || FIXED.matKinds.has(b.implements.find((s) => s.id === other.split(/[#:]/)[0])?.kind ?? '')) continue
    return `${region} rests on ${other}`
  }
  return null
}

/** hands (and their forearms) holding a moving implement: down by the floor they hold it there, they do not lean on it */
function handsHolding(b: Baked): Set<string> {
  const out = new Set<string>()
  for (const c of b.contacts) {
    if (c.kind !== 'grip' || !('implement' in c.target) || !/^(grip|fingers)_[lr]$/.test(c.site)) continue
    const spec = b.implements.find((s) => s.id === (c.target as { implement: string }).implement)!
    if (MOVING_KINDS.has(spec.kind) || isLever(b, spec)) out.add(`hand_${c.site.slice(-1)}`).add(`forearm_${c.site.slice(-1)}`)
  }
  return out
}

/** floor footprint (world points) of each held implement resting on the floor in frame i (a renegade row dumbbell) */
function handsOnFloorImplements(b: Baked, F: Frames, i: number, top: number): V3[][] {
  const out: V3[][] = []
  const seen = new Set<string>()
  for (const c of b.contacts) {
    if (c.kind !== 'grip' || !('implement' in c.target) || !/^(grip|fingers)_/.test(c.site) || seen.has(c.target.implement)) continue
    const k = b.implements.findIndex((s) => s.id === (c.target as { implement: string }).implement)
    const spec = b.implements[k]
    if (!MOVING_KINDS.has(spec.kind) || !spec.parts.length) continue
    const solids = placeParts(spec, F.impl[i][k])
    const down = solids.filter((sd) => (extremeY(sd.geo, -1) - top) * 1000 <= SUPPORT.downMm)
    if (!down.length) continue
    seen.add(spec.id)
    out.push(down.flatMap((sd) => (sd.geo.shape === 'cylinder' ? [sd.geo.a, sd.geo.b] : [sd.geo.center])))
  }
  return out
}

/** the lowest (dir -1) or highest (dir 1) point of a placed part, m */
function extremeY(g: Solid['geo'], dir: 1 | -1): number {
  if (g.shape === 'cylinder') {
    const d = sub(g.b, g.a), l = Math.hypot(...d)
    const sin = l > 0 ? Math.hypot(d[0], d[2]) / l : 1
    return dir * Math.max(dir * g.a[1], dir * g.b[1]) + dir * g.r * sin
  }
  let y = -dir * Infinity
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const c = add(g.center, qrot(g.rot, [sx * g.half[0], sy * g.half[1], sz * g.half[2]]))[1]
    y = dir > 0 ? Math.max(y, c) : Math.min(y, c)
  }
  return y
}

/** convex hull of 2-D points (monotone chain), counter-clockwise */
export function hull2(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: [number, number][] = [], hi: [number, number][] = []
  for (const x of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], x) <= 0) lo.pop()
    lo.push(x)
  }
  for (const x of [...p].reverse()) {
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], x) <= 0) hi.pop()
    hi.push(x)
  }
  return lo.slice(0, -1).concat(hi.slice(0, -1))
}

/** distance of a point outside a convex polygon (0 inside), same units */
export function outside(poly: [number, number][], q: [number, number]): number {
  if (!poly.length) return Infinity
  if (poly.length === 1) return Math.hypot(q[0] - poly[0][0], q[1] - poly[0][1])
  let inside = poly.length >= 3, best = Infinity
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length]
    const e = [b[0] - a[0], b[1] - a[1]], w = [q[0] - a[0], q[1] - a[1]]
    if (e[0] * w[1] - e[1] * w[0] < 0) inside = false
    const t = Math.max(0, Math.min(1, (w[0] * e[0] + w[1] * e[1]) / (e[0] * e[0] + e[1] * e[1] || 1)))
    best = Math.min(best, Math.hypot(w[0] - t * e[0], w[1] - t * e[1]))
  }
  return inside ? 0 : best
}

function supportGates(b: Baked, skel: Skeleton, F: Frames, rows: Clearance[]): Gate[] {
  const name = 'balance (support polygon, hands on the floor)'
  const skip = supportSkip(b, skel, F, rows)
  if (skip) return [{ name, unit: 'mm', limit: 0, value: 0, pass: true, detail: `not judged: ${skip}` }]
  const tol = b.tolerances?.support ?? SUPPORT.tolMm
  const top = floorTop(b, F)
  // feet up on a box or bench (feet-elevated push-up) support the body there
  const raised = new Set(rows.filter((r) => (r.kind === 'prop' || r.kind === 'machine') && r.min <= LATERAL.restMm && /^foot_/.test(r.pair)).map((r) => r.pair.split(' / ')[0]))
  const holding = handsHolding(b)
  const vals: { v: number; frame: number; detail?: string }[] = []
  for (let i = 0; i < b.frames; i++) {
    const pts: [number, number][] = []
    let hands = 0
    const labels = new Set<string>()
    for (const c of bodyCapsules(skel, F.f[i])) {
      for (const e of [c.a, c.b]) {
        if (((e[1] - c.r - top) * 1000 > SUPPORT.downMm && !raised.has(c.region)) || holding.has(c.region)) continue
        if (/^(hand|forearm)_/.test(c.region)) hands++
        labels.add(c.region)
        for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) pts.push([e[0] + dx * c.r, e[2] + dz * c.r])
      }
    }
    for (const foot of handsOnFloorImplements(b, F, i, top)) {
      hands++
      labels.add('held implement')
      for (const p of foot) pts.push([p[0], p[2]])
    }
    if (!hands) continue
    const impl = F.impl[i]
    const loads = b.implements.filter((s) => s.mass > 0).map((s) => ({ mass: s.mass, pos: comWorld(s, impl.find((x) => x.id === s.id)!) }))
    const forces = (b.cables ?? []).map((c) => cableForce(c, impl.find((x) => x.id === c.implement)!))
    const [x, z] = centerOfPressure(skel, F.f[i], loads, forces)
    vals.push({ v: outside(hull2(pts), [x, z]) * 1000, frame: i, detail: `over ${[...labels].sort().join(', ')}` })
  }
  if (!vals.length) return [{ name, unit: 'mm', limit: tol, value: 0, pass: true, detail: 'not judged: no frame with a hand down' }]
  return [worst(name, 'mm outside', tol, vals)]
}

// ---------- declared hand rests ----------

/**
 * A free hand declared to rest on a support (a rest on that implement listing hand_l or hand_r, with a non-negative
 * tolerance, for a hand with no grip contact) must touch it on every frame: the gap from its hand capsules to the implement's parts, or to the drawn
 * machine keyed by that implement, stays within REST_TOUCH_MM. 10 mm: the hand capsule is a rounded box around the
 * fingers and palm, so a flat palm on a pad reads a few mm off; 330's free hand once floated 65 mm above the pad.
 */
export const REST_TOUCH_MM = 10

export function restGaps(b: Baked, skel: Skeleton, F: Frames): { v: number; frame: number; detail?: string }[] {
  // a hand that grips something is placed by its contact; a rest listing it only sets a tolerance
  const holding = new Set(b.contacts.filter((c) => c.kind === 'grip' && /^(grip|fingers|palm)_[lr]$/.test(c.site)).map((c) => `hand_${c.site.slice(-1)}`))
  const free = (x: string) => /^hand_[lr]$/.test(x) && !holding.has(x)
  const rests = (b.rests ?? []).filter((r) => r.tol >= 0 && r.regions.some(free))
  if (!rests.length) return []
  const machines = machineColliders(b)
  const out: { v: number; frame: number; detail?: string }[] = []
  for (let i = 0; i < b.frames; i++) {
    const caps = bodyCapsules(skel, F.f[i])
    const poses = new Map<string, ImplementPose>(F.impl[i].map((p) => [p.id, p]))
    for (const r of rests) {
      const k = b.implements.findIndex((s) => s.id === r.implement)
      const solids: Solid[] = k >= 0 ? placeParts(b.implements[k], F.impl[i][k]) : []
      for (const m of machines.filter((m) => m.key === r.implement)) {
        const { pose, colliders } = m.at(poses)
        solids.push(...placeParts({ id: m.key, kind: 'bench', mass: 0, com: [0, 0, 0], parts: colliders, sites: {} }, pose))
      }
      if (!solids.length) continue
      for (const region of r.regions.filter(free)) {
        let gap = Infinity
        for (const c of caps.filter((c) => c.region === region)) for (const sd of solids) {
          if (boundClearance(c, sd) > gap) continue
          gap = Math.min(gap, capsuleSolidClearance(c, sd))
        }
        out.push({ v: gap * 1000, frame: i, detail: `${region} / ${r.implement}` })
      }
    }
  }
  return out
}

function restTouchGates(b: Baked, skel: Skeleton, F: Frames): Gate[] {
  const vals = restGaps(b, skel, F)
  return vals.length ? [worst('declared hand rest contact', 'mm gap', REST_TOUCH_MM, vals)] : []
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
  /** any body region below the floor (y = 0): planted feet sit on it, lying bodies press on it */
  floor: 5,
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

/** held implements this close (enclosing capsules, m) to another piece of equipment get an exact clearance */
const EQUIPMENT_REACH = 0.05

export type Clearance = {
  pair: string
  /**
   * prop: the template's implements and cables; machine: the drawn machines and benches around them; equipment: a
   * held implement against the drawn machines, benches and fixtures and the other held implements; fixed: standing
   * equipment against other standing equipment; strap: drawn-only bands and ring straps against the body; floor: the
   * body against the floor plane
   */
  kind: 'body' | 'prop' | 'machine' | 'equipment' | 'fixed' | 'strap' | 'floor'
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
 * Parts of a drawn machine that ride rigidly with an implement it holds (the Smith carriages clamping the bar): the
 * implement is mounted in them, so the equipment check skips those pairs. Keyed `<machine>|<implement>`; parts that
 * stay put (uprights, rails, frames) are still checked.
 */
function mountParts(b: Baked, F: Frames, machines: ReturnType<typeof machineColliders>): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>()
  for (const m of machines) for (const id of m.holds) {
    const k = b.implements.findIndex((s) => s.id === id)
    if (k < 0) continue
    let far = 0, moved = 0
    for (let i = 0; i < b.frames; i++) {
      const d = dist(F.impl[i][k].pos, F.impl[0][k].pos)
      if (d > moved) [far, moved] = [i, d]
    }
    if (moved < 0.01) continue
    const centers = (i: number) => {
      const { pose, colliders } = m.at(new Map(F.impl[i].map((p) => [p.id, p])))
      const at = F.impl[i][k]
      return placeParts({ id: m.key, kind: 'bench', mass: 0, com: [0, 0, 0], parts: colliders, sites: {} }, pose).map((sd) => ({ world: sd.center, local: qrot(qconj(at.rot), sub(sd.center, at.pos)) }))
    }
    const [c0, c1] = [centers(0), centers(far)]
    const set = new Set<number>()
    c0.forEach((c, j) => {
      if (j < c1.length && dist(c.local, c1[j].local) < 1e-3 && dist(c.world, c1[j].world) > 1e-3) set.add(j)
    })
    out.set(`${m.key}|${id}`, set)
  }
  return out
}

// ---------- drawn-only straps ----------

/**
 * Bands and ring straps are drawn through a path every frame and have no parts, so the prop check never sees them.
 * They are flat strips, so the clearance is to the strip's centre line less half its thickness. Default tolerance
 * 10 mm, as the cable line: a taut strip may press into soft tissue a little where it crosses it, but a band through
 * a thigh (334 once at 44 mm) reads as cutting the limb. Not checked:
 * - the fists that hold the strip, and the first `exitMm` of a run from a held point (a band handle's ring, a bare
 *   band leaving the fist, a ring): the strip leaves the hand there and runs past the wrist;
 * - next to a path node that rides on a body segment (a band round the knees, the feet or the shins), the first
 *   (that segment's capsule radius + `wrapMm`) of each run from the node, against that segment and the segments
 *   jointed to it: the strip wraps the limb there and sits in its folds (436: behind the knees, between thigh and
 *   calf). The rest of the run is checked against every segment, the wrapped limb included, so a band crossing from
 *   one knee to the other through the thighs fails.
 * A rest on the band's id sets the tolerance of its regions.
 */
export const STRAP = {
  tolMm: 10,
  exitMm: 60,
  wrapMm: 30,
  /** a part-less path node rides on a segment when its pose keeps this close to the segment frame on every frame */
  nodeDeg: 1,
  nodeMm: 3,
  /** and it sits this close to that segment's surface (a band clears the limb by a few cm at most) */
  nearMm: 60,
}

/** a piece of a strap run and the body segments it is not checked against */
export type StrapPiece = { a: V3; b: V3; skip: ReadonlySet<string> }
type DrawnStrap = { id: string; half: number; pieces: (poses: ReadonlyMap<string, ImplementPose>) => StrapPiece[]; skipRegions: Set<string> }

/** the body segment each part-less path node rides on (posed with segmentPose), or none when it stays in the world */
export function nodeSegments(b: Baked, skel: Skeleton, F: Frames, ids: string[]): Map<string, string> {
  const out = new Map<string, string>()
  const caps0 = bodyCapsules(skel, F.f[0])
  for (const id of ids) {
    const k = b.implements.findIndex((s) => s.id === id)
    if (k < 0 || b.implements[k].parts.length) continue
    let best: { seg: string; d: number } | null = null
    for (const s of skel.segments) {
      const near = caps0.filter((c) => c.segment === s.name).map((c) => segmentDistance(c.a, c.b, F.impl[0][k].pos, F.impl[0][k].pos).d - c.r)
      const d = near.length ? Math.min(...near) : Infinity
      if (d * 1000 > STRAP.nearMm || (best && d >= best.d)) continue
      const local0 = qrot(qconj(F.f[0].rot[s.index]), sub(F.impl[0][k].pos, F.f[0].pos[s.index]))
      let rides = true
      for (let i = 0; i < b.frames && rides; i++) {
        const p = F.impl[i][k], r = F.f[i].rot[s.index]
        const rel = qmul(qconj(r), p.rot)
        const deg = (2 * Math.acos(Math.min(1, Math.abs(rel[3]))) * 180) / Math.PI
        const local = qrot(qconj(r), sub(p.pos, F.f[i].pos[s.index]))
        rides = deg <= STRAP.nodeDeg && dist(local, local0) * 1000 <= STRAP.nodeMm
      }
      if (rides) best = { seg: s.name, d }
    }
    if (best) out.set(id, best.seg)
  }
  return out
}

const lerp = (a: V3, b: V3, t: number): V3 => add(a, scale(sub(b, a), t))

/** a riding path node at one end of a run: the length of run it wraps and the segments not checked there */
export type StrapEnd = { trim: number; skip: ReadonlySet<string> }

/**
 * Split a run into the pieces the strap gate checks: `held` metres cut off a held end, then the first `trim` metres
 * from a riding node's end skip that node's segments, and the rest of the run is checked against every segment.
 */
export function strapPieces(a: V3, b: V3, o: { heldA?: number; heldB?: number; nodeA?: StrapEnd; nodeB?: StrapEnd }): StrapPiece[] {
  const l = dist(a, b)
  const [ha, hb] = [o.heldA ?? 0, o.heldB ?? 0]
  if (l <= ha + hb) return []
  const p = lerp(a, b, ha / l), q = lerp(a, b, 1 - hb / l)
  const m = l - ha - hb
  const ua = o.nodeA ? Math.min(1, o.nodeA.trim / m) : 0
  const ub = o.nodeB ? Math.max(0, 1 - o.nodeB.trim / m) : 1
  if (ua >= ub) return [{ a: p, b: q, skip: new Set([...(o.nodeA?.skip ?? []), ...(o.nodeB?.skip ?? [])]) }]
  const out: StrapPiece[] = []
  if (ua > 0) out.push({ a: p, b: lerp(p, q, ua), skip: o.nodeA!.skip })
  out.push({ a: lerp(p, q, ua), b: lerp(p, q, ub), skip: new Set() })
  if (ub < 1) out.push({ a: lerp(p, q, ub), b: q, skip: o.nodeB!.skip })
  return out
}

function drawnStraps(b: Baked, skel: Skeleton, F: Frames): DrawnStrap[] {
  const specs = new Map(b.implements.map((s) => [s.id, s]))
  const out: DrawnStrap[] = []
  const caps0 = bodyCapsules(skel, F.f[0])
  for (const s of b.implements) {
    let ids: string[], half: number, closed = false, path: (poses: ReadonlyMap<string, ImplementPose>) => V3[]
    if (isBand(s)) {
      ids = s.band.path.map((p) => p.implement)
      half = s.band.thick / 2
      closed = s.band.closed
      path = (poses) => bandPath(s, specs, poses).map((v) => v.pos)
    } else if (isRingStrap(s)) {
      ids = s.strap.path.map((p) => p.implement)
      half = s.strap.thick / 2
      path = (poses) => strapPath(s, specs, poses)
    } else continue
    const held = new Set<string>()
    const skipRegions = new Set<string>()
    for (const c of b.contacts) {
      if (c.kind !== 'grip' || !('implement' in c.target) || !ids.includes(c.target.implement)) continue
      held.add(c.target.implement)
      const side = c.site.match(/_([lr])$/)?.[1]
      if (side) skipRegions.add(`hand_${side}`)
    }
    const rides = nodeSegments(b, skel, F, [...new Set(ids)])
    // a riding node wraps the first (radius of its segment's capsule nearest the path point + wrapMm) of each run
    // from it; there the strip sits on that segment and in the folds of the segments jointed to it
    const jointed = (name: string) => {
      const i = skel.seg[name]
      const parent = skel.segments[i].parent
      return new Set([name, ...(parent >= 0 ? [skel.segments[parent].name] : []), ...skel.segments.filter((x) => x.parent === i).map((x) => x.name)])
    }
    const folds = new Map([...new Set(rides.values())].map((seg) => [seg, jointed(seg)]))
    const radius = (seg: string, at: V3) => caps0.filter((x) => x.segment === seg).reduce((m, x) => {
      const d = segmentDistance(x.a, x.b, at, at).d - x.r
      return d < m.d ? { d, r: x.r } : m
    }, { d: Infinity, r: 0 }).r
    const pts0 = path(new Map(F.impl[0].map((p) => [p.id, p])))
    const ends = ids.map((id, k) => {
      const seg = rides.get(id)
      return seg ? { trim: radius(seg, pts0[k]) + STRAP.wrapMm / 1000, skip: folds.get(seg)! } : undefined
    })
    const pairs = ids.slice(1).map((_, k) => [k, k + 1])
    if (closed && ids.length > 2) pairs.push([ids.length - 1, 0])
    const pieces = (poses: ReadonlyMap<string, ImplementPose>) => {
      const pts = path(poses)
      return pairs.flatMap(([i, j]) => strapPieces(pts[i], pts[j], {
        heldA: held.has(ids[i]) ? STRAP.exitMm / 1000 : 0,
        heldB: held.has(ids[j]) ? STRAP.exitMm / 1000 : 0,
        nodeA: ends[i],
        nodeB: ends[j],
      }))
    }
    out.push({ id: s.id, half, pieces, skipRegions })
  }
  return out
}

// ---------- fixed equipment ----------

/**
 * Standing equipment (benches, stations, racks, anchors) must not stand inside other standing equipment (531: the
 * thrust bench inside the Smith frame). 5 mm: rigid against rigid, a little above the 3 mm hard-contact tolerance for
 * the collider approximations (rounded tubes drawn as boxes). Floor mats are skipped (equipment stands on them and
 * they are drawn compressible), and so are fixtures mounted on other equipment. `tolerances.fixed` overrides it.
 */
export const FIXED = {
  tolMm: 5,
  matKinds: new Set<string>(['mat']),
  /** fixtures bolted onto the equipment beside them (a grab handle clamped to the cable column) */
  mounted: new Set<string>(['grab_handle']),
}

/** an intended rest sets the tolerance of its regions on rigid parts, and may only raise it on padded ones */
function restTol(rest: { regions: string[]; tol: number } | undefined, region: string, pad?: boolean) {
  const base = pad ? PROP_TOL.pad : PROP_TOL.rigid
  if (!rest?.regions.includes(region)) return base
  return pad ? Math.max(base, rest.tol) : rest.tol
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
  const riders = mountParts(b, F, machines)
  const REACH = 0.25
  // drawn machines hold hundreds of parts; only near ones make useful rows
  const MACHINE_REACH = 0.1
  const bodyTolOf = (p: BodyPair) => b.tolerances?.body?.[p.label] ?? p.tol
  const floorTol = b.tolerances?.floor ?? PROP_TOL.floor
  const movingIds = new Set(b.implements.filter((s) => MOVING_KINDS.has(s.kind) || isLever(b, s)).map((s) => s.id))
  const fixedFrames = new Set([0, 0.25, 0.5, 0.75].map((t) => Math.floor(t * b.frames)))
  const mats = new Set(b.implements.filter((s) => FIXED.matKinds.has(s.kind) || FIXED.mounted.has(s.kind)).map((s) => s.id))
  const fixedTol = b.tolerances?.fixed ?? FIXED.tolMm
  const straps = drawnStraps(b, skel, F)
  const strapTol = b.tolerances?.strap ?? STRAP.tolMm
  for (let i = 0; i < b.frames; i++) {
    const caps = bodyCapsules(skel, F.f[i])
    for (const p of pairs) note(p.label, 'body', round(capsuleClearance(caps[p.i], caps[p.j]) * 1000), i, bodyTolOf(p), p.allowance)
    for (const c of caps) {
      const mm = (Math.min(c.a[1], c.b[1]) - c.r) * 1000
      if (mm < REACH * 1000) note(`${c.region} / floor`, 'floor', round(mm), i, floorTol, 0)
    }
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
          const tol = restTol(rest, c.region, s.part.pad)
          note(`${c.region} / ${label}`, 'prop', round(capsuleSolidClearance(c, s) * 1000), i, tol, 0)
        }
      }
    })
    const poses = new Map<string, ImplementPose>(F.impl[i].map((p) => [p.id, p]))
    for (const m of machines) {
      const { pose, colliders } = m.at(poses)
      const held = new Set(m.holds.flatMap((id) => [...(grips.get(id) ?? [])]))
      // a support drawn from a template implement (its key is the implement id) keeps that implement's rest
      const rest = b.rests?.find((r) => r.implement === m.key)
      for (const s of placeParts({ id: m.key, kind: 'bench', mass: 0, com: [0, 0, 0], parts: colliders, sites: {} }, pose)) {
        const label = `${m.key}:${colliders[s.index].kind}#${s.index}`
        const hull = enclosing(s.part, pose)
        for (const c of caps) {
          if (held.has(c.region) && s.part.shape === 'cylinder' && s.part.r <= HANDLE_R) continue
          if (capsuleClearance(c, hull) > MACHINE_REACH) continue
          note(`${c.region} / ${label}`, 'machine', round(capsuleSolidClearance(c, s) * 1000), i, restTol(rest, c.region, s.part.pad), 0)
        }
      }
    }
    // equipment against equipment: each held implement's parts against the drawn machines, the fixtures drawn from
    // their own parts and the other held implements
    const others: { label: string; solid: Solid; owner: string; moving: boolean }[] = []
    for (const m of machines) {
      const { pose, colliders } = m.at(poses)
      for (const sd of placeParts({ id: m.key, kind: 'bench', mass: 0, com: [0, 0, 0], parts: colliders, sites: {} }, pose)) {
        others.push({ label: `${m.key}:${colliders[sd.index].kind}#${sd.index}`, solid: sd, owner: m.key, moving: false })
      }
    }
    b.implements.forEach((spec, k) => {
      const moving = MOVING_KINDS.has(spec.kind)
      const drawn = moving || (spec.id === 'bench' && !machines.some((m) => m.key === 'bench')) || spec.id === 'post'
      if (drawn) for (const sd of placeParts(spec, F.impl[i][k])) others.push({ label: `${spec.id}#${sd.index}`, solid: sd, owner: spec.id, moving })
    })
    for (const x of others) {
      if (!x.moving) continue
      const hull = enclosingCapsule(x.solid)
      for (const y of others) {
        if (y.owner === x.owner || (y.moving && y.owner < x.owner) || riders.get(`${y.owner}|${x.owner}`)?.has(y.solid.index)) continue
        if (capsuleClearance(hull, enclosingCapsule(y.solid)) > EQUIPMENT_REACH) continue
        note(`${x.label} / ${y.label}`, 'equipment', round(solidClearance(x.solid, y.solid) * 1000), i, PROP_TOL.rigid, 0)
      }
    }
    // standing equipment against standing equipment (a bench inside a rack frame): it barely moves, so a few frames
    if (fixedFrames.has(i)) {
      const still = others.filter((x) => !x.moving && !movingIds.has(x.owner))
      for (const x of still) {
        const hull = enclosingCapsule(x.solid)
        for (const y of still) {
          if (y.owner <= x.owner || mats.has(y.owner) || mats.has(x.owner)) continue
          if (capsuleClearance(hull, enclosingCapsule(y.solid)) > EQUIPMENT_REACH) continue
          note(`${x.label} / ${y.label}`, 'fixed', round(solidClearance(x.solid, y.solid) * 1000), i, fixedTol, 0)
        }
      }
    }
    for (const s of straps) {
      const pieces = s.pieces(poses)
      const rest = b.rests?.find((r) => r.implement === s.id)
      for (const c of caps) {
        if (s.skipRegions.has(c.region)) continue
        let d = Infinity
        for (const r of pieces) if (!r.skip.has(c.segment)) d = Math.min(d, segmentDistance(c.a, c.b, r.a, r.b).d)
        if (d === Infinity) continue
        const mm = (d - c.r - s.half) * 1000
        if (mm > REACH * 1000) continue
        note(`${c.region} / strap:${s.id}`, 'strap', round(mm), i, rest?.regions.includes(c.region) ? rest.tol : strapTol, 0)
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

function penetrationGates(rows: Clearance[]): Gate[] {
  const gate = (kind: Clearance['kind'], name: string): Gate => {
    const mine = rows.filter((r) => r.kind === kind)
    const w = mine[0]
    const value = w ? round(w.excess) : 0
    const detail = w ? `${w.pair} clearance ${w.min} mm${w.allowance ? ` (relaxed ${round(-w.allowance)})` : ''}, tol ${w.tol}` : undefined
    return { name, unit: 'mm past tol', limit: 0, value, frame: w?.frame, detail, pass: value <= 0 }
  }
  return [
    gate('body', 'penetration body-body'),
    gate('prop', 'penetration body-prop'),
    gate('machine', 'penetration body-machine'),
    gate('equipment', 'penetration equipment-equipment'),
    gate('fixed', 'penetration fixed equipment'),
    gate('strap', 'penetration body-strap'),
    gate('floor', 'penetration body-floor'),
  ]
}

// ---------- skeleton freshness ----------

/** a baked file must have been baked against the current skeleton */
export function skeletonGate(c: CompactMotion, skel: Skeleton): Gate {
  const why = staleReason(c, skel)
  return { name: 'skeleton hash', unit: '', limit: 0, value: why ? 1 : 0, pass: !why, detail: why ?? c.skeleton }
}

export function runGates(b: Baked, skel: Skeleton, sizeBytes?: number): Gate[] {
  const F = frames(b, skel)
  const rows = clearances(b, skel, F)
  const gates = [
    ...contactGates(b, skel, F),
    ...limitGates(b, skel, F),
    ...flipGates(b, skel, F),
    ...seamGates(b, skel, F),
    ...symmetryGates(b, skel, F),
    ...balanceGates(b, skel, F),
    ...lateralGates(b, skel, F, rows),
    ...steppingGates(b, skel, F),
    ...supportGates(b, skel, F, rows),
    ...restTouchGates(b, skel, F),
    ...travelGates(b, F),
    ...abductionGates(b, skel, F),
    ...penetrationGates(rows),
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

