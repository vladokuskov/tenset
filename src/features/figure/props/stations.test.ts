import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { bake, type Baked } from '../../../motion/bake.ts'
import { siteWorld, type ImplementSpec, type Part } from '../../../motion/implements.ts'
import * as arms from '../../../motion/implements/arms.ts'
import * as back from '../../../motion/implements/back.ts'
import * as bands from '../../../motion/implements/bands.ts'
import * as chestShoulderIsolation from '../../../motion/implements/chest-shoulder-isolation.ts'
import * as core from '../../../motion/implements/core.ts'
import * as freeWeights from '../../../motion/implements/free-weights.ts'
import * as hinge from '../../../motion/implements/hinge.ts'
import { MOVING_KINDS } from '../../../motion/implements/index.ts'
import * as legsHipCalf from '../../../motion/implements/legs-hip-calf.ts'
import * as legsKnee from '../../../motion/implements/legs-knee.ts'
import * as portableC from '../../../motion/implements/portable-c.ts'
import * as pressHorizontal from '../../../motion/implements/press-horizontal.ts'
import * as pressVerticalBodyweight from '../../../motion/implements/press-vertical-bodyweight.ts'
import * as shared from '../../../motion/implements/shared.ts'
import * as stations from '../../../motion/implements/stations.ts'
import {
  beltLever,
  beltSquat,
  captainsChair,
  declineBench,
  ghd,
  hackSled,
  hackSquat,
  hipBelt,
  hyperLever,
  inclinePressLever,
  leverPose,
  pendulumArm,
  pendulumSquat,
  preacherBench,
  reverseHyper,
  sealBench,
  sledPose,
  tbarLever,
  tbarStation,
  BELT_SQUAT,
  CAPTAIN,
  DECLINE_BENCH,
  GHD,
  HACK,
  PENDULUM,
  PREACHER,
  REVERSE_HYPER,
  SEAL_BENCH,
  TBAR,
} from '../../../motion/implements/stations.ts'
import { DEG, dist, qrot, type V3 } from '../../../motion/math.ts'
import type { ImplementPose } from '../../../motion/skeleton.ts'
import { getTemplate, parseParams } from '../../../motion/templates/index.ts'
import { motionRecords, testSkeleton } from '../../../motion/testing.ts'
import { motionProps } from '../motion/compose'
import { machineColliders, pieceColliders } from './collision'
import { galleryScene } from './scenes'
import {
  buildBeltLever,
  buildBeltSquat,
  buildCaptainsChair,
  buildDeclineBench,
  buildGhd,
  buildHackFrame,
  buildHackSled,
  buildHyperLever,
  buildPendulumArm,
  buildPendulumFrame,
  buildPreacher,
  buildReverseHyper,
  buildSealBench,
  buildTbarLever,
  buildTbarStation,
} from './stations'
import { stationNames } from './stations-scenes'

const skel = testSkeleton()
const V = (a: readonly number[]) => new Vector3(a[0], a[1], a[2])
type Cyl = Extract<Part, { shape: 'cylinder' }>
type Box = Extract<Part, { shape: 'box' }>
const cyls = (s: ImplementSpec) => s.parts.filter((p): p is Cyl => p.shape === 'cylinder')
const boxes = (s: ImplementSpec) => s.parts.filter((p): p is Box => p.shape === 'box')
/** gates treat cylinders up to this radius under a gripping hand as handles (pipeline/motion/gates.ts HANDLE_R) */
const HANDLE_R = 0.03

function expectHandleSite(spec: ImplementSpec, site: string) {
  const s = spec.sites[site]
  let best = { d: Infinity, c: null as Cyl | null }
  for (const c of cyls(spec)) {
    const a = V(c.a), ab = V(c.b).sub(a)
    const t = Math.min(1, Math.max(0, V(s.pos).sub(a).dot(ab) / ab.lengthSq()))
    const d = a.addScaledVector(ab, t).distanceTo(V(s.pos))
    if (d < best.d) best = { d, c }
  }
  expect(best.d, `${spec.kind} ${site} on a handle axis`).toBeLessThan(1e-9)
  expect(best.c!.r, `${spec.kind} ${site} handle radius`).toBeLessThanOrEqual(HANDLE_R)
  const axis = V(best.c!.b).sub(V(best.c!.a)).normalize()
  expect(Math.abs(axis.dot(V(s.axis!).normalize())), `${spec.kind} ${site} axis along the handle`).toBeCloseTo(1, 9)
}

