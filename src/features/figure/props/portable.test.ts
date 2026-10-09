import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { bake, decode, encode, type Baked } from '../../../motion/bake.ts'
import { barbell, type ImplementSpec, type Part } from '../../../motion/implements.ts'
import * as bandsModule from '../../../motion/implements/bands.ts'
import * as freeWeightsModule from '../../../motion/implements/free-weights.ts'
import {
  around,
  band,
  bandAnchor,
  bandGrip,
  bandHandle,
  bandNode,
  bandPath,
  bandPose,
  isAnchor,
  isBand,
  kettlebell,
  kettlebellDims,
  KETTLEBELL_KG,
  MOVING_KINDS,
  PLATE,
  poseHandle,
  TRAP_BAR,
  trapBar,
  weightPlate,
  BAND,
  BAND_ANCHOR,
  BAND_HANDLE,
} from '../../../motion/implements/index.ts'
import { bandWidthAxis } from '../../../motion/implements/bands.ts'
import * as shared from '../../../motion/implements/shared.ts'
import { dist, dot, qrot, type V3 } from '../../../motion/math.ts'
import type { ImplementPose } from '../../../motion/skeleton.ts'
import { getTemplate, parseParams } from '../../../motion/templates/index.ts'
import { motionRecords, testSkeleton } from '../../../motion/testing.ts'
import { composeMotion, motionProps } from '../motion/compose'
import { buildBandAnchor, buildBandHandle, BAND_MAT, drawBandStrip } from './band'
import { machineColliders, pieceColliders } from './collision'
import { buildKettlebell, buildTrapBar, buildWeightPlate } from './free-weights'
import { Kit } from './kit'
import { galleryScene } from './scenes'

const skel = testSkeleton()
const V = (a: readonly number[]) => new Vector3(a[0], a[1], a[2])
type Cyl = Extract<Part, { shape: 'cylinder' }>
const cyls = (s: ImplementSpec) => s.parts.filter((p): p is Cyl => p.shape === 'cylinder')
/** gates treat cylinders up to this radius under a gripping hand as handles (pipeline/motion/gates.ts HANDLE_R) */
const HANDLE_R = 0.03

/** distance from a point to the nearest cylinder axis, with that cylinder */
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

/** a baked curl with extra implements; `poseAt(i)` gives their poses per frame */
function withImplements(extra: ImplementSpec[], poseAt: (i: number, b: Baked) => ImplementPose[]): Baked {
  const r = motionRecords('curl').find((x) => x.id === 711)!
  const b = bake(getTemplate('curl'), parseParams('curl', r.params, r.laterality), skel)
  const n0 = b.implements.length, n = n0 + extra.length
  const ip = new Float32Array(b.frames * n * 7)
  for (let i = 0; i < b.frames; i++) {
    ip.set(b.ip.subarray(i * n0 * 7, (i + 1) * n0 * 7), i * n * 7)
    poseAt(i, b).forEach((p, k) => ip.set([...p.pos, ...p.rot], (i * n + n0 + k) * 7))
  }
  return { ...b, implements: [...b.implements, ...extra], ip }
}

