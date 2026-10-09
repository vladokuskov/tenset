import { Matrix4, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { bake, frameImplements, type Baked } from '../../../motion/bake.ts'
import { sdBox, sdCylinder } from '../../../motion/collide.ts'
import { testSkeleton, motionRecords } from '../../../motion/testing.ts'
import { getTemplate, parseParams } from '../../../motion/templates/index.ts'
import { motionProps, type PropSpec } from '../motion/compose'
import { benchLayout, machineColliders, machineLayouts, pieceColliders, type Collider } from './collision'
import { Kit } from './kit'
import { buildLatPulldown } from './pulldown'
import { buildLegPress } from './legpress'

const skel = testSkeleton()
const baked: { slug: string; b: Baked }[] = ['curl', 'lateral-raise', 'vertical-pull', 'squat'].flatMap((t) =>
  motionRecords(t).map((r) => ({ slug: r.slug, b: bake(getTemplate(t), parseParams(t, r.params, r.laterality), skel) })),
)
const posesAt = (b: Baked, i: number) => new Map(frameImplements(b, i).map((p) => [p.id, p]))
const V = (v: readonly number[]) => new Vector3(v[0], v[1], v[2])

/** composer props that are drawn machines (held implements follow an implement; fixtures are its own parts) */
const machineProps = (props: PropSpec[]) => props.filter((p) => p.type === 'dynamic' || p.type === 'bench' || (p.type === 'rigid' && !p.attach && p.key !== 'bench' && p.key !== 'post'))

function surface(c: Collider, p: Vector3) {
  if (c.shape === 'cylinder') return sdCylinder([p.x, p.y, p.z], c.a, c.b, c.r)
  return sdBox([p.x, p.y, p.z], c.center, c.size.map((s) => s / 2) as [number, number, number], c.rot ?? [0, 0, 0, 1])
}

describe('machine collision descriptors', () => {
  it('turn kit pieces into boxes and cylinders in the pieces frame', () => {
    const kit = new Kit()
    kit.rod([0, 0, 0], [0, 1, 1], 0.02, 'frame')
    kit.tube([0.5, 0, 0], [0.5, 2, 0], 0.08, 0.06, 'frame', { cap: 'b' })
    kit.box([0, 0.3, 0], [0.4, 0.065, 0.4], 'pad', new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.3))
    kit.plate([1, 1, 0], [1, 0, 0], 0.225, 0.05)
    kit.hole([0, 1, 0], [0, 0, 1])
    kit.rod([0, 0, 0], [0, 2, 0], 0.003, 'cable')
    kit.box([0, 0.006, 1], [0.7, 0.012, 0.6], 'rubber')
    const [rod, tube, plug, pad, plate, tread] = pieceColliders(kit.pieces)
    expect(pieceColliders(kit.pieces)).toHaveLength(6)
    expect(rod).toMatchObject({ shape: 'cylinder', kind: 'frame', r: expect.closeTo(0.02, 9) })
    if (rod.shape !== 'cylinder' || tube.shape !== 'box' || pad.shape !== 'box' || plate.shape !== 'cylinder') throw new Error('shapes')
    expect(V(rod.a).distanceTo(new Vector3(0, 0, 0)) + V(rod.b).distanceTo(new Vector3(0, 1, 1))).toBeLessThan(1e-9)
    expect(tube.center.map((x) => +x.toFixed(9))).toEqual([0.5, 1, 0])
    expect(tube.size.map((x) => +x.toFixed(9))).toEqual([0.08, 2, 0.06])
    expect(plug.kind).toBe('frame')
    expect(pad).toMatchObject({ kind: 'pad', pad: true })
    // the pad's top face centre lies on the box surface
    const top = new Vector3(0, 0.0325, 0).applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.3)).add(new Vector3(0, 0.3, 0))
    expect(Math.abs(surface(pad, top))).toBeLessThan(1e-9)
    expect(plate).toMatchObject({ kind: 'plate', r: 0.225 })
    expect(V(plate.b).sub(V(plate.a)).toArray().map((x) => +x.toFixed(9))).toEqual([0.05, 0, 0])
    // a wide flat rubber face is a support surface
    expect(tread).toMatchObject({ kind: 'pad', pad: true })
  })

  it('put seats, pads and foot plates where the machines put their contact sockets', () => {
    const lp = buildLegPress({ sled: 0.8 })
    const lpc = pieceColliders(lp.pieces)
    const onPad = (p: Vector3) => lpc.filter((c) => c.pad).some((c) => Math.abs(surface(c, p)) < 1e-6)
    expect(onPad(lp.sockets.seat.position)).toBe(true)
    expect(onPad(lp.sockets.back.position)).toBe(true)
    expect(onPad(lp.sockets.footplate.position)).toBe(true)
    const pd = buildLatPulldown({ attachment: null })
    const pdc = pieceColliders(pd.pieces).filter((c) => c.pad)
    expect(pdc.some((c) => Math.abs(surface(c, pd.sockets.seat.position)) < 1e-6)).toBe(true)
    expect(pdc.some((c) => Math.abs(surface(c, pd.sockets.thighPad.contact.position.clone().setX(0.15))) < 1e-6)).toBe(true)
  })

  it('cover every machine the scene composer draws', () => {
    const seen = new Set<string>()
    for (const { slug, b } of baked) {
      const drawn = machineProps(motionProps(b, b.params)).map((p) => p.key).sort()
      expect(machineColliders(b).map((m) => m.key).sort(), slug).toEqual(drawn)
      drawn.forEach((k) => seen.add(k))
    }
    expect([...seen].sort()).toEqual(['anchor', 'assisted-pullup', 'band', 'bar', 'belt_lever', 'belt_squat', 'bench', 'bg_l', 'bg_r', 'box', 'cable-stack', 'crossover-l', 'crossover-r', 'hack', 'hack_sled', 'handle_l', 'handle_r', 'kb', 'kb_l', 'kb_r', 'landmine', 'lat-pulldown', 'leg-press', 'mat', 'pendulum', 'pendulum_arm', 'plate', 'preacher', 'pullup', 'ring_l', 'ring_r', 'rings', 'smith', 'strap_l', 'strap_r'])
  })

  it('lay the machines out exactly where the composer draws them', () => {
    for (const { slug, b } of baked) {
      const props = motionProps(b, b.params)
      for (const layout of machineLayouts(b)) {
        const prop = props.find((p) => p.key === layout.key)!
        for (const i of [0, Math.floor(b.frames / 3), Math.floor((2 * b.frames) / 3)]) {
          const poses = posesAt(b, i)
          const want = prop.type === 'dynamic' ? prop.build(poses) : prop.type === 'rigid' ? prop.pieces : []
          const { placement, pieces } = layout.build(poses)
          expect(pieces.length, `${slug} ${layout.key}`).toBe(want.length)
          pieces.forEach((p, k) => {
            const m = placement.clone().multiply(p.matrix)
            expect(p.geo, `${slug} ${layout.key} #${k}`).toBe(want[k].geo)
            expect(p.mat).toBe(want[k].mat)
            expect(Math.max(...m.elements.map((x, j) => Math.abs(x - want[k].matrix.elements[j]))), `${slug} ${layout.key} #${k}`).toBeLessThan(1e-9)
          })
          // colliding pieces leave out only the held implements and attachments
          const solid = layout.solid(poses).pieces
          expect(solid.length, `${slug} ${layout.key}`).toBeLessThan(pieces.length + 1)
          // portable implements (band, kettlebell, plate) are drawn here but collide through their implement parts;
          // the belt squat's hip belt and chain are drawn only
          if ((layout.fixed || solid.length) && layout.key !== 'belt_lever') expect(solid.length, `${slug} ${layout.key}`).toBeGreaterThan(pieces.length * 0.6)
        }
      }
      const bench = props.find((p) => p.type === 'bench')
      if (bench?.type === 'bench') {
        const spec = b.implements.find((s) => s.id === 'bench')!
        const k = b.implements.indexOf(spec)
        const mine = benchLayout(spec, { pos: [b.ip[k * 7], b.ip[k * 7 + 1], b.ip[k * 7 + 2]] })
        expect(mine.params, slug).toEqual(bench.params)
        expect(mine.position, slug).toEqual(bench.position)
      }
    }
  })

  it('place colliders in the world with the composer placement', () => {
    const { b } = baked.find((x) => x.slug.startsWith('303-'))!
    const m = machineColliders(b).find((x) => x.key === 'lat-pulldown')!
    const { pose, colliders } = m.at(posesAt(b, 0))
    expect(new Matrix4().compose(V(pose.pos), new Quaternion(...pose.rot), new Vector3(1, 1, 1)).equals(new Matrix4())).toBe(true)
    const seat = b.implements.find((s) => s.id === 'station')!.parts.find((p) => p.shape === 'box' && p.pad)!
    if (seat.shape !== 'box') throw new Error('seat')
    const top = new Vector3(seat.center[0], seat.center[1] + seat.size[1] / 2, seat.center[2])
    expect(colliders.filter((c) => c.pad).some((c) => Math.abs(surface(c, top.clone().setZ(0.05))) < 1e-6)).toBe(true)
  })
})
