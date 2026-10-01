import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist, dot, sub } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'
import { planeElevOf, thoraxFrame } from './isolation.ts'

const skel = testSkeleton()
const variants = motionRecords('fly')
const baked = new Map(variants.map((v) => [v.slug, bake(getTemplate('fly'), parseParams('fly', v.params, v.laterality), skel)]))
const get = (slug: string) => baked.get(slug)!
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const OPEN = 0.625
const CLOSED = 0

/** left humerus plane of elevation and elevation in the thorax frame, deg */
function arm(b: Baked, u: number) {
  const q = frameQ(b, at(b, u))
  const f = fk(skel, q)
  return planeElevOf(sub(segPos(skel, f, 'forearm_l'), segPos(skel, f, 'humerus_l')), thoraxFrame(skel, q))
}

const posAt = (b: Baked, u: number, site: string) => sitePos(skel, fk(skel, frameQ(b, at(b, u))), site)
const segAt = (b: Baked, u: number, seg: string) => segPos(skel, fk(skel, frameQ(b, at(b, u))), seg)

describe('fly template', () => {
  it('covers every fly record', () => {
    expect([...baked.keys()]).toEqual(['105-cable-fly-high-to-low', '110-pec-deck-fly', '111-cable-fly-low-to-high', '112-dumbbell-fly'])
  })

  it.each([...baked.keys()])('%s: horizontal adduction from past the frontal plane to the arms in front, elbows soft and fixed', (slug) => {
    const b = get(slug)
    // research: horizontal adduction ~-25 -> ~+90, elbow fixed 15-25
    expect(arm(b, OPEN).plane).toBeGreaterThan(-26)
    expect(arm(b, OPEN).plane).toBeLessThan(-5)
    expect(arm(b, CLOSED).plane).toBeGreaterThan(85)
    expect(arm(b, CLOSED).plane).toBeLessThan(105)
    const elbows = Array.from({ length: b.frames }, (_, i) => frameQ(b, i)[skel.dof['elbow_l.flex']])
    // the pec deck's hands are solved onto the handle arcs, so the soft elbow drifts a little
    const [lo, hi] = b.params.implement === 'machine' ? [8, 25] : [15, 25]
    expect(Math.min(...elbows)).toBeGreaterThanOrEqual(lo)
    expect(Math.max(...elbows)).toBeLessThanOrEqual(hi)
    expect(Math.max(...elbows) - Math.min(...elbows)).toBeLessThan(10)
    // the hands meet in front without colliding
    const gap = dist(posAt(b, CLOSED, 'grip_l'), posAt(b, CLOSED, 'grip_r'))
    expect(gap).toBeGreaterThan(0.08)
    expect(gap).toBeLessThan(0.25)
  })

  it.each([...baked.keys()])('%s: hands stay on the load, feet stay planted, the loop closes', (slug) => {
    const b = get(slug)
    for (let i = 0; i < b.frames; i += 3) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        if ('world' in c.target) expect(dist(sitePos(skel, f, c.site), c.target.world)).toBeLessThan(0.005)
        else {
          const { implement, grip } = c.target
          const k = b.implements.findIndex((s) => s.id === implement)
          expect(dist(sitePos(skel, f, c.site), siteWorld(b.implements[k], impl[k], grip).pos)).toBeLessThan(0.005)
        }
      }
    }
    // cut mid top pause: the last frame runs straight into the first
    const first = frameQ(b, 0), last = frameQ(b, b.frames - 1)
    expect(Math.max(...first.map((v, k) => Math.abs(v - last[k])))).toBeLessThan(0.5)
  })

  it('high-to-low: from a little above the shoulders to the hands together in front of the hips, leaning into the pull', () => {
    const b = get('105-cable-fly-high-to-low')
    expect(posAt(b, OPEN, 'grip_l')[1]).toBeGreaterThan(segAt(b, OPEN, 'humerus_l')[1])
    const hands = posAt(b, CLOSED, 'grip_l'), hip = segAt(b, CLOSED, 'femur_l')
    expect(hands[1]).toBeLessThan(hip[1] + 0.05)
    expect(hands[2]).toBeGreaterThan(hip[2] + 0.2)
    const q = frameQ(b, 0)
    expect(q[skel.dof['pelvis.tilt']]).toBeGreaterThan(10)
    // the split stance holds the hips still
    const z = Array.from({ length: b.frames }, (_, i) => frameQ(b, i)[skel.dof['pelvis.tz']])
    expect(Math.max(...z) - Math.min(...z)).toBeLessThan(1e-9)
  })

  it('low-to-high: from just behind the hips to the hands together at chin height', () => {
    const b = get('111-cable-fly-low-to-high')
    const open = posAt(b, OPEN, 'grip_l'), hip = segAt(b, OPEN, 'femur_l')
    expect(open[1]).toBeLessThan(hip[1] + 0.1)
    expect(open[2]).toBeLessThan(hip[2])
    const closed = posAt(b, CLOSED, 'grip_l')
    expect(closed[1]).toBeGreaterThan(segAt(b, CLOSED, 'humerus_l')[1])
    // the cue's "about chin height"
    expect(Math.abs(closed[1] - posAt(b, CLOSED, 'chin')[1])).toBeLessThan(0.03)
  })

  it('cable flies: each hand pulls its own tower\'s cable', () => {
    for (const slug of ['105-cable-fly-high-to-low', '111-cable-fly-low-to-high']) {
      const b = get(slug)
      for (const c of b.cables!) expect(Math.sign(c.pulley[0])).toBe(c.implement === 'handle_l' ? 1 : -1)
    }
  })

  it.each(['105-cable-fly-high-to-low', '111-cable-fly-low-to-high'])('%s: the cable pulls against the hand through the whole sweep, the stretch included', (slug) => {
    const b = get(slug)
    const cable = b.cables!.find((c) => c.implement === 'handle_l')!
    // the concentric of the default tempo, cut mid top pause
    for (let u = 0.67; u < 0.92; u += 0.01) {
      const hand = posAt(b, u, 'grip_l')
      const move = sub(posAt(b, u + 0.01, 'grip_l'), hand)
      const pull = sub(cable.pulley, hand)
      if (Math.hypot(...move) < 0.002) continue
      expect(dot(move, pull) / (Math.hypot(...move) * Math.hypot(...pull)), `u ${u.toFixed(2)}`).toBeLessThan(0)
    }
  })

  it('dumbbell fly: butt and upper back rest on the flat bench, the body stays still', () => {
    const b = get('112-dumbbell-fly')
    // pad top of the 0.44 m flat bench, within the 15 mm padded sink
    const top = 0.44
    const caps = bodyCapsules(skel, fk(skel, frameQ(b, 0)))
    const low = (re: RegExp) => Math.min(...caps.filter((c) => re.test(c.name)).map((c) => Math.min(c.a[1], c.b[1]) - c.r))
    for (const re of [/^trunk0[12]$/, /^trunk1[1-4]$/]) {
      expect(low(re) - top).toBeGreaterThan(-0.015)
      expect(low(re) - top).toBeLessThan(0.001)
    }
    for (const name of ['pelvis.ty', 'pelvis.tz', 'pelvis.tilt', 'lumbar.flex', 'knee_l.flex']) {
      const v = Array.from({ length: b.frames }, (_, i) => frameQ(b, i)[skel.dof[name]])
      expect(Math.max(...v) - Math.min(...v)).toBeLessThan(1e-9)
    }
  })

  it('unsupported variants throw', () => {
    const t = getTemplate('fly')
    const run = (params: Record<string, unknown>) => () => t.setup(parseParams('fly', params), skel)
    expect(run({ implement: 'cable', posture: 'standing', cableHeight: 'mid', stance: 'split' })).toThrow(/variant not implemented yet/)
    expect(run({ implement: 'cable', posture: 'standing', cableHeight: 'high', stance: 'hip' })).toThrow(/variant not implemented yet/)
    expect(run({ implement: 'dumbbell', benchAngle: 30 })).toThrow(/variant not implemented yet/)
  })
})
