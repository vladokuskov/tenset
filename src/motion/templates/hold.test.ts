import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { angleBetween, RAD, sub, type V3 } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { contactError, frameAt, seamRatio } from './core/checks.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('hold')
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate('hold'), parseParams('hold', v.params, v.laterality), skel)]))
const get = (id: number) => baked.get(id)!
const dof = (b: Baked, i: number, name: string) => frameQ(b, i)[skel.dof[name]]
const mid = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]

/** angle between ankles -> hips and hips -> shoulders, deg (0 = one straight line) */
function lineBreak(b: Baked, i: number) {
  const f = fk(skel, frameQ(b, i))
  const ankle = mid(segPos(skel, f, 'foot_l'), segPos(skel, f, 'foot_r'))
  const hip = mid(segPos(skel, f, 'femur_l'), segPos(skel, f, 'femur_r'))
  const shoulder = mid(segPos(skel, f, 'humerus_l'), segPos(skel, f, 'humerus_r'))
  return angleBetween(sub(hip, ankle), sub(shoulder, hip)) * RAD
}

describe('hold template', () => {
  it('covers every family record', () => {
    expect([...baked.keys()].sort()).toEqual([803, 804, 808])
  })

  it.each([803, 804, 808])('%s: contacts held, the loop closes', (id) => {
    const b = get(id)
    for (let i = 0; i < b.frames; i++) expect(contactError(skel, b, i)).toBeLessThan(0.005)
    expect(seamRatio(skel, b)).toBeLessThan(1.5)
  })

  it.each([803, 804])('%s: a breathing hold, straight line, supports still', (id) => {
    const b = get(id)
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < b.frames; i++) {
      expect(lineBreak(b, i)).toBeLessThan(12)
      const f = fk(skel, frameQ(b, i))
      const y = mid(segPos(skel, f, 'femur_l'), segPos(skel, f, 'femur_r'))[1]
      lo = Math.min(lo, y)
      hi = Math.max(hi, y)
      for (const c of bodyCapsules(skel, f)) expect(Math.min(c.a[1], c.b[1]) - c.r, c.name).toBeGreaterThan(-0.005)
    }
    // subtle life, not a frozen still: the hip joints move a few millimetres with the breath
    expect(hi - lo).toBeGreaterThan(0.001)
    expect(hi - lo).toBeLessThan(0.015)
  })

  it('804 front plank: elbows under the shoulders, forearms on the mat', () => {
    const b = get(804)
    const f = fk(skel, frameQ(b, frameAt(b, 0)))
    for (const s of ['l', 'r']) {
      const sh = segPos(skel, f, `humerus_${s}`), el = segPos(skel, f, `forearm_${s}`)
      expect(Math.hypot(sh[0] - el[0], sh[2] - el[2])).toBeLessThan(0.05)
      expect(el[1]).toBeLessThan(0.08)
    }
  })

  it('803 side plank: on the working forearm, hips up, top hand on the hip', () => {
    const b = get(803)
    const f = fk(skel, frameQ(b, frameAt(b, 0)))
    const sh = segPos(skel, f, 'humerus_r'), el = segPos(skel, f, 'forearm_r')
    expect(Math.hypot(sh[0] - el[0], sh[2] - el[2])).toBeLessThan(0.05)
    expect(el[1]).toBeLessThan(0.08)
    // the working (right) side down, the free hand up by the pelvis
    expect(segPos(skel, f, 'femur_l')[1]).toBeGreaterThan(segPos(skel, f, 'femur_r')[1] + 0.1)
    expect(Math.hypot(...sub(sitePos(skel, f, 'grip_l'), segPos(skel, f, 'pelvis')))).toBeLessThan(0.3)
  })

  it('808 Pallof press: presses straight out and back, the trunk stays square', () => {
    const b = get(808)
    const k = b.implements.findIndex((s) => s.id === 'handle')
    const out = frameImplements(b, frameAt(b, 0))[k].pos, chest = frameImplements(b, frameAt(b, 0.625))[k].pos
    expect(out[2] - chest[2]).toBeGreaterThan(0.25)
    expect(Math.abs(out[1] - chest[1])).toBeLessThan(0.04)
    expect(Math.min(dof(b, frameAt(b, 0), 'elbow_l.flex'), dof(b, frameAt(b, 0), 'elbow_r.flex'))).toBeLessThan(15)
    expect(dof(b, frameAt(b, 0.625), 'elbow_l.flex')).toBeGreaterThan(90)
    for (let i = 0; i < b.frames; i++) for (const n of ['pelvis.rot', 'lumbar.rot', 'thorax.rot']) expect(Math.abs(dof(b, i, n))).toBeLessThan(0.5)
  })

  it('unsupported variants say so', () => {
    const t = getTemplate('hold')
    expect(() => t.setup(parseParams('hold', { kind: 'side_plank', legs: 'staggered' }), skel)).toThrow(/variant not implemented yet/)
    expect(() => t.setup(parseParams('hold', { kind: 'pallof_press', implement: 'cable', pressOut: false }), skel)).toThrow(/variant not implemented yet/)
  })
})
