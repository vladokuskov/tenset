import { describe, expect, it } from 'vitest'
import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts, restAgainst, sdBox, sdCylinder, segmentDistance } from './collide.ts'
import { centerOfMass, centerOfPressure, fk } from './fk.ts'
import { dumbbell, type Part } from './implements.ts'
import { qaxis, type V3 } from './math.ts'
import { zeroQ } from './skeleton.ts'
import { rng, testSkeleton } from './testing.ts'

const skel = testSkeleton()

describe('clearance geometry', () => {
  it('segment distance matches brute force', () => {
    const r = rng(4)
    const p = (): V3 => [r() - 0.5, r() - 0.5, r() - 0.5]
    for (let k = 0; k < 200; k++) {
      const [a, b, c, d] = [p(), p(), p(), p()]
      let brute = Infinity
      for (let i = 0; i <= 60; i++) for (let j = 0; j <= 60; j++) {
        const s = i / 60, t = j / 60
        brute = Math.min(brute, Math.hypot(...[0, 1, 2].map((n) => a[n] + (b[n] - a[n]) * s - c[n] - (d[n] - c[n]) * t)))
      }
      expect(segmentDistance(a, b, c, d).d).toBeLessThanOrEqual(brute + 1e-9)
      expect(segmentDistance(a, b, c, d).d).toBeGreaterThan(brute - 0.02)
    }
  })

  it('signed distances to cylinders and boxes are negative inside and exact outside', () => {
    expect(sdCylinder([0, 0, 0], [-1, 0, 0], [1, 0, 0], 0.1)).toBeCloseTo(-0.1, 9)
    expect(sdCylinder([0, 0.3, 0], [-1, 0, 0], [1, 0, 0], 0.1)).toBeCloseTo(0.2, 9)
    expect(sdCylinder([1.3, 0, 0], [-1, 0, 0], [1, 0, 0], 0.1)).toBeCloseTo(0.3, 9)
    expect(sdCylinder([1.3, 0.5, 0], [-1, 0, 0], [1, 0, 0], 0.1)).toBeCloseTo(0.5, 9)
    expect(sdBox([0, 0.2, 0], [0, 0, 0], [0.1, 0.1, 0.1], [0, 0, 0, 1])).toBeCloseTo(0.1, 9)
    expect(sdBox([0, 0.2, 0], [0, 0, 0], [0.1, 0.1, 0.1], qaxis([0, 0, 1], Math.PI / 4))).toBeCloseTo(0.2 - 0.1 * Math.SQRT2, 9)
  })

  it('capsule vs a fat short cylinder (dumbbell head) uses the real flat faces, not a capsule hull', () => {
    const db = dumbbell({ id: 'db', mass: 12 })
    const [, head] = placeParts(db, { id: 'db', pos: [0, 0, 0], rot: [0, 0, 0, 1] })
    const part = db.parts[1] as Part & { shape: 'cylinder' }
    // a thin capsule parallel to the handle, just beyond the head's outer face
    const x = part.b[0] + 0.01
    expect(capsuleSolidClearance({ a: [x, -0.05, 0], b: [x, 0.05, 0], r: 0.001 }, head)).toBeCloseTo(0.009, 6)
    // and one crossing the rim diagonally
    expect(capsuleSolidClearance({ a: [0.07, part.r + 0.02, -0.1], b: [0.07, part.r + 0.02, 0.1], r: 0.005 }, head)).toBeCloseTo(0.015, 6)
  })

  it('body capsules measured from the mesh: standing relaxed, arms and legs clear each other', () => {
    const caps = bodyCapsules(skel, fk(skel, zeroQ(skel)))
    expect(caps.length).toBeGreaterThan(40)
    const get = (n: string) => caps.find((c) => c.name === n)!
    // left and right thighs, hands and thighs do not overlap standing
    expect(capsuleClearance(get('thigh_l2'), get('thigh_r2'))).toBeGreaterThan(-0.01)
    expect(capsuleClearance(get('fist_l'), get('thigh_l3p'))).toBeGreaterThan(-0.01)
    for (const c of caps) expect(c.r).toBeGreaterThan(0.015)
  })

  it('restAgainst slides a pad until it just touches the body', () => {
    const caps = bodyCapsules(skel, fk(skel, zeroQ(skel))).filter((c) => c.region === 'trunk')
    const pad: Part & { shape: 'box' } = { shape: 'box', center: [0, 1.3, 0], size: [0.3, 0.05, 0.3], rot: qaxis([1, 0, 0], Math.PI / 2), pad: true }
    const placed = restAgainst(caps, pad, [0, 0, -1], -0.01)
    const [s] = placeParts({ id: 'p', kind: 'bench', mass: 0, com: [0, 0, 0], parts: [placed], sites: {} }, { id: 'p', pos: [0, 0, 0], rot: [0, 0, 0, 1] })
    expect(Math.min(...caps.map((c) => capsuleSolidClearance(c, s)))).toBeCloseTo(-0.01, 4)
  })
})

describe('centre of pressure', () => {
  it('equals the centre of mass without external forces; a forward cable pull shifts it forward (the balance solve leans back)', () => {
    const f = fk(skel, zeroQ(skel))
    const com = centerOfMass(skel, f)
    const [x, z] = centerOfPressure(skel, f)
    expect(x).toBeCloseTo(com[0], 9)
    expect(z).toBeCloseTo(com[2], 9)
    // ~14 kg pulling the hands forward and down at hip height
    const pulled = centerOfPressure(skel, f, [], [{ at: [0, 0.9, 0.1], force: [0, -100, 100] }])
    expect(pulled[1]).toBeGreaterThan(com[2] + 0.05)
  })
})
