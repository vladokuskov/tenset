import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { bake, type Baked } from '../../../motion/bake.ts'
import { sdBox } from '../../../motion/collide.ts'
import type { ImplementSpec } from '../../../motion/implements.ts'
import { flatBench, floorMat, PLYO_BOX, plyoBox, TREAD, wallSection } from '../../../motion/implements/index.ts'
import { getTemplate, parseParams } from '../../../motion/templates/index.ts'
import { motionRecords, testSkeleton } from '../../../motion/testing.ts'
import { motionProps } from '../motion/compose'
import { benchLayout, machineColliders, pieceColliders, type Collider } from './collision'
import { galleryScene } from './scenes'
import { buildFloorMat, buildPlyoBox, buildWall } from './shared'
import { benchSockets } from './sockets'

const skel = testSkeleton()
const V = (v: readonly number[]) => new Vector3(v[0], v[1], v[2])
const onSurface = (cs: Collider[], p: Vector3) =>
  cs.some((c) => c.shape === 'box' && Math.abs(sdBox([p.x, p.y, p.z], c.center, c.size.map((s) => s / 2) as [number, number, number], c.rot ?? [0, 0, 0, 1])) < 1e-6)

/** a baked curl with extra still implements placed at fixed poses */
function withSupports(extra: { spec: ImplementSpec; pos: [number, number, number] }[]): Baked {
  const r = motionRecords('curl').find((x) => x.id === 711)!
  const b = bake(getTemplate('curl'), parseParams('curl', r.params, r.laterality), skel)
  const n0 = b.implements.length, n = n0 + extra.length
  const ip = new Float32Array(b.frames * n * 7)
  for (let i = 0; i < b.frames; i++) {
    ip.set(b.ip.subarray(i * n0 * 7, (i + 1) * n0 * 7), i * n * 7)
    extra.forEach((e, k) => ip.set([...e.pos, 0, 0, 0, 1], (i * n + n0 + k) * 7))
  }
  return { ...b, implements: [...b.implements, ...extra.map((e) => e.spec)], ip }
}

describe('shared supports', () => {
  it('draw the plyo box at the three heights with the top socket on the rubber tread', () => {
    for (const h of PLYO_BOX.heights) {
      const b = buildPlyoBox({ height: h })
      const cs = pieceColliders(b.pieces)
      expect(b.bbox.max.y).toBeCloseTo(h, 6)
      expect(cs.filter((c) => c.pad)).toHaveLength(1)
      expect(onSurface(cs.filter((c) => c.pad), b.sockets.top.position)).toBe(true)
      // the drawn box matches the template geometry the motion plants feet on
      const spec = plyoBox({ height: h })
      expect(b.sockets.top.position.toArray()).toEqual(spec.sites.top.pos)
      expect(b.sockets.front.position.toArray()).toEqual(spec.sites.front.pos)
      const tread = spec.parts.find((p) => p.pad)!
      expect(tread.shape === 'box' && tread.center[1] + tread.size[1] / 2).toBeCloseTo(h, 9)
      expect(tread.shape === 'box' && tread.size[1]).toBe(TREAD)
    }
  })

  it('draw a thin padded mat and a wall whose face is the plane z = 0', () => {
    const mat = buildFloorMat()
    expect(mat.bbox.max.y).toBeLessThan(0.02)
    expect(pieceColliders(mat.pieces).every((c) => c.kind === 'pad')).toBe(true)
    expect(mat.sockets.top.position.y).toBeCloseTo(floorMat().sites.top.pos[1], 9)
    const wall = buildWall()
    const cs = pieceColliders(wall.pieces)
    expect(cs.every((c) => c.kind === 'frame' || c.kind === 'rail')).toBe(true)
    expect(onSurface(cs, wall.sockets.face.position)).toBe(true)
    expect(wall.bbox.min.y).toBeCloseTo(0, 6)
  })

  it('are drawn by the composer and collided by the QA gate where the template places them', () => {
    const b = withSupports([
      { spec: plyoBox({ height: 0.3 }), pos: [0.6, 0, 0.5] },
      { spec: floorMat(), pos: [-0.8, 0, 0] },
      { spec: wallSection(), pos: [0, 0, -0.6] },
    ])
    const props = motionProps(b, b.params)
    expect(props.filter((p) => ['box', 'mat', 'wall'].includes(p.key)).map((p) => p.type)).toEqual(['rigid', 'rigid', 'rigid'])
    const machines = machineColliders(b)
    expect(machines.map((m) => m.key)).toEqual(expect.arrayContaining(['box', 'mat', 'wall']))
    const box = machines.find((m) => m.key === 'box')!.at(new Map())
    expect(V(box.pose.pos).distanceTo(new Vector3(0.6, 0, 0.5))).toBeLessThan(1e-6)
    expect(onSurface(box.colliders.filter((c) => c.pad), V(plyoBox({ height: 0.3 }).sites.top.pos))).toBe(true)
  })

  it('draw the adjustable bench flat: back pad level with the seat, laid out under a flat template bench', () => {
    const s = benchSockets({ back: 0, height: 0.44 })
    expect(s.back.position.y).toBeCloseTo(0.44, 6)
    expect(s.back.normal.toArray().map((x) => +x.toFixed(9))).toEqual([0, 1, 0])
    const spec = flatBench({ seatHeight: 0.44 })
    const { params, position } = benchLayout(spec, { pos: [0, 0.44, 0.1] })
    expect(params.back).toBeCloseTo(0, 9)
    expect(position.every(Number.isFinite)).toBe(true)
    expect(position[2]).toBeCloseTo(0.1 + 0.16, 9)
  })

  it('show up in the props gallery', () => {
    const g = galleryScene('props-shared')!
    expect(g.pieces.length).toBeGreaterThan(8)
    expect(g.benches?.length).toBe(1)
  })
})
