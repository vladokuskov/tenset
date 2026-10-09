import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../collide.ts'
import { centerOfMass, fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist, qconj, qrot, RAD, sub } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { dip } from './dip.ts'
import { RING_LEAN, ringLean } from './rings.ts'
import { SCHEMAS } from './schemas.ts'
import type { AnyTemplate } from './types.ts'

const skel = testSkeleton()
const t = dip as unknown as AnyTemplate
const parse = (raw: Record<string, unknown>, laterality = 'bilateral') => SCHEMAS.dip.parse({ ...raw, laterality })
const variants = motionRecords('dip')
const baked = new Map(variants.map((v) => [v.id, bake(t, parse(v.params, v.laterality), skel)]))
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]
const TOP = 0, BOTTOM = 0.635

/** upper arm in the thorax frame: extension behind the trunk (side view) and spread out to the side (top view), deg */
function upperArm(b: Baked, u: number) {
  const f = fk(skel, frameQ(b, at(b, u)))
  const h = qrot(qconj(f.rot[skel.seg.thorax2]), sub(segPos(skel, f, 'forearm_l'), segPos(skel, f, 'humerus_l')))
  return { extension: Math.atan2(-h[2], -h[1]) * RAD, out: Math.atan2(h[0], -h[2]) * RAD }
}
/** the parallel-bar dips (the bench dip has its own checks) */
const bars = [...baked.keys()].filter((id) => baked.get(id)!.params.support !== 'bench')
const trunkLean = (b: Baked, u: number) => dof(b, u, 'pelvis.tilt') + dof(b, u, 'lumbar.flex') + dof(b, u, 'thorax.flex')

