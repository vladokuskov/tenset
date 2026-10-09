import { describe, expect, it } from 'vitest'
import { RING } from '../implements/index.ts'
import { angleBetween, dot, norm, RAD, type V3 } from '../math.ts'
import { RING_LEAN, ringRig, ringSpread, ringUp } from './rings.ts'

describe('rings helper', () => {
  const axis: V3 = [0, 0, 1]

  it('a ring hangs along its strap unless the strap runs within RING_LEAN of the forearm', () => {
    // the forearm well off the strap line: the strap's direction
    expect(angleBetween(ringUp(axis, [0, 1, 0], [1, 0, 0], RING_LEAN, [1, 0, 0]), [0, 1, 0]) * RAD).toBeLessThan(1e-6)
    // the forearm along the strap: the ring turns RING_LEAN off it, on the `away` side
    const up = ringUp(axis, [0, 1, 0], [0, 1, 0], RING_LEAN, [1, 0, 0])
    expect(angleBetween(up, [0, 1, 0]) * RAD).toBeCloseTo(RING_LEAN, 6)
    expect(up[0]).toBeGreaterThan(0)
    expect(Math.abs(dot(up, axis))).toBeLessThan(1e-9)
    expect(ringUp(axis, [0, 1, 0], [0, 1, 0], RING_LEAN, [-1, 0, 0])[0]).toBeLessThan(0)
  })

  it('the lean is continuous as the strap swings in along the forearm and past it (no flip from side to side)', () => {
    let prev: V3 | null = null
    for (let a = 60; a >= -(RING_LEAN - 1); a -= 0.5) {
      const r = (a * Math.PI) / 180
      const up = ringUp(axis, [Math.sin(r), Math.cos(r), 0], [0, 1, 0], RING_LEAN, [1, 0, 0])
      if (prev) expect(angleBetween(prev, up) * RAD).toBeLessThan(1)
      prev = up
    }
  })

  it('straps hang just outside the grips by the leaning ring tops; the rig carries both rings and straps', () => {
    expect(ringSpread(0.2) / 2 - 0.2).toBeCloseTo((2 * RING.R + RING.r) * Math.sin((RING_LEAN * Math.PI) / 180), 9)
    const rig = ringRig({ z: 1, spread: ringSpread(0.2), mount: 'beam' })
    expect(rig.implements.map((s) => s.id)).toEqual(['rings', 'ring_l', 'strap_l', 'ring_r', 'strap_r'])
    expect(rig.anchor.mount).toBe('beam')
    expect(rig.anchorPose.pos).toEqual([0, 0, 1])
    expect(norm(rig.anchor.sites.strap_l.pos)[0]).toBeGreaterThan(0)
  })
})
