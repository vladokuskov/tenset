import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, segmentDistance } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist, dot, scale, sub } from '../math.ts'
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

/** the working arm: the right on single-arm records (side defaults to right), else the left */
const work = (b: Baked) => (b.params.laterality === 'unilateral' && b.params.side !== 'left' ? 'r' : 'l')
const single = (b: Baked) => b.params.laterality === 'unilateral'

/** working humerus plane of elevation and elevation in the thorax frame, deg (the right arm mirrored to the left's) */
function arm(b: Baked, u: number) {
  const q = frameQ(b, at(b, u))
  const f = fk(skel, q)
  const s = work(b)
  const d = sub(segPos(skel, f, `forearm_${s}`), segPos(skel, f, `humerus_${s}`))
  const fr = thoraxFrame(skel, q)
  return planeElevOf(s === 'l' ? d : sub(d, scale(fr.right, 2 * dot(d, fr.right))), fr)
}

const posAt = (b: Baked, u: number, site: string) => sitePos(skel, fk(skel, frameQ(b, at(b, u))), site)
const segAt = (b: Baked, u: number, seg: string) => segPos(skel, fk(skel, frameQ(b, at(b, u))), seg)

describe('fly template', () => {
  it('covers every fly record', () => {
    expect([...baked.keys()]).toEqual([
      '105-cable-fly-high-to-low', '110-pec-deck-fly', '111-cable-fly-low-to-high', '112-dumbbell-fly', '129-mid-cable-fly', '130-incline-dumbbell-fly',
      '131-seated-cable-fly', '132-single-arm-cable-fly', '133-band-fly',
    ])
  })

  it.each([...baked.keys()])('%s: horizontal adduction from past the frontal plane to the arms in front, elbows soft and fixed', (slug) => {
    const b = get(slug)
    // research: horizontal adduction ~-25 -> ~+90, elbow fixed 15-25
    expect(arm(b, OPEN).plane).toBeGreaterThan(-26)
    expect(arm(b, OPEN).plane).toBeLessThan(-5)
    expect(arm(b, CLOSED).plane).toBeGreaterThan(85)
    expect(arm(b, CLOSED).plane).toBeLessThan(105)
    const elbows = Array.from({ length: b.frames }, (_, i) => frameQ(b, i)[skel.dof[`elbow_${work(b)}.flex`]])
    // the pec deck's hands are solved onto the handle arcs, so the soft elbow drifts a little
    const [lo, hi] = b.params.implement === 'machine' ? [8, 25] : [15, 25]
    expect(Math.min(...elbows)).toBeGreaterThanOrEqual(lo)
    expect(Math.max(...elbows)).toBeLessThanOrEqual(hi)
    expect(Math.max(...elbows) - Math.min(...elbows)).toBeLessThan(10)
    // the hands meet in front without colliding (single arm: the hand reaches the midline)
    if (single(b)) {
      const sternum = posAt(b, CLOSED, 'sternum')
      expect(Math.abs(posAt(b, CLOSED, `grip_${work(b)}`)[0] - sternum[0])).toBeLessThan(0.08)
      return
    }
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

  it('mid cable fly: open with the hands level with the shoulders, closed together in front of the sternum', () => {
    const b = get('129-mid-cable-fly')
    for (const u of [OPEN, CLOSED]) {
      expect(arm(b, u).elev).toBeGreaterThan(75)
      expect(arm(b, u).elev).toBeLessThan(95)
    }
    // open about level with the shoulders (soft elbows lift the hands a little), closed at mid-chest height
    expect(Math.abs(posAt(b, OPEN, 'grip_l')[1] - segAt(b, OPEN, 'humerus_l')[1])).toBeLessThan(0.12)
    expect(Math.abs(posAt(b, CLOSED, 'grip_l')[1] - posAt(b, CLOSED, 'sternum')[1])).toBeLessThan(0.05)
    expect(posAt(b, CLOSED, 'grip_l')[2]).toBeGreaterThan(posAt(b, CLOSED, 'sternum')[2] + 0.2)
    const z = Array.from({ length: b.frames }, (_, i) => frameQ(b, i)[skel.dof['pelvis.tz']])
    expect(Math.max(...z) - Math.min(...z)).toBeLessThan(1e-9)
  })

  it('incline dumbbell fly: butt on the seat, upper back on the pad, the dumbbells close over the upper chest', () => {
    const b = get('130-incline-dumbbell-fly')
    const trunk = sub(segAt(b, 0, 'humerus_l'), segAt(b, 0, 'femur_l'))
    // the trunk lies along the 30 deg pad (hips to shoulders, within the arch)
    const incline = (Math.atan2(trunk[1], -trunk[2]) * 180) / Math.PI
    expect(incline).toBeGreaterThan(22)
    expect(incline).toBeLessThan(42)
    for (const name of ['pelvis.ty', 'pelvis.tz', 'pelvis.tilt', 'lumbar.flex', 'knee_l.flex']) {
      const v = Array.from({ length: b.frames }, (_, i) => frameQ(b, i)[skel.dof[name]])
      expect(Math.max(...v) - Math.min(...v)).toBeLessThan(1e-9)
    }
    // closed: the hands in front of the upper chest, above the shoulders along the chest's normal
    const q = frameQ(b, at(b, CLOSED))
    const fr = thoraxFrame(skel, q)
    expect(dot(sub(posAt(b, CLOSED, 'grip_l'), segAt(b, CLOSED, 'humerus_l')), fr.fwd)).toBeGreaterThan(0.4)
  })

  it('seated cable fly: seated against the upright pad, still, the pulleys level with the shoulders', () => {
    const b = get('131-seated-cable-fly')
    for (const name of ['pelvis.ty', 'pelvis.tz', 'pelvis.tilt', 'knee_l.flex']) {
      const v = Array.from({ length: b.frames }, (_, i) => frameQ(b, i)[skel.dof[name]])
      expect(Math.max(...v) - Math.min(...v)).toBeLessThan(1e-9)
    }
    const sh = segAt(b, 0, 'humerus_l')
    for (const c of b.cables!) expect(Math.abs(c.pulley[1] - sh[1])).toBeLessThan(0.03)
    expect(segAt(b, 0, 'pelvis')[1]).toBeLessThan(0.7)
  })

  it('single-arm cable fly: one handle on the working tower, the free arm hangs relaxed', () => {
    const b = get('132-single-arm-cable-fly')
    expect(b.cables!.length).toBe(1)
    expect(b.cables![0].implement).toBe('handle_r')
    expect(b.cables![0].pulley[0]).toBeLessThan(0)
    expect(frameQ(b, 0)[skel.dof['shoulder_l.elev']]).toBeLessThan(15)
    for (const name of ['clavicle_l.elev', 'clavicle_l.prot', 'shoulder_l.plane', 'shoulder_l.elev', 'shoulder_l.rot', 'elbow_l.flex', 'forearm_l.pro']) {
      const v = Array.from({ length: b.frames }, (_, i) => frameQ(b, i)[skel.dof[name]])
      expect(Math.max(...v) - Math.min(...v), name).toBeLessThan(1e-9)
    }
  })

  it('band fly (133): the mid cable fly from a band on a post behind at chest height, the strip passing outside the chest and arms', () => {
    const b = get('133-band-fly')
    expect(b.cables).toBeUndefined()
    const anchor = b.implements.findIndex((s) => s.kind === 'band_anchor')
    expect(anchor).toBeGreaterThanOrEqual(0)
    const hook = siteWorld(b.implements[anchor], frameImplements(b, 0)[anchor], 'hook').pos
    expect(hook[2]).toBeLessThan(-0.5)
    expect(Math.abs(hook[1] - segAt(b, OPEN, 'humerus_l')[1])).toBeLessThan(0.15)
    for (const u of [OPEN, CLOSED]) {
      const f = fk(skel, frameQ(b, at(b, u)))
      const side = frameImplements(b, at(b, u))[b.implements.findIndex((s) => s.id === 'side_l')].pos
      const trunk = bodyCapsules(skel, f).filter((c) => c.region === 'trunk')
      expect(Math.min(...trunk.map((c) => segmentDistance(c.a, c.b, side, side).d - c.r))).toBeGreaterThan(0)
    }
    // every frame, every run from the ring round the outside of the elbow and the back of the shoulder to the hook keeps
    // off the arm (and the trunk)
    const k = (id: string) => b.implements.findIndex((x) => x.id === id)
    for (let i = 0; i < b.frames; i++) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      for (const s of ['l', 'r']) {
        const ring = siteWorld(b.implements[k(`handle_${s}`)], impl[k(`handle_${s}`)], 'ring').pos
        const pts = [ring, ...[`wrist_${s}`, `arm_${s}`, `side_${s}`].map((id) => impl[k(id)].pos), hook]
        const caps = bodyCapsules(skel, f).filter((c) => c.region === `upperarm_${s}` || c.region === `forearm_${s}` || c.region === 'trunk')
        for (let j = 0; j + 1 < pts.length; j++) {
          expect(Math.min(...caps.map((c) => segmentDistance(c.a, c.b, pts[j], pts[j + 1]).d - c.r)), `${s} run ${j} @${i}`).toBeGreaterThan(0)
        }
      }
    }
    // the same arc as the mid cable fly
    const mid = get('129-mid-cable-fly')
    expect(arm(b, OPEN).plane).toBeCloseTo(arm(mid, OPEN).plane, 0)
    expect(arm(b, CLOSED).plane).toBeCloseTo(arm(mid, CLOSED).plane, 0)
  })

  it('unsupported variants throw', () => {
    const t = getTemplate('fly')
    const run = (params: Record<string, unknown>, laterality?: string) => () => t.setup(parseParams('fly', params, laterality), skel)
    expect(run({ implement: 'cable', posture: 'standing', cableHeight: 'high', stance: 'hip' })).toThrow(/variant not implemented yet/)
    expect(run({ implement: 'dumbbell', benchAngle: -15 })).toThrow(/variant not implemented yet/)
    expect(run({ implement: 'cable', posture: 'standing', cableHeight: 'high', stance: 'split' }, 'unilateral')).toThrow(/variant not implemented yet/)
  })
})