describe('dip template', () => {
  it('covers every record of the template', () => {
    expect([...baked.keys()].sort()).toEqual([104, 127, 718, 733])
  })

  it.each(bars)('%s: elbow ~8 -> ~90-100, shoulder extension ~45-65 at the bottom', (id) => {
    const b = baked.get(id)!
    expect(dof(b, TOP, 'elbow_l.flex')).toBeLessThan(12)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeGreaterThan(85)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeLessThan(105)
    const ext = upperArm(b, BOTTOM).extension
    expect(ext).toBeGreaterThan(40)
    expect(ext).toBeLessThan(65)
  })

  it.each(bars.filter((id) => baked.get(id)!.params.implement !== 'rings'))('%s: hands stay on the bars, the body balanced over them, seamless loop', (id) => {
    const b = baked.get(id)!
    expect(b.q.every(Number.isFinite)).toBe(true)
    for (let i = 0; i < b.frames; i++) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        if (!('implement' in c.target)) continue
        const { implement, grip } = c.target
        const k = b.implements.findIndex((s) => s.id === implement)
        expect(dist(sitePos(skel, f, c.site), siteWorld(b.implements[k], impl[k], grip).pos)).toBeLessThan(0.005)
      }
      const over = siteWorld(b.implements[0], impl[0], 'l').pos[2]
      expect(Math.abs(centerOfMass(skel, f)[2] - over)).toBeLessThan(0.025)
    }
    const first = frameQ(b, 0), last = frameQ(b, b.frames - 1)
    for (const d of skel.dofs) expect(Math.abs(first[d.index] - last[d.index]), d.name).toBeLessThan(d.unit === 'm' ? 0.002 : 1)
  })

  it('the chest dip leans forward and lets the elbows drift out; the triceps dip stays upright, elbows back', () => {
    const chest = baked.get(104)!, upright = baked.get(718)!
    expect(trunkLean(chest, BOTTOM)).toBeGreaterThan(trunkLean(upright, BOTTOM) + 15)
    expect(upperArm(chest, BOTTOM).out).toBeGreaterThan(upperArm(upright, BOTTOM).out + 5)
    expect(Math.abs(upperArm(upright, BOTTOM).out)).toBeLessThan(15)
  })

  it('bench dip (733): hands on the bench edge, feet planted, the hips sliding down just clear of the bench to level upper arms', () => {
    const b = baked.get(733)!
    expect(b.q.every(Number.isFinite)).toBe(true)
    const pad = b.implements.find((s) => s.kind === 'cross_bench')!
    const k = b.implements.indexOf(pad)
    for (let i = 0; i < b.frames; i++) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        const target = 'world' in c.target ? c.target.world : (() => {
          const { implement, grip } = c.target
          const j = b.implements.findIndex((s) => s.id === implement)
          return siteWorld(b.implements[j], impl[j], grip).pos
        })()
        expect(dist(sitePos(skel, f, c.site), target), `${c.site} @${i}`).toBeLessThan(0.005)
      }
      // the back clear of the bench pad (beyond the pad's soft tolerance)
      const trunk = bodyCapsules(skel, f).filter((c) => c.region === 'trunk')
      const solid = placeParts({ ...pad, parts: [pad.parts[1]] }, impl[k])[0]
      expect(Math.min(...trunk.map((c) => capsuleSolidClearance(c, solid))), `@${i}`).toBeGreaterThan(-0.015)
    }
    // elbows from soft to bent straight back to ~90, the upper arm about level behind the trunk at the bottom, the hips
    // below the pad
    expect(dof(b, TOP, 'elbow_l.flex')).toBeLessThan(20)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeGreaterThan(80)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeLessThan(100)
    expect(upperArm(b, BOTTOM).extension).toBeGreaterThan(70)
    expect(Math.abs(upperArm(b, BOTTOM).out)).toBeLessThan(25)
    const hip = (u: number) => fk(skel, frameQ(b, at(b, u))).pos[skel.seg.pelvis][1]
    expect(hip(TOP) - hip(BOTTOM)).toBeGreaterThan(0.15)
    expect(hip(BOTTOM)).toBeLessThan(0.44)
  })

  it('ring dip (127): the rings stay put by the hips, the body balanced over them, the rings turn out at the top', () => {
    const b = baked.get(127)!
    expect(b.q.every(Number.isFinite)).toBe(true)
    const ids = ['ring_l', 'ring_r'].map((id) => b.implements.findIndex((s) => s.id === id))
    const grip0 = ids.map((k) => siteWorld(b.implements[k], frameImplements(b, 0)[k], 'grip').pos)
    const anchor = b.implements.find((s) => s.id === 'rings')!
    for (let i = 0; i < b.frames; i++) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      ids.forEach((k, j) => {
        const g = siteWorld(b.implements[k], impl[k], 'grip').pos
        // the hand on the ring's grip, the ring where it hangs (it does not swing about with the body)
        expect(dist(sitePos(skel, f, `grip_${j ? 'r' : 'l'}`), g)).toBeLessThan(0.005)
        expect(dist(g, grip0[j])).toBeLessThan(0.002)
        // the ring hangs along its strap, leaning off it only where the forearm pushes it round, RING_LEAN off the forearm
        // (a few degrees more off the strap when that runs just to the other side of the forearm; rings.ts)
        expect(ringLean({ anchor: anchor as never, anchorPose: impl[b.implements.indexOf(anchor)], implements: b.implements }, impl[k], j ? 'r' : 'l')).toBeLessThan(RING_LEAN + 9)
      })
      expect(Math.abs(centerOfMass(skel, f)[2] - grip0[0][2])).toBeLessThan(0.025)
      // the straps hang outside the shoulders
      expect(siteWorld(anchor, impl[b.implements.indexOf(anchor)], 'strap_l').pos[0]).toBeGreaterThan(segPos(skel, f, 'humerus_l')[0] + 0.1)
    }
    // by the hips: the grips just outside the pelvis at the top
    const f0 = fk(skel, frameQ(b, at(b, TOP)))
    const hips = bodyCapsules(skel, f0).filter((c) => c.segment === 'pelvis')
    const outer = Math.max(...hips.flatMap((c) => [c.a[0] + c.r, c.b[0] + c.r]))
    expect(grip0[0][0] - outer).toBeLessThan(0.2)
    // thumbs out at the top: the hand's grip axis turns from straight ahead towards the side
    const yaw = (u: number) => {
      const f = fk(skel, frameQ(b, at(b, u)))
      const ax = qrot(f.rot[skel.seg.hand_l], skel.data.sites.grip_l.axis!)
      return Math.atan2(ax[0], ax[2]) * RAD
    }
    expect(yaw(TOP) - yaw(BOTTOM)).toBeGreaterThan(10)
  })

  it('unsupported variants throw', () => {
    expect(() => bake(t, parse({ implement: 'rings', support: 'bench' }), skel)).toThrow(/variant not implemented yet/)
    expect(() => bake(t, parse({ implement: 'rings' }, 'unilateral'), skel)).toThrow(/variant not implemented yet/)
    expect(() => bake(t, parse({ support: 'bench', implement: 'machine' }), skel)).toThrow(/variant not implemented yet/)
    expect(() => bake(t, parse({ grip: 'pronated' }), skel)).toThrow(/variant not implemented yet/)
    expect(() => bake(t, parse({ implement: 'machine' }), skel)).toThrow(/variant not implemented yet/)
  })
})