/** a surface site lies on the face of a box part whose outward normal is the site's normal, inside its extent */
function expectOnFace(spec: ImplementSpec, site: string) {
  const s = spec.sites[site]
  const n = V(s.normal!).normalize()
  const hit = boxes(spec).some((b) => {
    const q = new Quaternion(...(b.rot ?? [0, 0, 0, 1]))
    const inv = q.clone().invert()
    const p = V(s.pos).sub(V(b.center)).applyQuaternion(inv)
    const ln = n.clone().applyQuaternion(inv)
    const k = [0, 1, 2].find((i) => Math.abs(ln.getComponent(i)) > 1 - 1e-9)
    if (k === undefined) return false
    const half = b.size.map((x) => x / 2)
    if (Math.abs(p.getComponent(k) - Math.sign(ln.getComponent(k)) * half[k]) > 1e-9) return false
    return [0, 1, 2].every((i) => Math.abs(p.getComponent(i)) <= half[i] + 1e-9)
  })
  expect(hit, `${spec.kind} ${site} on a face of a part`).toBe(true)
}

const FIXED: [ImplementSpec, (s: ImplementSpec) => { pieces: { mat: string }[]; bbox: { min: Vector3; max: Vector3 } }][] = [
  [ghd(), buildGhd],
  [hackSquat(), buildHackFrame],
  [pendulumSquat(), buildPendulumFrame],
  [beltSquat(), buildBeltSquat],
  [preacherBench(), buildPreacher],
  [tbarStation(), buildTbarStation],
  [captainsChair(), buildCaptainsChair],
  [declineBench(), buildDeclineBench],
  [sealBench(), buildSealBench],
  [reverseHyper(), buildReverseHyper],
]

