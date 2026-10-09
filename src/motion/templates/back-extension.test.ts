import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../collide.ts'
import { fk, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { BOTTOM_HIP, TOP_HIP } from './back-extension.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('back-extension')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('back-extension'), parseParams('back-extension', v.params, v.laterality), skel)]))
const b = baked.get(505)!
const at = (x: Baked, u: number) => Math.round(u * x.frames) % x.frames
const dof = (u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]

describe('back-extension template', () => {
  it('covers every back-extension record in the family', () => {
    expect([...baked.keys()]).toEqual([505, 527])
  })

  it('feet planted, palms on the shoulders, finite frames, seamless loop', () => {
    expect(b.q.every(Number.isFinite)).toBe(true)
    const first = fk(skel, frameQ(b, 0))
    for (let i = 0; i < b.frames; i += 3) {
      const f = fk(skel, frameQ(b, i))
      const poses = frameImplements(b, i)
      for (const c of b.contacts) {
        if (c.kind === 'planted') expect(dist(sitePos(skel, f, c.site), sitePos(skel, first, c.site))).toBeLessThan(0.002)
        else if ('implement' in c.target) {
          const { implement, grip } = c.target
          const spec = b.implements.find((s) => s.id === implement)!
          expect(dist(sitePos(skel, f, c.site), siteWorld(spec, poses.find((p) => p.id === implement)!, grip).pos)).toBeLessThan(0.005)
        }
      }
    }
    const a = frameQ(b, 0), z = frameQ(b, b.frames - 1)
    for (const d of skel.dofs) if (d.unit === 'deg') expect(Math.abs(a[d.index] - z[d.index])).toBeLessThan(1)
  })

  it('hinges at the hips with a neutral spine: in line at the top (no hyperextension), ~80 deg at the bottom, legs still', () => {
    expect(dof(0, 'hip_l.flex')).toBeCloseTo(TOP_HIP, 0)
    expect(dof(0.625, 'hip_l.flex')).toBeCloseTo(BOTTOM_HIP, 0)
    expect(dof(0, 'pelvis.tilt')).toBeCloseTo(90 - Number(b.params.benchAngle), 0)
    for (let i = 0; i < b.frames; i += 4) {
      const q = frameQ(b, i)
      expect(q[skel.dof['hip_l.flex']]).toBeGreaterThanOrEqual(TOP_HIP - 0.01)
      expect(q[skel.dof['lumbar.flex']]).toBe(0)
      expect(q[skel.dof['thorax.flex']]).toBe(0)
      expect(q[skel.dof['knee_l.flex']]).toBeCloseTo(frameQ(b, 0)[skel.dof['knee_l.flex']], 3)
    }
  })

  it('rests on the pad, roller and plate without sinking past the pad tolerance', () => {
    const bench = b.implements.find((s) => s.kind === 'back_extension')!
    const [pad, plate, roller] = placeParts(bench, { id: bench.id, pos: [0, 0, 0], rot: [0, 0, 0, 1] })
    const caps = bodyCapsules(skel, fk(skel, frameQ(b, 0)))
    const clear = (s: typeof pad, re: RegExp) => Math.min(...caps.filter((c) => re.test(c.region)).map((c) => capsuleSolidClearance(c, s)))
    for (const [s, re] of [[pad, /^thigh_/], [plate, /^foot_/], [roller, /^shank_/]] as const) {
      expect(clear(s, re)).toBeLessThan(0)
      expect(clear(s, re)).toBeGreaterThan(-0.015)
    }
  })

  it('GHD (527): level legs, the trunk folds 0 -> 80 deg over the round pad; thighs, shins and soles on the station', () => {
    const g = baked.get(527)!
    const d = (u: number, name: string) => frameQ(g, at(g, u))[skel.dof[name]]
    expect(d(0, 'pelvis.tilt')).toBeCloseTo(90, 3)
    expect(d(0, 'hip_l.flex')).toBeCloseTo(TOP_HIP, 0)
    expect(d(0.625, 'hip_l.flex')).toBeCloseTo(BOTTOM_HIP, 0)
    const spec = g.implements.find((s) => s.kind === 'ghd')!
    const pose = frameImplements(g, 0).find((p) => p.id === spec.id)!
    const [nose, pad, plate, top, low] = placeParts(spec, pose)
    const caps = bodyCapsules(skel, fk(skel, frameQ(g, 0)))
    const clear = (s: typeof pad, re: RegExp) => Math.min(...caps.filter((c) => re.test(c.region)).map((c) => capsuleSolidClearance(c, s)))
    expect(Math.min(clear(nose, /^thigh_/), clear(pad, /^thigh_/))).toBeGreaterThan(-0.015)
    expect(Math.min(clear(nose, /^thigh_/), clear(pad, /^thigh_/))).toBeLessThan(0)
    expect(clear(plate, /^foot_/)).toBeGreaterThan(-0.015)
    for (const r of [top, low]) expect(clear(r, /^shank_/)).toBeGreaterThan(-0.015)
    // the head stays off the floor at the bottom
    const bottom = bodyCapsules(skel, fk(skel, frameQ(g, at(g, 0.625)))).filter((c) => c.region === 'head')
    expect(Math.min(...bottom.map((c) => Math.min(c.a[1], c.b[1]) - c.r))).toBeGreaterThan(0.05)
  })

  it('throws for variants it does not draw yet', () => {
    const t = getTemplate('back-extension')
    for (const raw of [{ implement: 'dumbbell' }, { armPosition: 'behind_head' }, { spine: 'flexion' }]) {
      expect(() => t.sample(0, parseParams('back-extension', raw), skel)).toThrow(/variant not implemented yet/)
    }
  })
})
