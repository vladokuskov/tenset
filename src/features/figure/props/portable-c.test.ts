import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { bake, decode, encode, type Baked } from '../../../motion/bake.ts'
import { siteWorld, type ImplementSpec, type Part } from '../../../motion/implements.ts'
import * as bandsModule from '../../../motion/implements/bands.ts'
import * as freeWeightsModule from '../../../motion/implements/free-weights.ts'
import {
  abWheel,
  abWheelPose,
  abWheelSpin,
  bandPose,
  gymRing,
  gymRings,
  isRingAnchor,
  isRingStrap,
  landmine,
  landmineBar,
  landminePitchFor,
  landminePose,
  ringAnchor,
  ringPose,
  strapPath,
  AB_WHEEL,
  LANDMINE,
  MOVING_KINDS,
  PLATE,
  RING,
  RING_HEIGHT,
} from '../../../motion/implements/index.ts'
import * as portableC from '../../../motion/implements/portable-c.ts'
import * as shared from '../../../motion/implements/shared.ts'
import { dist, qrot, type V3 } from '../../../motion/math.ts'
import type { ImplementPose } from '../../../motion/skeleton.ts'
import { getTemplate, parseParams } from '../../../motion/templates/index.ts'
import { motionRecords, testSkeleton } from '../../../motion/testing.ts'
import { composeMotion, motionProps } from '../motion/compose'
import { machineColliders, pieceColliders } from './collision'
import { buildAbWheel, buildLandmine, buildLandmineBar, buildRing, buildRingAnchor, drawRingStrap, spinPieces } from './portable-c'
import { Kit } from './kit'
import { galleryScene } from './scenes'

const skel = testSkeleton()
const V = (a: readonly number[]) => new Vector3(a[0], a[1], a[2])
type Cyl = Extract<Part, { shape: 'cylinder' }>
const cyls = (s: ImplementSpec) => s.parts.filter((p): p is Cyl => p.shape === 'cylinder')
/** gates treat cylinders up to this radius under a gripping hand as handles (pipeline/motion/gates.ts HANDLE_R) */
const HANDLE_R = 0.03

function nearestAxis(spec: ImplementSpec, p: readonly number[]) {
  let best = { d: Infinity, c: null as Cyl | null }
  for (const c of cyls(spec)) {
    const a = V(c.a), ab = V(c.b).sub(a)
    const t = Math.min(1, Math.max(0, V(p).sub(a).dot(ab) / ab.lengthSq()))
    const d = a.addScaledVector(ab, t).distanceTo(V(p))
    if (d < best.d) best = { d, c }
  }
  return best
}

function expectHandleSite(spec: ImplementSpec, site: string) {
  const s = spec.sites[site]
  const { d, c } = nearestAxis(spec, s.pos)
  expect(d, `${spec.kind} ${site} on a handle axis`).toBeLessThan(1e-9)
  expect(c!.r, `${spec.kind} ${site} handle radius`).toBeLessThanOrEqual(HANDLE_R)
  const axis = V(c!.b).sub(V(c!.a)).normalize()
  expect(Math.abs(axis.dot(V(s.axis!).normalize())), `${spec.kind} ${site} axis along the handle`).toBeCloseTo(1, 9)
}

const pose = (id: string, pos: V3, rot: [number, number, number, number] = [0, 0, 0, 1]): ImplementPose => ({ id, pos, rot })

/** a baked curl with extra implements; `poseAt(i)` gives their poses per frame */
function withImplements(extra: ImplementSpec[], poseAt: (i: number) => ImplementPose[]): Baked {
  const r = motionRecords('curl').find((x) => x.id === 711)!
  const b = bake(getTemplate('curl'), parseParams('curl', r.params, r.laterality), skel)
  const n0 = b.implements.length, n = n0 + extra.length
  const ip = new Float32Array(b.frames * n * 7)
  for (let i = 0; i < b.frames; i++) {
    ip.set(b.ip.subarray(i * n0 * 7, (i + 1) * n0 * 7), i * n * 7)
    poseAt(i).forEach((p, k) => ip.set([...p.pos, ...p.rot], (i * n + n0 + k) * 7))
  }
  return { ...b, implements: [...b.implements, ...extra], ip }
}