describe('portable implements', () => {
  it('declare unique kinds, and the held ones move with the hands', () => {
    const all = [...shared.KINDS, ...bandsModule.KINDS, ...freeWeightsModule.KINDS]
    expect(new Set(all).size).toBe(all.length)
    for (const k of ['kettlebell', 'weight_plate', 'trap_bar', 'band_handle', 'band_grip']) expect(MOVING_KINDS.has(k), k).toBe(true)
    for (const k of ['band', 'band_node', 'band_anchor']) expect(MOVING_KINDS.has(k), k).toBe(false)
  })

  it('kettlebell 12-32 kg: grip sites on the handle, sizes grow with mass, a window a forearm fits through', () => {
    let prev = 0
    for (const kg of KETTLEBELL_KG) {
      const spec = kettlebell({ kg })
      const d = kettlebellDims(kg)
      expect(spec.mass).toBe(kg)
      expect(d.R).toBeGreaterThan(prev)
      prev = d.R
      for (const s of ['handle', 'handle_l', 'handle_r', 'horn_l', 'horn_r', 'corner_l', 'corner_r']) expectHandleSite(spec, s)
      expect(spec.sites.horn_l.pos[0]).toBeGreaterThan(0)
      expect(spec.sites.horn_l.axis![1]).toBeGreaterThan(0.85)
      // inside height of the window, bell top to the bar's underside
      expect(d.top - d.handleR - d.R).toBeGreaterThan(0.07)
      // inside width between the horns at the top
      expect(2 * (d.hornX - d.handleR)).toBeGreaterThan(0.13)
      const b = buildKettlebell({ kg })
      expect(b.bbox.min.y).toBeCloseTo(-d.base, 6)
      expect(b.bbox.max.y).toBeCloseTo(d.top + d.handleR, 3)
      expect(b.bbox.max.x).toBeCloseTo(Math.max(d.R, d.hornX + d.handleR), 3)
      expect(spec.sites.base.pos[1]).toBeCloseTo(-d.base, 9)
      // the gate slabs stay within a centimetre of the drawn sphere
      for (const c of cyls(spec).filter((c) => c.r > HANDLE_R)) {
        for (const y of [c.a[1], c.b[1]]) if (Math.abs(y) < d.R) expect(Math.abs(c.r - Math.sqrt(d.R ** 2 - y ** 2))).toBeLessThan(0.025)
      }
    }
  })

  it('weight plate 5 / 10 / 20 kg: barbell plate sizes, rim grips at 9 and 3 o clock, faces either side', () => {
    const bar = cyls(barbell({ gripWidth: 0.8, plateKg: 35 })).filter((c) => c.r >= 0.06 && c.a[0] > 0)
    expect(bar.map((c) => [c.r, +Math.abs(c.b[0] - c.a[0]).toFixed(6)])).toEqual([[PLATE[20].r, PLATE[20].w], [PLATE[10].r, PLATE[10].w], [PLATE[5].r, PLATE[5].w]])
    for (const kg of [5, 10, 20] as const) {
      const spec = weightPlate({ kg })
      const { r, w } = PLATE[kg]
      for (const s of ['rim_l', 'rim_r', 'rim_top', 'rim_bottom']) expectHandleSite(spec, s)
      expect(spec.sites.rim_l.pos[0]).toBeCloseTo(r - w / 2, 9)
      expect(spec.sites.front.pos[2]).toBeCloseTo(w / 2, 9)
      expect(spec.sites.back.normal).toEqual([0, 0, -1])
      // the parts cover the plate out to its rim
      const reach = Math.max(...cyls(spec).map((c) => Math.hypot(c.a[0], c.a[1]) + c.r))
      expect(reach).toBeGreaterThan(r - 0.002)
      const b = buildWeightPlate({ kg })
      expect(b.bbox.max.x).toBeCloseTo(r, 3)
      expect(b.bbox.max.z - b.bbox.min.z).toBeCloseTo(w, 6)
    }
  })

  it('trap bar: neutral handles both sides, high above and low below the sleeve axis, barbell plates', () => {
    const hi = trapBar({ plateKg: 40 }), lo = trapBar({ plateKg: 40, handles: 'low' })
    for (const spec of [hi, lo]) for (const s of ['l', 'r']) expectHandleSite(spec, s)
    expect(hi.sites.l.pos).toEqual([TRAP_BAR.handleX, TRAP_BAR.rise, 0])
    expect(lo.sites.r.pos).toEqual([-TRAP_BAR.handleX, -TRAP_BAR.rise, 0])
    expect(hi.sites.l.axis).toEqual([0, 0, 1])
    expect(hi.mass).toBe(TRAP_BAR.mass + 80)
    const b = buildTrapBar({ plateKg: 40 })
    expect(b.sockets.floorHeight).toBeCloseTo(PLATE[20].r, 9)
    expect(b.bbox.max.x).toBeCloseTo(TRAP_BAR.sleeve.to, 6)
    expect(b.pieces.filter((p) => p.geo.startsWith('plate:')).length).toBe(4)
    expect(b.sockets.grips.l.position.toArray()).toEqual(hi.sites.l.pos)
    // the hexagon leaves room to stand: the handles are 63 cm apart and the frame 58 cm deep
    expect(2 * TRAP_BAR.handleX).toBeCloseTo(0.63, 6)
    expect(2 * TRAP_BAR.hex.c).toBeGreaterThan(0.5)
  })
})

