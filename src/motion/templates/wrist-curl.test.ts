import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist, qconj, qrot, sub } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('wrist-curl')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('wrist-curl'), parseParams('wrist-curl', v.params, v.laterality), skel)]))
const get = (id: number) => baked.get(id)!
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const midBottom = (b: Baked) => (b.tempo[3] / 2 + b.tempo[0] + b.tempo[1] / 2) / (b.tempo[0] + b.tempo[1] + b.tempo[2] + b.tempo[3])
const flex = (b: Baked, u: number, s = 'l') => frameQ(b, at(b, u))[skel.dof[`wrist_${s}.flex`]]

describe('wrist-curl template', () => {
  it('covers every wrist-curl record', () => {
    expect([...baked.keys()].sort()).toEqual([708, 709])
  })

  it('only the wrists move', () => {
    for (const b of baked.values()) {
      const moving = skel.dofs.filter((d) => {
        let lo = Infinity, hi = -Infinity
        for (let i = 0; i < b.frames; i++) {
          const v = b.q[i * b.nDof + d.index]
          lo = Math.min(lo, v)
          hi = Math.max(hi, v)
        }
        return hi - lo > 1e-3
      })
      expect(moving.map((d) => d.name).sort()).toEqual(['wrist_l.flex', 'wrist_r.flex'])
    }
  })

  it('palms up: from extension to flexion; palms down: from flexion to extension, inside the limits', () => {
    const up = get(708), down = get(709)
    // mid top pause (u = 0) is the contraction, mid bottom pause the stretch
    expect(flex(up, midBottom(up))).toBeLessThan(-50)
    expect(flex(up, 0)).toBeGreaterThan(55)
    expect(flex(down, midBottom(down))).toBeGreaterThan(50)
    expect(flex(down, 0)).toBeLessThan(-40)
    for (const b of [up, down]) {
      for (let i = 0; i < b.frames; i++) {
        const v = frameQ(b, i)[skel.dof['wrist_l.flex']]
        expect(v).toBeGreaterThan(-68)
        expect(v).toBeLessThan(73)
      }
    }
    // palms up and palms down: the forearms turn near their limits either way
    expect(frameQ(up, 0)[skel.dof['forearm_l.pro']]).toBeLessThan(-70)
    expect(frameQ(down, 0)[skel.dof['forearm_l.pro']]).toBeGreaterThan(70)
  })

  it.each([...baked.keys()])('%s: forearms rest on the pad, wrists past its far edge, hands on the dumbbells', (id) => {
    const b = get(id)
    const k = b.implements.findIndex((s) => s.kind === 'cross_bench')
    const impl = frameImplements(b, 0)
    const pads = placeParts(b.implements[k], impl[k])
    const f = fk(skel, frameQ(b, 0))
    for (const s of ['l', 'r']) {
      const fore = bodyCapsules(skel, f).filter((c) => c.region === `forearm_${s}`)
      const gap = Math.min(...fore.flatMap((c) => pads.map((p) => capsuleSolidClearance(c, p))))
      // resting: pressed in a few mm, never floating
      expect(gap).toBeLessThan(0.002)
      expect(gap).toBeGreaterThan(-0.015)
      // the wrist joint clears the far edge (bench frame: +X across the pad, towards the lifter's back)
      const wrist = qrot(qconj(impl[k].rot), sub(segPos(skel, f, `hand_${s}`), impl[k].pos))
      const pad = b.implements[k].parts[1]
      if (pad.shape !== 'box') throw new Error('pad is a box')
      expect(-wrist[0] - pad.size[0] / 2).toBeGreaterThan(0.02)
    }
    for (let i = 0; i < b.frames; i += 3) {
      const fi = fk(skel, frameQ(b, i))
      const ii = frameImplements(b, i)
      for (const c of b.contacts) {
        if ('implement' in c.target) {
          const { implement, grip } = c.target
          const j = b.implements.findIndex((s) => s.id === implement)
          expect(dist(sitePos(skel, fi, c.site), siteWorld(b.implements[j], ii[j], grip).pos)).toBeLessThan(0.005)
        } else expect(dist(sitePos(skel, fi, c.site), c.target.world)).toBeLessThan(0.005)
      }
    }
  })

  it.each([...baked.keys()])('%s: the loop closes without a jump', (id) => {
    const b = get(id)
    const n = b.frames
    const d = skel.dof['wrist_l.flex']
    const x = Array.from({ length: n }, (_, i) => b.q[i * b.nDof + d])
    const step = Math.max(...x.slice(1).map((v, i) => Math.abs(v - x[i])))
    expect(Math.abs(x[0] - x[n - 1])).toBeLessThanOrEqual(1.5 * step)
  })

  it('unsupported variants throw', () => {
    const p = parseParams('wrist-curl', { implement: 'barbell', posture: 'seated', support: 'thigh' })
    expect(() => getTemplate('wrist-curl').setup(p, skel)).toThrow(/variant not implemented yet/)
  })
})
