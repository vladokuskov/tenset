import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { angleBetween, dist, RAD, sub } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'
import { thoraxFrame } from './isolation.ts'

const skel = testSkeleton()
const variants = motionRecords('external-rotation')
const baked = new Map(variants.map((v) => [v.slug, bake(getTemplate('external-rotation'), parseParams('external-rotation', v.params, v.laterality), skel)]))
const get = (slug: string) => baked.get(slug)!
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const END = 0
const START = 0.625
const series = (b: Baked, name: string) => Array.from({ length: b.frames }, (_, i) => frameQ(b, i)[skel.dof[name]])
const spread = (v: number[]) => Math.max(...v) - Math.min(...v)

/** working (right) humerus direction in the thorax frame: [right, up, fwd] components */
function humerus(b: Baked, i: number) {
  const q = frameQ(b, i)
  const f = fk(skel, q)
  const d = sub(segPos(skel, f, 'forearm_r'), segPos(skel, f, 'humerus_r'))
  const fr = thoraxFrame(skel, q)
  const n = Math.hypot(...d)
  return [d[0] * fr.right[0] + d[1] * fr.right[1] + d[2] * fr.right[2], d[0] * fr.up[0] + d[1] * fr.up[1] + d[2] * fr.up[2], d[0] * fr.fwd[0] + d[1] * fr.fwd[1] + d[2] * fr.fwd[2]].map((x) => x / n) as [number, number, number]
}

