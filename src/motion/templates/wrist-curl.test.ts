import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts, solidClearance } from '../collide.ts'
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
/** kneeling at the cross bench (the standing and half-kneeling variants have their own tests below) */
const BENCH = [...baked.keys()].filter((id) => get(id).params.support === 'bench')

describe('wrist-curl template', () => {
  it('covers every wrist-curl record', () => {
    expect([...baked.keys()].sort()).toEqual([708, 709, 746, 747, 748, 749, 750])
  })

  it('only the wrists move (the barbell adds a little deviation to keep the hands on its spacing)', () => {
    for (const id of BENCH) {
      const b = get(id)
      const moving = skel.dofs.filter((d) => {
        let lo = Infinity, hi = -Infinity
        for (let i = 0; i < b.frames; i++) {
          const v = b.q[i * b.nDof + d.index]
          lo = Math.min(lo, v)
          hi = Math.max(hi, v)
        }
        return hi - lo > 1e-3
      })
      const wrists = ['wrist_l.flex', 'wrist_r.flex']
      expect(moving.map((d) => d.name).sort()).toEqual(id === 746 || id === 747 ? ['wrist_l.dev', ...wrists, 'wrist_r.dev'].sort() : wrists)
    }
  })

  it.each([[708, 709], [746, 747]])('palms up (%s): from extension to flexion; palms down (%s): from flexion to extension, inside the limits', (a, z) => {
    const up = get(a), down = get(z)
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

  it.each(BENCH)('%s: forearms rest on the pad, wrists past its far edge, hands on the dumbbells', (id) => {
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

  it.each(BENCH)('%s: the knees rest well inside the mat, the tucked toes on it', (id) => {
    const b = get(id)
    const k = b.implements.findIndex((s) => s.kind === 'mat')
    const mat = frameImplements(b, 0)[k]
    const box = b.implements[k].parts[0]
    if (box.shape !== 'box') throw new Error('mat is a box')
    // the mat is turned across the lifter: its width runs front to back (world Z)
    const front = mat.pos[2] + box.size[0] / 2, back = mat.pos[2] - box.size[0] / 2
    const legs = bodyCapsules(skel, fk(skel, frameQ(b, 0))).filter((c) => /^(thigh|shank|foot)_/.test(c.region))
    const low = legs.flatMap((c) => [c.a, c.b].filter((e) => e[1] - c.r < 0.03).map((e) => [e[2] - c.r, e[2] + c.r]))
    expect(front - Math.max(...low.map((z) => z[1]))).toBeGreaterThan(0.06)
    expect(Math.min(...low.map((z) => z[0])) - back).toBeGreaterThan(0.02)
  })

  it.each(BENCH)('%s: the hanging load clears the bench by 15 mm', (id) => {
    const b = get(id)
    const k = b.implements.findIndex((s) => s.kind === 'cross_bench')
    const held = b.implements.filter((s) => s.kind === 'dumbbell' || s.kind === 'barbell').map((s) => s.id)
    expect(held.length).toBeGreaterThan(0)
    let gap = Infinity
    for (let i = 0; i < b.frames; i += 2) {
      const impl = frameImplements(b, i)
      const bench = placeParts(b.implements[k], impl[k])
      for (const id of held) {
        const j = b.implements.findIndex((s) => s.id === id)
        for (const d of placeParts(b.implements[j], impl[j])) for (const p of bench) gap = Math.min(gap, solidClearance(d, p))
      }
    }
    expect(gap).toBeGreaterThan(0.015)
  })

  it.each([...baked.keys()])('%s: the loop closes without a jump', (id) => {
    const b = get(id)
    const n = b.frames
    const d = skel.dof['wrist_l.flex']
    const x = Array.from({ length: n }, (_, i) => b.q[i * b.nDof + d])
    const step = Math.max(...x.slice(1).map((v, i) => Math.abs(v - x[i])))
    expect(Math.abs(x[0] - x[n - 1])).toBeLessThanOrEqual(1.5 * step)
  })

  it('barbell: one bar across both hands, its axis level and across the lifter', () => {
    for (const id of [746, 747]) {
      const b = get(id)
      expect(b.contacts.filter((c) => c.kind === 'grip').map((c) => 'implement' in c.target && `${c.target.implement}:${c.target.grip}`)).toEqual(['bar:l', 'bar:r'])
      const k = b.implements.findIndex((s) => s.id === 'bar')
      for (let i = 0; i < b.frames; i += 5) {
        const axis = qrot(frameImplements(b, i)[k].rot, [1, 0, 0])
        expect(axis[0]).toBeGreaterThan(0.999)
      }
      // the deviation that keeps the hands on the bar stays small
      for (let i = 0; i < b.frames; i++) expect(Math.abs(frameQ(b, i)[skel.dof['wrist_l.dev']])).toBeLessThan(15)
    }
  })

  /** the hands stay on their implement sites */
  const handsOn = (b: Baked) => {
    for (let i = 0; i < b.frames; i += 3) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        if (c.kind !== 'grip' || !('implement' in c.target)) continue
        const { implement, grip } = c.target
        const j = b.implements.findIndex((s) => s.id === implement)
        expect(dist(sitePos(skel, f, c.site), siteWorld(b.implements[j], impl[j], grip).pos)).toBeLessThan(0.005)
      }
    }
  }

  it('behind the back: arms hang still behind the thighs, the wrists curl the bar up and back, clear of the body', () => {
    const b = get(749)
    // flexion at the top, extension at the stretch
    expect(flex(b, 0) - flex(b, midBottom(b))).toBeGreaterThan(80)
    const k = b.implements.findIndex((s) => s.id === 'bar')
    let gap = Infinity
    for (let i = 0; i < b.frames; i++) {
      const q = frameQ(b, i)
      expect(q[skel.dof['elbow_l.flex']]).toBeLessThan(6)
      expect(q[skel.dof['forearm_l.pro']]).toBeGreaterThan(70)
      const caps = bodyCapsules(skel, fk(skel, q)).filter((c) => c.region === 'trunk' || c.region.startsWith('thigh_'))
      for (const d of placeParts(b.implements[k], frameImplements(b, i)[k])) for (const c of caps) gap = Math.min(gap, capsuleSolidClearance(c, d))
      // the bar behind the body
      expect(frameImplements(b, i)[k].pos[2]).toBeLessThan(segPos(skel, fk(skel, q), 'pelvis')[2])
    }
    expect(gap).toBeGreaterThan(0.005)
    handsOn(b)
  })

  it('half kneeling band extension: the forearm along the front thigh, palm down, only the wrist moves', () => {
    const b = get(750)
    expect(b.symmetric).toBe(false)
    const moving = skel.dofs.filter((d) => {
      let lo = Infinity, hi = -Infinity
      for (let i = 0; i < b.frames; i++) {
        const v = b.q[i * b.nDof + d.index]
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
      return hi - lo > 1e-3
    })
    expect(moving.map((d) => d.name)).toEqual(['wrist_r.flex'])
    // hand hanging at the stretch, extended at the top
    expect(flex(b, midBottom(b), 'r') - flex(b, 0, 'r')).toBeGreaterThan(70)
    const f = fk(skel, frameQ(b, 0))
    const caps = bodyCapsules(skel, f)
    const fore = caps.filter((c) => c.region === 'forearm_r'), thigh = caps.filter((c) => c.region === 'thigh_r')
    const knee = segPos(skel, f, 'tibia_r'), wrist = segPos(skel, f, 'hand_r')
    expect(wrist[2]).toBeGreaterThan(knee[2])
    expect(Math.min(...fore.flatMap((a) => thigh.map((t) => Math.hypot(...sub(a.b, t.b)))))).toBeLessThan(0.25)
    // the rear knee on the mat, the band under the front foot
    const mat = b.implements.findIndex((s) => s.kind === 'mat')
    expect(dist(segPos(skel, f, 'tibia_l'), [frameImplements(b, 0)[mat].pos[0], segPos(skel, f, 'tibia_l')[1], frameImplements(b, 0)[mat].pos[2]])).toBeLessThan(0.2)
    handsOn(b)
  })

  it('kneeling cable wrist curl: sitting back towards the heels, forearms on the thighs, only the wrists move', () => {
    const b = get(748)
    expect(b.symmetric).toBe(true)
    const moving = skel.dofs.filter((d) => {
      let lo = Infinity, hi = -Infinity
      for (let i = 0; i < b.frames; i++) {
        const v = b.q[i * b.nDof + d.index]
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
      return hi - lo > 1e-3
    })
    expect(moving.map((d) => d.name).sort()).toEqual(['wrist_l.dev', 'wrist_l.flex', 'wrist_r.dev', 'wrist_r.flex'])
    // palms up: extended at the stretch, flexed at the top
    expect(flex(b, midBottom(b))).toBeLessThan(-15)
    expect(flex(b, 0)).toBeGreaterThan(45)
    const f = fk(skel, frameQ(b, 0))
    // knees deep (past the model's 150 stop, allowed for this variant), the wrists past the knees
    expect(frameQ(b, 0)[skel.dof['knee_l.flex']]).toBeGreaterThan(145)
    expect(b.limits?.['knee_l.flex']?.[1]).toBeLessThanOrEqual(160)
    expect(segPos(skel, f, 'hand_l')[2]).toBeGreaterThan(segPos(skel, f, 'tibia_l')[2])
    // the forearms lie along the thighs (about 2 cm off the capsules, so the hands clear the floor at the stretch)
    const caps = bodyCapsules(skel, f)
    const fore = caps.filter((c) => c.region === 'forearm_l'), thigh = caps.filter((c) => c.region === 'thigh_l')
    expect(Math.min(...fore.flatMap((a) => thigh.map((t) => capsuleClearance(a, t))))).toBeLessThan(0.03)
    // a straight bar on a low pulley in front
    expect(b.cables?.[0].pulley[1]).toBeLessThan(0.2)
    expect(b.cables![0].pulley[2]).toBeGreaterThan(segPos(skel, f, 'hand_l')[2])
    handsOn(b)
  })

  it('unsupported variants throw', () => {
    const p = parseParams('wrist-curl', { implement: 'barbell', posture: 'seated', support: 'thigh' })
    expect(() => getTemplate('wrist-curl').setup(p, skel)).toThrow(/variant not implemented yet/)
  })
})