const posesAt = (b: Baked, i: number) =>
  new Map(b.implements.map((s, k) => {
    const o = (i * b.implements.length + k) * 7
    return [s.id, pose(s.id, [b.ip[o], b.ip[o + 1], b.ip[o + 2]], [b.ip[o + 3], b.ip[o + 4], b.ip[o + 5], b.ip[o + 6]])]
  }))

describe('tier C portable implements', () => {
  it('declare unique kinds; rings, the landmine bar and the ab wheel move with the hands', () => {
    const all = [...shared.KINDS, ...bandsModule.KINDS, ...freeWeightsModule.KINDS, ...portableC.KINDS]
    expect(new Set(all).size).toBe(all.length)
    for (const k of ['gym_ring', 'landmine_bar', 'ab_wheel']) expect(MOVING_KINDS.has(k), k).toBe(true)
    for (const k of ['ring_strap', 'ring_anchor', 'landmine']) expect(MOVING_KINDS.has(k), k).toBe(false)
  })

  it('ring: the grip on a ring segment, 18 cm inside, the strap point at the top', () => {
    const ring = gymRing({ id: 'ring_l' })
    expectHandleSite(ring, 'grip')
    expect(2 * (RING.R - RING.r)).toBeCloseTo(0.18, 3)
    expect(ring.sites.strap.pos).toEqual([0, RING.R + RING.r, 0])
    for (const c of cyls(ring)) for (const e of [c.a, c.b]) expect(Math.hypot(e[0], e[1])).toBeCloseTo(RING.R / Math.cos(Math.PI / RING.segments), 9)
    const b = buildRing(ring)
    expect(b.bbox.max.x).toBeCloseTo(RING.R + RING.r, 3)
    expect(b.sockets.grip.position.toArray()).toEqual(ring.sites.grip.pos)
  })

  it('ring anchor: strap points under the beam, a rig to the floor or the beam alone', () => {
    const rig = ringAnchor({ height: 2.6, spread: 0.5 })
    expect(isRingAnchor(rig) && rig.mount).toBe('rig')
    expect(rig.sites.strap_l.pos).toEqual([0.25, 2.6 - RING.beam / 2, 0])
    expect(rig.sites.strap_r.pos[0]).toBe(-0.25)
    const b = buildRingAnchor(rig)
    expect(b.bbox.min.y).toBeCloseTo(0, 3)
    expect(b.bbox.max.y).toBeCloseTo(2.6 + RING.beam / 2, 2)
    const beam = buildRingAnchor(ringAnchor({ mount: 'beam' }))
    expect(beam.bbox.min.y).toBeGreaterThan(2.6)
    expect(ringAnchor({ mount: 'beam' }).parts).toHaveLength(1)
    // ring heights per use, low to high
    expect(Object.values(RING_HEIGHT)).toEqual([...Object.values(RING_HEIGHT)].sort((x, y) => x - y))
  })

  it('ring strap: no parts, a path from the anchor to the ring, posed with the hand on the grip', () => {
    const anchor = ringAnchor()
    const set = gymRings()
    expect(set.map((s) => s.id)).toEqual(['ring_l', 'strap_l', 'ring_r', 'strap_r'])
    const strap = set[1]
    expect(isRingStrap(strap) && strap.parts).toEqual([])
    const top = anchor.sites.strap_l.pos
    const ring = set[0]
    const p = ringPose(ring, [0.25, RING_HEIGHT.dip, 0.3], [0, 0, 1], top)
    // the ring hangs towards the anchor: the strap point is above the grip, on the line to the anchor
    const s = siteWorld(ring, p, 'strap').pos, g = siteWorld(ring, p, 'grip').pos
    expect(dist(g, [0.25, RING_HEIGHT.dip, 0.3])).toBeLessThan(1e-9)
    const up = V(top).sub(V(g)).normalize(), along = V(s).sub(V(g)).normalize()
    expect(up.dot(along)).toBeGreaterThan(0.999)
    const specs = new Map(set.concat(anchor).map((x) => [x.id, x]))
    const poses = new Map([[anchor.id, pose(anchor.id, [0, 0, 0])], [ring.id, p], [strap.id, bandPose(strap.id)]])
    const path = isRingStrap(strap) ? strapPath(strap, specs, poses) : []
    expect(path[0]).toEqual(top)
    expect(dist(path[1], s)).toBeLessThan(1e-9)
    const kit = drawRingStrap(new Kit(), path, qrot(p.rot, [1, 0, 0]))
    expect(kit.pieces.filter((x) => x.mat === 'rope').length).toBe(2)
    expect(kit.pieces.some((x) => x.mat === 'steel')).toBe(true)
  })

  it('landmine: the bar pivots rigidly, plates on the free end only, sites on the sleeve and the V-handle', () => {
    const base = landmine()
    expect(base.sites.pivot.pos).toEqual([0, LANDMINE.pivot, 0])
    const bar = landmineBar({ plateKg: 40, handle: 'v' })
    const plates = cyls(bar).filter((c) => c.r >= 0.06)
    expect(plates.map((c) => c.r)).toEqual([PLATE[20].r, PLATE[20].r])
    const tip = bar.sites.tip.pos[0]
    expect(tip).toBeCloseTo(LANDMINE.barOffset + 2.2, 9)
    for (const c of plates) expect(c.a[0]).toBeGreaterThan(tip - 0.45)
    for (const s of ['end', 'end_in', 'v_l', 'v_r']) expectHandleSite(bar, s)
    expect(nearestAxis(bar, bar.sites.cup_l.pos).d).toBeLessThan(0.04)
    // the V-handle sits under the shaft, inside the free end's collar
    expect(bar.sites.v_l.pos[1]).toBeLessThan(-0.08)
    expect(bar.sites.v_l.pos[0]).toBeLessThan(plates[0].a[0] - 0.15)
    expect(landmineBar().sites.v_l).toBeUndefined()
    // rigid about the pivot: every site keeps its distance from the pivot in any pose
    const pivot: V3 = [0.3, LANDMINE.pivot, -1]
    for (const [yaw, pitch] of [[0, 10], [180, 40], [35, 25]]) {
      const p = landminePose('bar', pivot, yaw, pitch)
      expect(p.pos).toEqual(pivot)
      for (const s of ['tip', 'v_l', 'cup_r']) expect(dist(siteWorld(bar, p, s).pos, pivot)).toBeCloseTo(Math.hypot(...bar.sites[s].pos), 9)
      const t = siteWorld(bar, p, 'tip').pos
      expect(Math.asin((t[1] - pivot[1]) / dist(t, pivot)) * (180 / Math.PI)).toBeCloseTo(pitch, 6)
    }
    // named sides: the press pose (yaw 180) puts cup_l on the lifter's left (+X), the row pose (yaw 0) v_l
    expect(siteWorld(bar, landminePose('bar', pivot, 180, 30), 'cup_l').pos[0]).toBeGreaterThan(pivot[0])
    expect(siteWorld(bar, landminePose('bar', pivot, 0, 20), 'v_l').pos[0]).toBeGreaterThan(pivot[0])
    // pitch solve for a grip height
    const pitch = landminePitchFor(bar, 'v_l', pivot, 0, 0.55)!
    expect(siteWorld(bar, landminePose('bar', pivot, 0, pitch), 'v_l').pos[1]).toBeCloseTo(0.55, 6)
    expect(landminePitchFor(bar, 'tip', pivot, 0, 4)).toBeNull()
  })

  it('landmine: the bar clears the base at every yaw from resting on its plates up', () => {
    const base = landmine(), bar = landmineBar({ plateKg: 20 })
    const basePieces = pieceColliders(buildLandmine(base).pieces)
    for (const yaw of [0, 90, 180, 250]) {
      for (const pitch of [2, 20, 60]) {
        const p = landminePose('bar', base.sites.pivot.pos, yaw, pitch)
        for (const c of cyls(bar)) {
          const a = siteWorld({ ...bar, sites: { a: { pos: c.a } } }, p, 'a').pos, b = siteWorld({ ...bar, sites: { b: { pos: c.b } } }, p, 'b').pos
          for (const k of basePieces) {
            if (k.shape !== 'cylinder') continue
            // the socket: a vertical cylinder under the pivot; the bar keeps out of it
            const top = Math.max(k.a[1], k.b[1])
            if (Math.hypot(a[0], a[2]) < k.r + 0.004) expect(a[1] - c.r, `yaw ${yaw} pitch ${pitch}`).toBeGreaterThan(top - 1e-9)
            if (Math.hypot(b[0], b[2]) < k.r + 0.004) expect(b[1] - c.r).toBeGreaterThan(top)
          }
        }
      }
    }
    const b = buildLandmineBar({ spec: landmineBar({ plateKg: 20, handle: 'v' }) })
    expect(b.bbox.max.x).toBeCloseTo(LANDMINE.barOffset + 2.2, 3)
    expect(b.pieces.filter((x) => x.geo.startsWith('plate:')).length).toBe(1)
    expect(Object.keys(b.sockets.grips).sort()).toEqual(['cup_l', 'cup_r', 'end', 'end_in', 'v_l', 'v_r'])
  })

  it('ab wheel: handles both sides of the axle, on the floor at its radius, the tyre turns with the distance rolled', () => {
    const spec = abWheel()
    for (const s of ['l', 'r']) expectHandleSite(spec, s)
    expect(spec.sites.l.pos[0]).toBeGreaterThan(AB_WHEEL.width / 2)
    const p = abWheelPose('wheel', 0.1, 0.5, 30)
    expect(siteWorld(spec, p, 'floor').pos[1]).toBeCloseTo(0, 9)
    // the axle stays level whatever the heading
    expect(Math.abs(qrot(p.rot, [1, 0, 0])[1])).toBeLessThan(1e-9)
    const fwd = qrot(p.rot, [0, 0, 1])
    expect(fwd[0]).toBeCloseTo(0.5, 9)
    const rolled = { ...p, pos: [p.pos[0] + fwd[0] * 0.2, p.pos[1], p.pos[2] + fwd[2] * 0.2] as V3 }
    expect(abWheelSpin(rolled) - abWheelSpin(p)).toBeCloseTo(0.2 / AB_WHEEL.R, 9)
    const b = buildAbWheel(spec)
    expect(b.bbox.max.y).toBeCloseTo(AB_WHEEL.R, 3)
    expect(b.bbox.max.x).toBeCloseTo(AB_WHEEL.handle.to, 2)
    const turned = spinPieces(b.wheel, 1)
    expect(turned[0].matrix.equals(b.wheel[0].matrix)).toBe(false)
    expect(turned).toHaveLength(b.wheel.length)
  })
})

