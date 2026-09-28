import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../collide.ts'
import { fk, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist, qrot, RAD } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { _pushUp, pushUp } from './push-up.ts'
import { SCHEMAS } from './schemas.ts'
import type { AnyTemplate } from './types.ts'

const skel = testSkeleton()
const t = pushUp as unknown as AnyTemplate
const parse = (raw: Record<string, unknown>, laterality = 'bilateral') => SCHEMAS['push-up'].parse({ ...raw, laterality })
const variants = motionRecords('push-up')
const baked = new Map(variants.map((v) => [v.id, bake(t, parse(v.params, v.laterality), skel)]))
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]
const TOP = 0, BOTTOM = 0.635
/** body line pitch (deg above horizontal, head up): the pelvis is tilted 90 - pitch */
const pitch = (b: Baked, u: number) => 90 - dof(b, u, 'pelvis.tilt')
/** regions whose capsules model the body faithfully here (palms and turned-under toes are allowed their sink) */
const FREE = /^(trunk|head|neck|thigh|shank|upperarm|forearm)/

describe('push-up template', () => {
  it('covers every record of the template', () => {
    expect([...baked.keys()].sort()).toEqual([106, 113, 114, 115])
  })

  it.each([...baked.keys()])('%s: elbow ~6 at the top to the chest a fist above the support, plank rigid', (id) => {
    const b = baked.get(id)!
    expect(dof(b, TOP, 'elbow_l.flex')).toBeLessThan(10)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeGreaterThan(75)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeLessThan(135)
    for (let i = 0; i < b.frames; i += 3) {
      const q = frameQ(b, i)
      expect(q[skel.dof['hip_l.flex']]).toBeCloseTo(2, 5)
      expect(q[skel.dof['knee_l.flex']]).toBeCloseTo(2, 5)
      expect(q[skel.dof['lumbar.flex']]).toBeCloseTo(0, 5)
    }
    // bottom: the chest a fist (8 cm) over the support under the hands, or the head 4 cm off the floor where that
    // comes first (feet on a box tip the head down; the neck extends there, so the chest still binds first)
    const support = b.params.elevation === 'hands' ? 0.45 : 0
    const caps = bodyCapsules(skel, fk(skel, frameQ(b, at(b, BOTTOM))))
    const low = (re: RegExp) => Math.min(...caps.filter((c) => re.test(c.segment)).map((c) => Math.min(c.a[1], c.b[1]) - c.r))
    const chest = low(/^thorax/) - support, head = low(/^head$/)
    expect(chest).toBeGreaterThan(0.06)
    expect(chest).toBeLessThan(0.1)
    expect(head).toBeGreaterThan(0.035)
    expect(Math.min(chest - 0.08, head - 0.04)).toBeCloseTo(0, 3)
  })

  it.each([...baked.keys()])('%s: palms and balls of the feet planted, palms near flat, wrists in range, seamless', (id) => {
    const b = baked.get(id)!
    expect(b.q.every(Number.isFinite)).toBe(true)
    const [lo, hi] = b.limits!['wrist_l.flex']
    for (let i = 0; i < b.frames; i++) {
      const q = frameQ(b, i)
      const f = fk(skel, q)
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        const target = 'world' in c.target ? c.target.world : (() => {
          const { implement, grip } = c.target
          const k = b.implements.findIndex((s) => s.id === implement)
          return siteWorld(b.implements[k], impl[k], grip).pos
        })()
        expect(dist(sitePos(skel, f, c.site), target), `${c.site} @${i}`).toBeLessThan(0.005)
      }
      const n = qrot(f.rot[skel.seg.hand_l], skel.data.sites.grip_l.normal!)
      expect(Math.acos(-n[1]) * RAD, `palm tilt @${i}`).toBeLessThan(15)
      const w = q[skel.dof['wrist_l.flex']]
      expect(w).toBeGreaterThanOrEqual(lo - 0.5)
      expect(w).toBeLessThanOrEqual(hi + 0.5)
      expect(q[skel.dof['forearm_l.pro']]).toBeLessThanOrEqual(85.5)
    }
    const first = frameQ(b, 0), last = frameQ(b, b.frames - 1)
    for (const d of skel.dofs) expect(Math.abs(first[d.index] - last[d.index]), d.name).toBeLessThan(d.unit === 'm' ? 0.002 : 1)
  })

  it.each([...baked.keys()])('%s: trunk, head and legs stay clear of the floor and the box (the floor tolerance only covers palms and toes)', (id) => {
    const b = baked.get(id)!
    const box = b.implements.findIndex((s) => s.kind === 'plyo_box')
    let floor = Infinity, prop = Infinity
    for (let i = 0; i < b.frames; i++) {
      const caps = bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => FREE.test(c.region))
      for (const c of caps) floor = Math.min(floor, Math.min(c.a[1], c.b[1]) - c.r)
      if (box >= 0) for (const s of placeParts(b.implements[box], frameImplements(b, i)[box])) for (const c of caps) prop = Math.min(prop, capsuleSolidClearance(c, s))
    }
    expect(floor).toBeGreaterThan(0.003)
    if (box >= 0) expect(prop).toBeGreaterThan(0.003)
    expect(b.tolerances?.floor).toBeLessThanOrEqual(65)
  })

  it('elbows flare wider with the wider grip; the plus protracts the shoulder blades at the top', () => {
    const plus = baked.get(106)!, regular = baked.get(113)!
    const flare = (b: Baked, u: number) => _pushUp.flare(skel, frameQ(b, at(b, u)))
    expect(flare(regular, BOTTOM)).toBeGreaterThan(20)
    expect(flare(regular, BOTTOM)).toBeLessThan(45)
    expect(flare(regular, BOTTOM)).toBeGreaterThan(flare(plus, BOTTOM) + 10)
    expect(dof(plus, TOP, 'clavicle_l.prot')).toBeGreaterThan(dof(regular, TOP, 'clavicle_l.prot') + 12)
    expect(dof(plus, BOTTOM, 'clavicle_l.prot')).toBeLessThan(-5)
  })

  it('hands on a box: the palms stay on its top and the chest comes down at its near edge', () => {
    const b = baked.get(114)!
    const k = b.implements.findIndex((s) => s.kind === 'plyo_box')
    const part = b.implements[k].parts[0]
    if (part.shape !== 'box') throw new Error('plyo box without a box part')
    const [w, , d] = part.size
    for (let i = 0; i < b.frames; i += 3) {
      const z0 = frameImplements(b, i)[k].pos[2]
      for (const c of bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => /^palm_/.test(c.name))) {
        for (const p of [c.a, c.b]) {
          expect(Math.abs(p[0]) + c.r, `palm x @${i}`).toBeLessThan(w / 2 - 0.01)
          expect(Math.abs(p[2] - z0) + c.r, `palm z @${i}`).toBeLessThan(d / 2)
        }
      }
    }
    const i = at(b, BOTTOM)
    const chest = bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => /^thorax/.test(c.segment)).map((c) => (c.a[1] - c.r < c.b[1] - c.r ? c.a : c.b)).sort((p, q) => p[1] - q[1])[0]
    expect(Math.abs(chest[2] - (frameImplements(b, i)[k].pos[2] - d / 2))).toBeLessThan(0.06)
  })

  it('hands on a box incline the body, feet on a box decline it', () => {
    const floor = baked.get(113)!, hands = baked.get(114)!, feet = baked.get(115)!
    expect(pitch(hands, BOTTOM)).toBeGreaterThan(pitch(floor, BOTTOM) + 20)
    expect(pitch(feet, BOTTOM)).toBeLessThan(0)
    expect(pitch(floor, TOP)).toBeGreaterThan(12)
    expect(pitch(floor, TOP)).toBeLessThan(25)
  })

  it('unsupported variants throw', () => {
    expect(() => bake(t, parse({ kneeling: true }), skel)).toThrow(/variant not implemented yet/)
    expect(() => bake(t, parse({}, 'unilateral'), skel)).toThrow(/variant not implemented yet/)
  })
})