describe('station implements', () => {
  it('declare unique kinds across every module; the handle-carrying moving parts are moving', () => {
    const all = [shared, bands, freeWeights, portableC, pressHorizontal, pressVerticalBodyweight, chestShoulderIsolation, back, legsKnee, legsHipCalf, hinge, arms, core, stations].flatMap((m) => [...m.KINDS])
    expect(new Set(all).size).toBe(all.length)
    for (const k of stations.MOVING) expect((stations.KINDS as readonly string[]).includes(k), k).toBe(true)
    for (const k of ['hack_sled', 'pendulum_arm', 'tbar_lever']) expect(MOVING_KINDS.has(k), k).toBe(true)
    for (const k of ['ghd', 'hack_squat', 'belt_lever', 'hip_belt', 'hyper_lever', 'captains_chair', 'decline_bench']) expect(MOVING_KINDS.has(k), k).toBe(false)
    // ids stay clear of the ones the composer and gates special-case
    const ids = [...FIXED.map(([s]) => s.id), hackSled().id, pendulumArm().id, beltLever().id, hipBelt().id, tbarLever().id, hyperLever().id]
    for (const id of ['bench', 'post', 'sled', 'stack', 'station', 'press', 'pad', 'pullup', 'smith', 'handles', 'machine']) expect(ids).not.toContain(id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('put every grip site on a handle-sized cylinder, along it', () => {
    for (const s of ['handle_l', 'handle_r']) {
      expectHandleSite(hackSled(), s)
      expectHandleSite(pendulumArm(), s)
      expectHandleSite(beltSquat(), s)
      expectHandleSite(captainsChair(), s)
      expectHandleSite(reverseHyper(), s)
    }
    for (const s of ['neutral_l', 'neutral_r', 'wide_l', 'wide_r']) expectHandleSite(tbarLever(), s)
    // left hand on +X
    for (const spec of [hackSled(), beltSquat(), captainsChair(), reverseHyper()]) expect(spec.sites.handle_l.pos[0]).toBeGreaterThan(0)
    expect(tbarLever().sites.neutral_l.pos[0]).toBeCloseTo(TBAR.grips.neutral, 9)
  })

  it('put every surface site on the face of a pad, plate or deck', () => {
    const cases: [ImplementSpec, string[]][] = [
      [ghd(), ['pad', 'plate']],
      [hackSquat(), ['plate']],
      [hackSled(), ['back', 'shoulder_l', 'shoulder_r']],
      [pendulumSquat(), ['platform']],
      [pendulumArm(), ['back', 'shoulder_l', 'shoulder_r']],
      [beltSquat(), ['deck_l', 'deck_r']],
      [preacherBench(), ['top', 'pad', 'seat']],
      [tbarStation(), ['pad', 'chin', 'platform']],
      [captainsChair(), ['back', 'forearm_l', 'forearm_r']],
      [declineBench(), ['top', 'back']],
      [sealBench(), ['top', 'head', 'under']],
      [reverseHyper(), ['pad', 'edge']],
    ]
    for (const [spec, sites] of cases) for (const s of sites) expectOnFace(spec, s)
    // the deck has a slot down the middle: its centre site sits on the deck's top plane
    expect(beltSquat().sites.deck.pos[1]).toBeCloseTo(BELT_SQUAT.deck.top, 9)
    // rollers and the GHD nose are padded cylinders under their sites
    for (const [spec, s] of [[ghd(), 'roller_top'], [ghd(), 'roller_low'], [declineBench(), 'knee'], [declineBench(), 'ankle'], [hyperLever(), 'roller']] as const) {
      const c = cyls(spec).find((c) => dist(c.a.map((v, k) => (k === 0 ? 0 : v)) as V3, spec.sites[s].pos) < 1e-9)
      expect(c?.pad, `${spec.kind} ${s}`).toBe(true)
    }
  })

  it('keep the exported dimensions and adjustments', () => {
    const g = ghd({ reach: 2 })
    expect(g.parts[0].shape === 'cylinder' && g.parts[0].a[2] + GHD.pad.r).toBeCloseTo(GHD.reach.max, 9)
    const gg = ghd({ padTop: 1.0, ankle: { z: 0.1, y: 1.0 } })
    const [hi, lo] = [gg.sites.roller_top.pos[1], gg.sites.roller_low.pos[1]]
    expect(hi - lo - 2 * GHD.roller.r).toBeCloseTo(GHD.gap, 9)
    expect(sealBench({ height: 1.2 }).sites.top.pos[1]).toBe(SEAL_BENCH.height.max)
    expect(sealBench({ height: 0.5 }).sites.top.pos[1]).toBe(SEAL_BENCH.height.min)
    // the seal bench leaves room for the bar under it: the pad's underside is above arm's length of a lifter on it
    expect(sealBench().sites.under.pos[1]).toBeGreaterThan(0.7)
    for (const a of [30, 45, 60]) {
      const n = preacherBench({ padAngle: a }).sites.pad.normal!
      expect(Math.acos(n[1]) / DEG).toBeCloseTo(a, 6)
      expect(n[2]).toBeGreaterThan(0)
    }
    for (const a of [15, 20, 30]) {
      const along = declineBench({ decline: a }).sites.back.axis!
      expect(Math.asin(-along[1]) / DEG).toBeCloseTo(a, 6)
      expect(along[2]).toBeLessThan(0)
    }
    expect(declineBench({ knee: null }).sites.knee).toBeUndefined()
    expect(declineBench().sites.top.pos[1]).toBe(DECLINE_BENCH.top)
    const up = hackSquat().sites.rail.axis!
    expect(Math.atan2(up[1], -up[2]) / DEG).toBeCloseTo(HACK.angle, 9)
    const cc = captainsChair({ elbowHeight: 1.4 })
    expect(cc.sites.forearm_l.pos[1]).toBe(1.4)
    expect(cc.sites.step_l.pos[0]).toBeCloseTo(CAPTAIN.step.x, 9)
    expect(reverseHyper().sites.edge.pos[1]).toBe(REVERSE_HYPER.padTop)
    expect(preacherBench().sites.top.pos[1]).toBe(PREACHER.padTop)
    expect(dist(tbarStation().sites.chin.pos, TBAR.pad.top)).toBe(0)
  })
})

describe('moving parts', () => {
  const at = (spec: ImplementSpec, p: ImplementPose, s: string) => siteWorld(spec, p, s).pos

  it('hack sled slides up the rails with the pad facing the lifter', () => {
    const frame = hackSquat(), sled = hackSled()
    const p0 = sledPose(sled.id, frame, 0), p1 = sledPose(sled.id, frame, 0.5)
    expect(dist(p0.pos, HACK.bottom)).toBeLessThan(1e-12)
    const d = V(p1.pos).sub(V(p0.pos))
    expect(d.length()).toBeCloseTo(0.5, 9)
    expect(d.normalize().dot(V(frame.sites.rail.axis!))).toBeCloseTo(1, 9)
    expect(dist(qrot(p1.rot, [0, 1, 0]), [0, Math.cos(HACK.angle * DEG), Math.sin(HACK.angle * DEG)])).toBeLessThan(1e-9)
    // the shoulder pads sit on the shoulder line, above it up the rail
    expect(at(sled, p1, 'shoulder_l')[1]).toBeGreaterThan(p1.pos[1])
    // a frame posed elsewhere carries the sled with it
    const moved = sledPose(sled.id, frame, 0.5, { pos: [1, 0, 2], rot: [0, 1, 0, 0] })
    expect(dist(moved.pos, [1 - p1.pos[0], p1.pos[1], 2 - p1.pos[2]])).toBeLessThan(1e-9)
  })

  it('levers turn about X through their pivot', () => {
    const tbar = tbarLever()
    const up = (deg: number) => at(tbar, leverPose(tbar.id, TBAR.pivot, deg), 'neutral_l')
    expect(dist(up(0), [TBAR.grips.neutral, TBAR.handle[1], TBAR.handle[2]])).toBeLessThan(1e-9)
    expect(up(15)[1]).toBeGreaterThan(up(0)[1] + 0.2)
    const belt = beltLever()
    const hook = (deg: number) => at(belt, leverPose(belt.id, BELT_SQUAT.pivot, deg), 'hook')
    expect(dist(hook(0), BELT_SQUAT.hook)).toBeLessThan(1e-9)
    // a squat's hip rise
    expect(hook(BELT_SQUAT.lift)[1] - hook(0)[1]).toBeGreaterThan(0.3)
    expect(hook(BELT_SQUAT.lift)[1] - hook(0)[1]).toBeLessThan(0.5)
    const hyper = hyperLever()
    const r = (deg: number) => at(hyper, leverPose(hyper.id, REVERSE_HYPER.pivot, deg), 'roller')
    expect(dist(r(0), REVERSE_HYPER.roller)).toBeLessThan(1e-9)
    expect(r(30)[2]).toBeLessThan(r(0)[2])
    expect(r(30)[1]).toBeGreaterThan(r(0)[1])
    const arm = pendulumArm()
    const c = (deg: number) => at(arm, leverPose(arm.id, PENDULUM.pivot, deg), 'carriage')
    expect(dist(c(0), PENDULUM.shoulder)).toBeLessThan(1e-9)
    expect(c(20)[1]).toBeLessThan(c(0)[1])
    // the carriage keeps its distance from the pivot
    expect(dist(c(20), PENDULUM.pivot)).toBeCloseTo(dist(PENDULUM.shoulder, PENDULUM.pivot), 9)
  })

  it('incline press lever: the handles leave mid-stroke up the incline at the chosen reach', () => {
    const mid: V3 = [0, 1.12, 0.42]
    const { pivot, swing } = inclinePressLever({ mid, incline: 35, reach: 0.95, stroke: 0.36 })
    const handle = (deg: number) => {
      const q: [number, number, number, number] = [Math.sin((deg * DEG) / 2), 0, 0, Math.cos((deg * DEG) / 2)]
      return V(pivot).add(V(qrot(q, [0, 0.95, 0])))
    }
    const m = (swing[0] + swing[1]) / 2
    expect(handle(m).distanceTo(V(mid))).toBeLessThan(1e-9)
    const t = handle(m + 0.01).sub(handle(m - 0.01)).normalize()
    expect(Math.atan2(t.y, t.z) / DEG).toBeCloseTo(35, 3)
    expect(handle(swing[1]).distanceTo(handle(swing[0]))).toBeCloseTo(2 * 0.95 * Math.sin((0.36 / 2 / 0.95)), 6)
    expect(pivot[1]).toBeGreaterThan(0.1)
  })
})

describe('station props', () => {
  it('stand on the floor, draw padded contact parts and collide', () => {
    for (const [spec, build] of FIXED) {
      const b = build(spec)
      expect(b.bbox.min.y, spec.kind).toBeGreaterThan(-1e-6)
      expect(b.bbox.min.y, spec.kind).toBeLessThan(0.001)
      expect(b.pieces.some((p) => p.mat === 'pad' || p.mat === 'rubber'), spec.kind).toBe(true)
      const cols = pieceColliders(b.pieces as never)
      expect(cols.length, spec.kind).toBeGreaterThan(5)
      expect(cols.some((c) => c.pad), spec.kind).toBe(true)
    }
    for (const [spec, build] of [[hackSled(), buildHackSled], [pendulumArm(), buildPendulumArm], [tbarLever(), buildTbarLever], [hyperLever(), buildHyperLever], [beltLever(), buildBeltLever]] as const) {
      expect(build(spec).pieces.length, spec.kind).toBeGreaterThan(5)
    }
  })

  it('draw grip sockets where the implement sites are', () => {
    const s = buildHackSled(hackSled()).sockets
    expect(s.grips.handle_l.position.toArray()).toEqual(hackSled().sites.handle_l.pos)
    const t = buildTbarLever(tbarLever()).sockets
    expect(Object.keys(t.grips).sort()).toEqual(['neutral_l', 'neutral_r', 'wide_l', 'wide_r'])
    expect(buildCaptainsChair(captainsChair()).sockets.surfaces.forearm_l.normal.y).toBe(1)
  })
})

/** a baked curl with extra implements posed per frame */
function withImplements(extra: ImplementSpec[], poseAt: (i: number, n: number) => ImplementPose[]): Baked {
  const r = motionRecords('curl').find((x) => x.id === 711)!
  const b = bake(getTemplate('curl'), parseParams('curl', r.params, r.laterality), skel)
  const n0 = b.implements.length, n = n0 + extra.length
  const ip = new Float32Array(b.frames * n * 7)
  for (let i = 0; i < b.frames; i++) {
    ip.set(b.ip.subarray(i * n0 * 7, (i + 1) * n0 * 7), i * n * 7)
    poseAt(i, b.frames).forEach((p, k) => ip.set([...p.pos, ...p.rot], (i * n + n0 + k) * 7))
  }
  return { ...b, implements: [...b.implements, ...extra], ip }
}

describe('stations in a motion', () => {
  const away = (x: number, p: ImplementPose): ImplementPose => ({ ...p, pos: [p.pos[0] + x, p.pos[1], p.pos[2] - 3] })
  const frame = hackSquat(), sled = hackSled(), tb = tbarStation(), lever = tbarLever(), rh = reverseHyper(), hl = hyperLever(), bs = beltSquat(), bl = beltLever(), belt = hipBelt(), cc = captainsChair()
  const still = (id: string): ImplementPose => ({ id, pos: [0, 0, 0], rot: [0, 0, 0, 1] })
  const b = withImplements([frame, sled, tb, lever, rh, hl, bs, bl, belt, cc], (i, n) => {
    const u = Math.sin((Math.PI * i) / n)
    return [
      away(-4, still(frame.id)),
      away(-4, sledPose(sled.id, frame, 0.2 + 0.3 * u)),
      away(4, still(tb.id)),
      away(4, leverPose(lever.id, TBAR.pivot, 12 * u)),
      away(8, still(rh.id)),
      away(8, leverPose(hl.id, REVERSE_HYPER.pivot, 30 * u)),
      away(-8, still(bs.id)),
      away(-8, leverPose(bl.id, BELT_SQUAT.pivot, BELT_SQUAT.lift * u)),
      away(-8, { id: belt.id, pos: [0, 0.6 + 0.35 * u, -0.02], rot: [0, 0, 0, 1] }),
      away(12, still(cc.id)),
    ]
  })
  const poses = (i: number) =>
    new Map(b.implements.map((s, k) => {
      const o = (i * b.implements.length + k) * 7
      return [s.id, { id: s.id, pos: [b.ip[o], b.ip[o + 1], b.ip[o + 2]], rot: [b.ip[o + 3], b.ip[o + 4], b.ip[o + 5], b.ip[o + 6]] } as ImplementPose]
    }))

  it('are drawn by the composer: frames rigid, sled and levers rebuilt every frame', () => {
    const props = new Map(motionProps(b, b.params).map((p) => [p.key, p]))
    for (const id of [frame.id, tb.id, rh.id, bs.id, cc.id]) expect(props.get(id)?.type, id).toBe('rigid')
    const chair = props.get(cc.id)
    expect(chair?.type === 'rigid' && chair.whole).toBe(true)
    for (const id of [sled.id, lever.id, hl.id, bl.id]) {
      const p = props.get(id)!
      expect(p.type, id).toBe('dynamic')
      if (p.type !== 'dynamic') continue
      const a = p.build(poses(0)), z = p.build(poses(Math.floor(b.frames / 2)))
      // the belt's chain gains links as it lengthens
      if (id !== bl.id) expect(a.length, id).toBe(z.length)
      expect(a[0].matrix.equals(z[0].matrix), id).toBe(false)
    }
    expect(props.has(belt.id)).toBe(false)
  })

  it('collide the solid pieces only: no strap, belt or chain; hands may close on the held handles', () => {
    const m = new Map(machineColliders(b).map((x) => [x.key, x]))
    const p = poses(10)
    for (const id of [frame.id, sled.id, tb.id, lever.id, rh.id, hl.id, bs.id, bl.id, cc.id]) expect(m.get(id)!.at(p).colliders.length, id).toBeGreaterThan(3)
    for (const id of [sled.id, lever.id, bs.id, cc.id, rh.id]) expect(m.get(id)!.holds, id).toEqual([id])
    expect(m.get(hl.id)!.holds).toEqual([])
    const props = new Map(motionProps(b, b.params).map((x) => [x.key, x]))
    const drawn = (id: string) => {
      const x = props.get(id)!
      return x.type === 'dynamic' ? x.build(p).length : 0
    }
    // the hyper strap and the belt with its chain are drawn but not collided
    expect(drawn(hl.id)).toBeGreaterThan(buildHyperLever(hl, { strap: false }).pieces.length)
    expect(drawn(bl.id)).toBeGreaterThan(buildBeltLever(bl).pieces.length + 5)
    expect(m.get(hl.id)!.at(p).colliders.length).toBe(pieceColliders(buildHyperLever(hl, { strap: false }).pieces).length)
    expect(m.get(bl.id)!.at(p).colliders.length).toBe(pieceColliders(buildBeltLever(bl).pieces).length)
  })
})

describe('station gallery', () => {
  it('shows every station alone and together', () => {
    for (const k of stationNames) {
      const g = galleryScene(`props-${k}`)!
      expect(g.pieces.length, k).toBeGreaterThan(20)
      expect(g.figure, k).toBeDefined()
    }
    const all = galleryScene('props-stations')!
    expect(all.markers.length).toBeGreaterThan(40)
  })
})