describe('external-rotation template', () => {
  it('covers every external-rotation record', () => {
    expect([...baked.keys()]).toEqual(['211-cable-external-rotation', '215-side-lying-external-rotation', '232-band-external-rotation'])
  })

  it.each([...baked.keys()])('%s: the upper arm stays pinned at the side, the elbow at 90, only the humerus turns', (slug) => {
    const b = get(slug)
    const h0 = humerus(b, 0)
    for (let i = 0; i < b.frames; i += 3) expect(angleBetween(humerus(b, i), h0) * RAD).toBeLessThan(1)
    // along the side, a towel's width out
    expect(angleBetween(h0, [0, -1, 0]) * RAD).toBeLessThan(15)
    expect(spread(series(b, 'elbow_r.flex'))).toBeLessThan(1e-9)
    expect(frameQ(b, 0)[skel.dof['elbow_r.flex']]).toBe(90)
    // from the forearm across the stomach to rotated out: a ~90 deg arc
    const rot = series(b, 'shoulder_r.rot')
    expect(rot[at(b, START)] - rot[at(b, END)]).toBeGreaterThan(80)
    expect(rot[at(b, START)]).toBeGreaterThan(30)
    expect(rot[at(b, END)]).toBeLessThan(-45)
    // the torso does not twist with it
    for (const name of ['pelvis.rot', 'lumbar.rot', 'thorax.rot', 'thorax.flex']) expect(spread(series(b, name))).toBeLessThan(1e-9)
  })

  it.each([...baked.keys()])('%s: the hand stays on the load, the supports hold, the loop closes', (slug) => {
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
    const first = frameQ(b, 0), last = frameQ(b, b.frames - 1)
    expect(Math.max(...first.map((v, k) => Math.abs(v - last[k])))).toBeLessThan(0.5)
  })

  it.each([...baked.keys()])('%s: the cue\'s rolled towel stays tucked between the elbow and the ribs', (slug) => {
    const b = get(slug)
    const k = b.implements.findIndex((x) => x.kind === 'towel_roll')
    expect(k).toBeGreaterThanOrEqual(0)
    for (let i = 0; i < b.frames; i += 3) {
      const caps = bodyCapsules(skel, fk(skel, frameQ(b, i)))
      const towel = placeParts(b.implements[k], frameImplements(b, i)[k])
      const gap = (region: string) => Math.min(...caps.filter((c) => c.region === region).flatMap((c) => towel.map((x) => capsuleSolidClearance(c, x))))
      // touching both, inside the padded allowance
      for (const region of ['upperarm_r', 'trunk']) {
        expect(gap(region)).toBeLessThan(0.001)
        expect(gap(region)).toBeGreaterThan(-0.015)
      }
      expect(gap('forearm_r')).toBeGreaterThan(0.005)
    }
  })

  it('cable: side-on to a stack on the far side at elbow height, the free arm still', () => {
    const b = get('211-cable-external-rotation')
    const cable = b.cables![0]
    const f = fk(skel, frameQ(b, at(b, START)))
    // working right arm, pulley on the lifter's left
    expect(cable.pulley[0]).toBeGreaterThan(0.5)
    expect(Math.abs(cable.pulley[1] - segPos(skel, f, 'forearm_r')[1])).toBeLessThan(0.1)
    for (const d of skel.dofs.filter((x) => /_l\./.test(x.name))) expect(spread(series(b, d.name))).toBeLessThan(1e-9)
  })

  it('side-lying: the bottom shoulder and hip rest on the bench, the dumbbell rises from the stomach towards the ceiling', () => {
    const b = get('215-side-lying-external-rotation')
    // pad top of the 0.44 m flat bench, within the 15 mm padded sink; the seat ends 0.44 m towards the feet
    const top = 0.44
    const seatEnd = 0.44
    const f0 = fk(skel, frameQ(b, 0))
    const caps = bodyCapsules(skel, f0)
    const low = (keep: (c: (typeof caps)[number]) => boolean) => Math.min(...caps.filter(keep).map((c) => Math.min(c.a[1], c.b[1]) - c.r))
    for (const keep of [(c: (typeof caps)[number]) => /^(girdle|upperarm)_l$/.test(c.region), (c: (typeof caps)[number]) => c.segment === 'pelvis' || c.name === 'thigh_l1']) {
      expect(low(keep) - top).toBeGreaterThan(-0.015)
      expect(low(keep) - top).toBeLessThan(0.001)
    }
    // curled legs: the knees come forward, the shins come back over the seat and rest on it, the feet end at most a
    // foot's width past its end (straight legs held level past the bench end read as floating)
    const knee = segPos(skel, f0, 'tibia_l'), ankle = segPos(skel, f0, 'foot_l')
    expect(knee[2]).toBeLessThan(seatEnd)
    expect(ankle[2]).toBeLessThan(seatEnd + 0.1)
    const k = b.implements.findIndex((x) => x.id === 'bench')
    const bench = placeParts(b.implements[k], frameImplements(b, 0)[k])
    const onBench = Math.min(...caps.filter((c) => c.region === 'shank_l').flatMap((c) => bench.map((x) => capsuleSolidClearance(c, x))))
    expect(onBench).toBeGreaterThan(-0.015)
    expect(onBench).toBeLessThan(0.005)
    // stacked: the top leg's shin and foot lie on the bottom leg's
    const gapOf = (r: string) => Math.min(...caps.filter((c) => c.region === `${r}_l`).flatMap((x) => caps.filter((c) => c.region === `${r}_r`).map((y) => capsuleClearance(x, y))))
    expect(gapOf('shank')).toBeLessThan(0.04)
    expect(gapOf('foot')).toBeLessThan(0.01)
    expect(gapOf('foot')).toBeGreaterThan(-0.003)
    expect(gapOf('thigh')).toBeGreaterThan(-0.015)
    const handAt = (u: number) => sitePos(skel, fk(skel, frameQ(b, at(b, u))), 'grip_r')
    const elbowAt = (u: number) => segPos(skel, fk(skel, frameQ(b, at(b, u))), 'forearm_r')
    expect(handAt(START)[1]).toBeLessThan(elbowAt(START)[1] - 0.1)
    expect(handAt(END)[1]).toBeGreaterThan(elbowAt(END)[1] + 0.15)
    for (const name of ['pelvis.ty', 'pelvis.list', 'hip_l.flex', 'knee_r.flex']) expect(spread(series(b, name))).toBeLessThan(1e-9)
  })

  it('band (232): the cable rep with a band from a post anchor at elbow height on the far side', () => {
    const b = get('232-band-external-rotation')
    const c = get('211-cable-external-rotation')
    expect(spread(series(b, 'shoulder_r.rot'))).toBeCloseTo(spread(series(c, 'shoulder_r.rot')), 0)
    const anchor = b.implements.find((s) => s.kind === 'band_anchor')!
    const k = b.implements.indexOf(anchor)
    const hook = siteWorld(anchor, frameImplements(b, 0)[k], 'hook').pos
    expect(dist(hook, b.cables![0].pulley)).toBeLessThan(1e-4)
    // far side (working right arm: the anchor on the left), at elbow height
    expect(hook[0]).toBeGreaterThan(0.5)
    const f = fk(skel, frameQ(b, at(b, START)))
    expect(Math.abs(hook[1] - segPos(skel, f, 'forearm_r')[1])).toBeLessThan(0.15)
  })

  it('unsupported variants throw', () => {
    const t = getTemplate('external-rotation')
    const run = (params: Record<string, unknown>) => () => t.setup(parseParams('external-rotation', params, 'unilateral'), skel)
    expect(run({ implement: 'cable', armPosition: 'abducted' })).toThrow(/variant not implemented yet/)
    expect(run({ implement: 'dumbbell', posture: 'standing' })).toThrow(/variant not implemented yet/)
  })
})