describe('tier C portable equipment in a motion', () => {
  const anchor = ringAnchor({ id: 'rings' })
  const extra: ImplementSpec[] = [
    anchor,
    ...gymRings(),
    landmine(),
    landmineBar({ id: 'lbar', plateKg: 20, handle: 'v' }),
    abWheel(),
  ]
  const top = (s: 'l' | 'r'): V3 => [anchor.sites[`strap_${s}`].pos[0] + 2, anchor.sites[`strap_${s}`].pos[1], 0]
  const b = withImplements(extra, (i) => {
    const ring = (s: 'l' | 'r') => ringPose(extra[1], [top(s)[0], 1.25 - 0.002 * i, 0.1], [0, 0, 1], top(s))
    return [
      pose('rings', [2, 0, 0]),
      { ...ring('l'), id: 'ring_l' },
      bandPose('strap_l'),
      { ...ring('r'), id: 'ring_r' },
      bandPose('strap_r'),
      pose('landmine', [-1.5, 0, -1]),
      landminePose('lbar', [-1.5, LANDMINE.pivot, -1], 0, 10 + 0.2 * i),
      abWheelPose('wheel', 0.9, 0.6 + 0.004 * i),
    ]
  })

  it('are drawn by the composer: rings, bar and wheel follow, the straps rebuild every frame, the wheel turns', () => {
    const props = motionProps(b, b.params)
    const byKey = new Map(props.map((p) => [p.key, p]))
    for (const id of ['rings', 'ring_l', 'ring_r', 'strap_l', 'strap_r', 'landmine', 'lbar', 'wheel']) expect(byKey.has(id), id).toBe(true)
    const strap = byKey.get('strap_l')!, wheel = byKey.get('wheel')!
    if (strap.type !== 'dynamic' || wheel.type !== 'dynamic') throw new Error('dynamic props expected')
    const s0 = strap.build(posesAt(b, 0)), s1 = strap.build(posesAt(b, 40))
    expect(s0.every((p) => p.mat === 'rope' || p.mat === 'steel')).toBe(true)
    expect(s0[0].matrix.equals(s1[0].matrix)).toBe(false)
    // the wheel's tyre turns between frames, its handles only translate
    const w0 = wheel.build(posesAt(b, 0)), w1 = wheel.build(posesAt(b, 40))
    const rot = (m: (typeof w0)[number]) => m.matrix.elements.slice(0, 11)
    expect(rot(w0[0])).not.toEqual(rot(w1[0]))
    expect(rot(w0.at(-1)!)).toEqual(rot(w1.at(-1)!))
  })

  it('collide only where solid: the anchor and the landmine base as machines, held implements as their parts', () => {
    const machines = new Map(machineColliders(b).map((m) => [m.key, m]))
    const poses = posesAt(b, 0)
    for (const id of ['ring_l', 'strap_l', 'lbar', 'wheel']) expect(machines.get(id)!.at(poses).colliders, id).toEqual([])
    expect(machines.get('rings')!.at(poses).colliders.length).toBeGreaterThan(4)
    expect(machines.get('landmine')!.at(poses).colliders.length).toBeGreaterThanOrEqual(3)
  })

  it('survive the compact format and frame the held implements', () => {
    const back = decode(encode(b, skel), skel)
    const strap = back.implements.find((s) => s.id === 'strap_l')!
    expect(isRingStrap(strap) && strap.strap.path.map((p) => p.implement)).toEqual(['rings', 'ring_l'])
    const a = back.implements.find((s) => s.id === 'rings')!
    expect(isRingAnchor(a) && a.mount).toBe('rig')
    const ex = { groups: { biceps: 'primary' as const }, laterality: 'bilateral', media: { mapView: 'F' as const } }
    const frame = composeMotion(ex as never, b, skel).frame
    let minX = Infinity
    for (let i = 0; i < frame.length; i += 3) minX = Math.min(minX, frame[i])
    // the landmine bar's far end is framed
    expect(minX).toBeLessThan(-1.5 - 0.02)
  })
})

describe('tier C gallery', () => {
  it('shows rings, landmines and ab wheels', () => {
    for (const name of ['props-portable-c', 'props-rings', 'props-landmine', 'props-abwheel']) {
      const g = galleryScene(name)!
      expect(g.pieces.length, name).toBeGreaterThan(20)
      expect(g.markers.length, name).toBeGreaterThan(4)
    }
    const all = galleryScene('props-portable-c')!.pieces
    expect(all.filter((p) => p.geo.startsWith('torus:')).length).toBeGreaterThanOrEqual(6)
  })
})