describe('bands', () => {
  it('resolve the path through sites, offsets and node poses', () => {
    const h = bandHandle({ id: 'h' }), a = bandAnchor({ height: 1.2 }), n = bandNode('n')
    const spec = band({ path: [{ implement: 'anchor', site: 'hook' }, { implement: 'h', site: 'ring' }, { implement: 'n', at: [0.1, 0, 0] }] })
    const specs = new Map<string, ImplementSpec>([[h.id, h], [a.id, a], [n.id, n]])
    const rotY: [number, number, number, number] = [0, Math.SQRT1_2, 0, Math.SQRT1_2]
    const poses = new Map<string, ImplementPose>([
      ['anchor', { id: 'anchor', pos: [0, 0, -1], rot: [0, 0, 0, 1] }],
      ['h', { id: 'h', pos: [0.2, 1.1, 0.3], rot: [0, 0, 0, 1] }],
      ['n', { id: 'n', pos: [0, 0, 0], rot: rotY }],
    ])
    const p = bandPath(spec, specs, poses)
    expect(p[0].pos).toEqual([0, 1.2, -1 + 0.045])
    expect(p[1].pos).toEqual([0.2, 1.1, 0.3])
    expect(dist(p[2].pos, [0, 0, -0.1])).toBeLessThan(1e-9)
    expect(() => bandPath(band({ path: [{ implement: 'h', site: 'nope' }] }), specs, poses)).toThrow(/no site/)
    expect(isBand(spec) && spec.band.width).toBe(BAND.width.medium)
  })

  it('wrap round a limb: around() points on the ellipse, facing out', () => {
    const pts = around('knee', { r: [0.07, 0.05], from: 0, to: 360, n: 13 })
    expect(pts).toHaveLength(13)
    for (const p of pts) {
      const [x, , z] = p.at!
      expect((x / 0.07) ** 2 + (z / 0.05) ** 2).toBeCloseTo(1, 9)
      expect(dot(p.face!, [x, 0, z])).toBeGreaterThan(0)
    }
    const thigh = around('t', { r: 0.08, from: 0, to: 180, axis: 'x' })
    expect(thigh[0].at).toEqual([0, 0.08, 0])
  })

  it('draw a flat strip in band rubber that never collides, its width across the run', () => {
    const verts = [{ pos: [0, 1, 0] as V3 }, { pos: [0, 1, 1] as V3 }, { pos: [0, 0, 1] as V3 }]
    const kit = drawBandStrip(new Kit(), verts, { width: 0.02 })
    expect(kit.pieces).toHaveLength(2)
    expect(kit.pieces.every((p) => p.mat === BAND_MAT)).toBe(true)
    expect(pieceColliders(kit.pieces)).toEqual([])
    expect(drawBandStrip(new Kit(), verts, { closed: true }).pieces).toHaveLength(3)
    for (const [a, b] of [[[0, 0, 0], [1, 0, 0]], [[0, 0, 0], [0, 1, 0]], [[0, 0, 0], [0.3, 1, 0.2]]] as [V3, V3][]) {
      const w = bandWidthAxis(a, b)
      expect(Math.abs(dot(w, [b[0] - a[0], b[1] - a[1], b[2] - a[2]]))).toBeLessThan(1e-9)
    }
    // a band under a sole faces down: its width lies flat
    expect(Math.abs(bandWidthAxis([0, 0, 0], [0, 0, 1], [0, -1, 0])[1])).toBeLessThan(1e-9)
  })

  it('pose a handle with its grip at the hand, axis along the hand and the ring towards the anchor', () => {
    const h = bandHandle({ id: 'h' })
    const pose = poseHandle(h, 'c', [0.2, 1, 0.4], [0, 0, 1], [0.2, 1.3, -0.6])
    const grip = qrot(pose.rot, h.sites.c.pos).map((x, k) => x + pose.pos[k])
    expect(dist(grip as V3, [0.2, 1, 0.4])).toBeLessThan(1e-9)
    expect(dist(qrot(pose.rot, [1, 0, 0]), [0, 0, 1])).toBeLessThan(1e-9)
    const ring = pose.pos
    expect(dist(ring, [0.2, 1, 0.4])).toBeCloseTo(BAND_HANDLE.drop, 9)
    expect(ring[1]).toBeGreaterThan(1)
    const b = buildBandHandle(h)
    expect(b.sockets.grip.position.toArray()).toEqual(h.sites.c.pos)
    expect(b.bbox.max.y).toBeGreaterThan(0)
  })

  it('anchor on a wall or a post: the hook stands off the mounting face at the chosen height', () => {
    for (const mount of ['wall', 'post'] as const) {
      const spec = bandAnchor({ height: 0.9, mount })
      expect(isAnchor(spec) && spec.mount).toBe(mount)
      expect(spec.sites.hook.pos).toEqual([0, 0.9, 0.045])
      const b = buildBandAnchor(spec)
      expect(b.bbox.min.y).toBeCloseTo(0, 3)
      expect(b.sockets.hook.distanceTo(V(spec.sites.hook.pos))).toBeLessThan(1e-9)
      // nothing but the post's floor plate stands in front of its ring
      expect(b.bbox.max.z).toBeLessThan(mount === 'wall' ? 0.045 + 0.02 : BAND_ANCHOR.post.base / 2)
    }
  })
})

