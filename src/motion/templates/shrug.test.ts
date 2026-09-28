import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { angleBetween, dist, qconj, qrot, RAD, sub } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('shrug')
const baked = new Map(variants.map((v) => [v.slug, bake(getTemplate('shrug'), parseParams('shrug', v.params, v.laterality), skel)]))
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const TOP = 0
const BOTTOM = 0.625
const dof = (b: Baked, i: number, name: string) => frameQ(b, i)[skel.dof[name]]

function range(b: Baked, fn: (i: number) => number) {
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < b.frames; i++) {
    const v = fn(i)
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  return hi - lo
}

describe('shrug template', () => {
  it('covers every shrug record', () => {
    expect(variants.map((v) => v.id).sort()).toEqual([308, 314])
  })

  it.each([...baked.keys()])('%s: clavicles rise ~0 -> 25 deg straight up, no rolling, arms still', (slug) => {
    const b = baked.get(slug)!
    expect(b.q.every(Number.isFinite)).toBe(true)
    for (const s of ['l', 'r']) {
      // research: clavicle elevation 0 -> ~25 (SC joint)
      expect(dof(b, at(b, BOTTOM), `clavicle_${s}.elev`)).toBeLessThan(2)
      expect(dof(b, at(b, TOP), `clavicle_${s}.elev`)).toBeGreaterThan(20)
      expect(dof(b, at(b, TOP), `clavicle_${s}.elev`)).toBeLessThan(30)
      // straight up: protraction does not move (no rolling), and the arms hang the same way throughout
      expect(range(b, (i) => dof(b, i, `clavicle_${s}.prot`))).toBeLessThan(0.5)
      expect(range(b, (i) => dof(b, i, `elbow_${s}.flex`))).toBeLessThan(1.5)
      // upper arm direction in the thorax frame (the plane angle is ill-defined for an arm this close to hanging)
      const hum = (i: number) => {
        const f = fk(skel, frameQ(b, i))
        const d = sub(segPos(skel, f, `forearm_${s}`), segPos(skel, f, `humerus_${s}`))
        return qrot(qconj(f.rot[skel.seg.thorax2]), d)
      }
      expect(angleBetween(hum(at(b, TOP)), hum(at(b, BOTTOM))) * RAD).toBeLessThan(3)
    }
    expect(range(b, (i) => dof(b, i, 'lumbar.flex') + dof(b, i, 'thorax.flex'))).toBeLessThan(0.5)
  })

  it.each([...baked.keys()])('%s: the load rises with the shoulders, hands on it, feet planted, loop closes', (slug) => {
    const b = baked.get(slug)!
    const first = fk(skel, frameQ(b, 0))
    for (let i = 0; i < b.frames; i++) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        if (c.kind === 'planted') expect(dist(sitePos(skel, f, c.site), sitePos(skel, first, c.site))).toBeLessThan(0.002)
        if (c.kind === 'grip' && 'implement' in c.target) {
          const { implement, grip } = c.target
          const k = b.implements.findIndex((s) => s.id === implement)
          expect(dist(sitePos(skel, f, c.site), siteWorld(b.implements[k], impl[k], grip).pos)).toBeLessThan(0.005)
        }
      }
    }
    const lift = (fn: (i: number) => number) => fn(at(b, TOP)) - fn(at(b, BOTTOM))
    const shoulder = lift((i) => segPos(skel, fk(skel, frameQ(b, i)), 'humerus_l')[1])
    const load = lift((i) => frameImplements(b, i)[0].pos[1])
    expect(shoulder).toBeGreaterThan(0.05)
    expect(Math.abs(load - shoulder)).toBeLessThan(0.015)
    const step = Math.max(...frameQ(b, b.frames - 1).map((v, k) => Math.abs(v - frameQ(b, 0)[k])))
    expect(step).toBeLessThan(0.5)
  })

  it('unsupported variants throw', () => {
    const t = getTemplate('shrug')
    expect(() => t.setup(parseParams('shrug', { implement: 'cable' }), skel)).toThrow(/variant not implemented yet/)
    expect(() => t.setup(parseParams('shrug', { implement: 'dumbbell', posture: 'seated' }), skel)).toThrow(/variant not implemented yet/)
  })
})
