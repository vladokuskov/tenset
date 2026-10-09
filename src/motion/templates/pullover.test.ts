import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { angleBetween, dist, norm, qrot, RAD, sub } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const t = getTemplate('pullover')
const variants = motionRecords('pullover')
const baked = new Map(variants.map((v) => [v.id, bake(t, parseParams('pullover', v.params, v.laterality), skel)]))
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const TOP = 0
const BOTTOM = 0.625

/** upper arm angle from the thorax's long axis (towards the hips), deg: shoulder flexion in the sagittal plane */
function flexion(b: Baked, u: number) {
  const f = fk(skel, frameQ(b, at(b, u)))
  const hum = norm(sub(segPos(skel, f, 'forearm_l'), segPos(skel, f, 'humerus_l')))
  return angleBetween(hum, qrot(f.rot[skel.seg.thorax2], [0, -1, 0])) * RAD
}

describe('pullover template', () => {
  it('covers every pullover record', () => {
    expect([...baked.keys()].sort()).toEqual([325, 326, 327])
  })

  it.each([...baked.keys()])('%s: finite frames, hands on the load, planted feet still, loop closes', (id) => {
    const b = baked.get(id)!
    expect(b.q.every(Number.isFinite)).toBe(true)
    const first = fk(skel, frameQ(b, 0))
    for (let i = 0; i < b.frames; i++) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        if (c.kind === 'planted') expect(dist(sitePos(skel, f, c.site), sitePos(skel, first, c.site))).toBeLessThan(0.002)
        if (c.kind === 'grip' && 'implement' in c.target) {
          const k = b.implements.findIndex((s) => s.id === (c.target as { implement: string }).implement)
          expect(dist(sitePos(skel, f, c.site), siteWorld(b.implements[k], impl[k], (c.target as { grip: string }).grip).pos)).toBeLessThan(0.005)
        }
      }
    }
    const step = Math.max(...frameQ(b, b.frames - 1).map((v, k) => Math.abs(v - frameQ(b, 0)[k])))
    expect(step).toBeLessThan(0.5)
  })

  it.each([325, 327])('%s standing: elbows held, arms sweep from about eye level to the thighs', (id) => {
    const b = baked.get(id)!
    const elbow = (u: number) => frameQ(b, at(b, u))[skel.dof['elbow_l.flex']]
    for (const u of [0, 0.3, BOTTOM, 0.8]) expect(Math.abs(elbow(u) - 10)).toBeLessThan(1)
    // research: straight-arm pulldown ~90-130 -> ~0-20 deg of flexion against the trunk
    expect(flexion(b, BOTTOM)).toBeGreaterThan(110)
    expect(flexion(b, BOTTOM)).toBeLessThan(135)
    expect(flexion(b, TOP)).toBeLessThan(30)
  })

  it('326 lying: arms over the chest at the top, back past the head at the stretch, elbows held soft', () => {
    const b = baked.get(326)!
    const elbow = (u: number) => frameQ(b, at(b, u))[skel.dof['elbow_l.flex']]
    expect(elbow(TOP)).toBeCloseTo(20, 0)
    expect(elbow(BOTTOM)).toBeCloseTo(20, 0)
    expect(flexion(b, TOP)).toBeGreaterThan(80)
    expect(flexion(b, TOP)).toBeLessThan(100)
    expect(flexion(b, BOTTOM)).toBeGreaterThan(140)
    // the dumbbell travels back over the head, below the hands' start height
    const db = (u: number) => frameImplements(b, at(b, u))[0].pos
    expect(db(BOTTOM)[1]).toBeLessThan(db(TOP)[1] - 0.3)
  })

  it('unsupported variants throw', () => {
    expect(() => t.setup(parseParams('pullover', { implement: 'cable', attachment: 'rope' }), skel)).toThrow(/variant not implemented yet/)
    expect(() => t.setup(parseParams('pullover', { implement: 'dumbbell' }), skel)).toThrow(/variant not implemented yet/)
    expect(() => t.setup(parseParams('pullover', { implement: 'band' }, 'unilateral'), skel)).toThrow(/variant not implemented yet/)
  })
})