describe('portable equipment in a motion', () => {
  const ids = ['kb', 'plate', 'trap', 'h_l', 'h_r', 'g', 'anchor', 'knee', 'band', 'loop']
  const extra: ImplementSpec[] = [
    kettlebell({ id: 'kb', kg: 16 }),
    weightPlate({ id: 'plate', kg: 10 }),
    trapBar({ id: 'trap', plateKg: 20 }),
    bandHandle({ id: 'h_l' }),
    bandHandle({ id: 'h_r' }),
    bandGrip({ id: 'g' }),
    bandAnchor({ height: 1.2 }),
    bandNode('knee'),
    band({ path: [{ implement: 'h_l', site: 'ring' }, { implement: 'anchor', site: 'hook' }, { implement: 'h_r', site: 'ring' }] }),
    band({ id: 'loop', path: around('knee', { r: 0.06, from: 0, to: 330, n: 12 }), closed: true, size: 'mini' }),
  ]
  const b = withImplements(extra, (i) => [
    { id: 'kb', pos: [0.8, 0.5, 0.5], rot: [0, 0, 0, 1] },
    { id: 'plate', pos: [-0.8, 1.0, 0.5], rot: [0, 0, 0, 1] },
    { id: 'trap', pos: [0, 0.225, 1.5], rot: [0, 0, 0, 1] },
    { id: 'h_l', pos: [0.3, 1.0 + 0.003 * i, 0.6], rot: [0, 0, 0, 1] },
    { id: 'h_r', pos: [-0.3, 1.0, 0.6], rot: [0, 0, 0, 1] },
    { id: 'g', pos: [0, 1.6, 0.5], rot: [0, 0, 0, 1] },
    { id: 'anchor', pos: [0, 0, -1.2], rot: [0, 0, 0, 1] },
    { id: 'knee', pos: [0.6, 0.5, -0.5], rot: [0, 0, 0, 1] },
    bandPose('band'),
    bandPose('loop'),
  ])

  it('are drawn by the composer: held weights follow their implement, the band follows its path every frame', () => {
    const props = motionProps(b, b.params)
    const byKey = new Map(props.map((p) => [p.key, p]))
    for (const id of ids.filter((x) => x !== 'knee')) expect(byKey.has(id), id).toBe(true)
    expect(byKey.has('knee')).toBe(false)
    const strip = byKey.get('band')!
    expect(strip.type).toBe('dynamic')
    if (strip.type !== 'dynamic') return
    const poses = (i: number) => new Map(b.implements.map((s, k) => {
      const o = (i * b.implements.length + k) * 7
      return [s.id, { id: s.id, pos: [b.ip[o], b.ip[o + 1], b.ip[o + 2]], rot: [b.ip[o + 3], b.ip[o + 4], b.ip[o + 5], b.ip[o + 6]] } as ImplementPose]
    }))
    const first = strip.build(poses(0)), later = strip.build(poses(40))
    expect(first).toHaveLength(2)
    expect(first.every((p) => p.mat === BAND_MAT)).toBe(true)
    expect(first[0].matrix.equals(later[0].matrix)).toBe(false)
    const kb = byKey.get('kb')!
    expect(kb.type === 'dynamic' && kb.build(poses(0)).length).toBeGreaterThan(5)
  })

  it('collide only where solid: the anchor as a machine, held weights as their implement parts, never the band', () => {
    const machines = new Map(machineColliders(b).map((m) => [m.key, m]))
    const poses = new Map(b.implements.map((s, k) => [s.id, { id: s.id, pos: [b.ip[k * 7], b.ip[k * 7 + 1], b.ip[k * 7 + 2]], rot: [b.ip[k * 7 + 3], b.ip[k * 7 + 4], b.ip[k * 7 + 5], b.ip[k * 7 + 6]] } as ImplementPose]))
    for (const id of ['band', 'loop', 'kb', 'plate', 'trap', 'h_l', 'g']) expect(machines.get(id)!.at(poses).colliders, id).toEqual([])
    expect(machines.get('anchor')!.at(poses).colliders.length).toBeGreaterThan(2)
    for (const id of ['band', 'loop', 'knee']) expect(b.implements.find((s) => s.id === id)!.parts).toEqual([])
  })

  it('survive the compact format and frame the held weights', () => {
    const back = decode(encode(b, skel), skel)
    const spec = back.implements.find((s) => s.id === 'band')!
    expect(isBand(spec) && spec.band.path.map((p) => p.implement)).toEqual(['h_l', 'anchor', 'h_r'])
    const anchor = back.implements.find((s) => s.id === 'anchor')!
    expect(isAnchor(anchor) && anchor.mount).toBe('wall')
    const ex = { groups: { biceps: 'primary' as const }, laterality: 'bilateral', media: { mapView: 'F' as const } }
    const scene = composeMotion(ex as never, b, skel)
    const frame = scene.frame
    let maxX = -Infinity
    for (let i = 0; i < frame.length; i += 3) maxX = Math.max(maxX, frame[i])
    // the kettlebell at x 0.8 is framed with its bell
    expect(maxX).toBeGreaterThan(0.8 + kettlebellDims(16).R - 0.01)
  })
})

describe('portable gallery', () => {
  it('shows bands, kettlebells, plates and the trap bar', () => {
    for (const name of ['props-portable', 'props-bands', 'props-weights']) {
      const g = galleryScene(name)!
      expect(g.pieces.length, name).toBeGreaterThan(20)
      expect(g.markers.length, name).toBeGreaterThan(4)
    }
    const all = galleryScene('props-portable')!.pieces
    expect(all.some((p) => p.mat === BAND_MAT)).toBe(true)
    expect(all.filter((p) => p.geo.startsWith('plate:')).length).toBe(4 + 3)
  })
})
