import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { angleBetween, dist, RAD, sub } from '../math.ts'
import { testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
type Variant = { slug: string; template: string; laterality: string; params: Record<string, unknown> }
const variants = (JSON.parse(readFileSync(new URL('../../../data/motion-templates/variants.json', import.meta.url), 'utf8')) as Variant[]).filter((v) => v.template === 'curl')
const baked = new Map(variants.map((v) => [v.slug, bake(getTemplate('curl'), parseParams('curl', v.params, v.laterality), skel)]))
const get = (slug: string) => baked.get(slug)!
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]

/** upper-arm angle from vertical in the world, deg */
function humerusFromVertical(b: Baked, i: number) {
  const f = fk(skel, frameQ(b, i))
  return angleBetween(sub(segPos(skel, f, 'forearm_l'), segPos(skel, f, 'humerus_l')), [0, -1, 0]) * RAD
}

describe('curl template', () => {
  it.each([...baked.keys()])('%s: elbow ~8 -> 125-140, upper arm quiet, no shrug, hands on the load', (slug) => {
    const b = get(slug)
    expect(dof(b, 0.625, 'elbow_l.flex')).toBeLessThan(12)
    expect(dof(b, 0, 'elbow_l.flex')).toBeGreaterThan(120)
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < b.frames; i++) {
      const q = frameQ(b, i)
      expect(q[skel.dof['clavicle_l.elev']]).toBeLessThan(1)
      const h = humerusFromVertical(b, i)
      lo = Math.min(lo, h)
      hi = Math.max(hi, h)
      const f = fk(skel, q)
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        if (c.kind !== 'grip' || !('implement' in c.target)) continue
        const { implement, grip } = c.target
        const k = b.implements.findIndex((s) => s.id === implement)
        expect(dist(sitePos(skel, f, c.site), siteWorld(b.implements[k], impl[k], grip).pos)).toBeLessThan(0.005)
      }
    }
    // the upper arm only drifts a little forward near the top: no swing
    expect(hi - lo).toBeLessThan(15)
  })

  it('standing curls keep the body still and the elbows outside the waist', () => {
    for (const [slug, b] of baked) {
      if (b.params.posture !== 'standing') continue
      let zLo = Infinity, zHi = -Infinity, elbowIn = Infinity
      for (let i = 0; i < b.frames; i++) {
        const q = frameQ(b, i)
        const z = q[skel.dof['pelvis.tz']]
        zLo = Math.min(zLo, z)
        zHi = Math.max(zHi, z)
        elbowIn = Math.min(elbowIn, Math.abs(segPos(skel, fk(skel, q), 'forearm_l')[0]))
      }
      expect(zHi - zLo, `${slug} hip travel`).toBeLessThan(0.04)
      // waist half-width at elbow height is ~14 cm on the body mesh, plus ~4 cm of elbow
      expect(elbowIn, `${slug} elbow to midline`).toBeGreaterThan(0.18)
    }
  })

  it('standing dumbbells clear the thighs at the bottom', () => {
    // thigh surface ~8.5 cm lateral of the hip joint centre at dumbbell height on the body mesh
    for (const slug of ['711-dumbbell-curl', '703-hammer-curl']) {
      const b = get(slug)
      const i = at(b, 0.625)
      const f = fk(skel, frameQ(b, i))
      const k = b.implements.findIndex((s) => s.id === 'db_l')
      const pose = frameImplements(b, i)[k]
      let inner = Infinity
      for (const part of b.implements[k].parts) {
        if (part.shape !== 'cylinder') continue
        const a = siteWorld({ ...b.implements[k], sites: { p: { pos: part.a } } }, pose, 'p').pos
        const e = siteWorld({ ...b.implements[k], sites: { p: { pos: part.b } } }, pose, 'p').pos
        const axis = sub(e, a)
        const sideways = part.r * Math.sqrt(Math.max(0, 1 - (axis[0] / Math.hypot(...axis)) ** 2))
        inner = Math.min(inner, a[0] - sideways, e[0] - sideways)
      }
      expect(inner, slug).toBeGreaterThan(segPos(skel, f, 'femur_l')[0] + 0.085)
    }
  })

  it('forearm rotation follows the grip', () => {
    expect(dof(get('711-dumbbell-curl'), 0.3, 'forearm_l.pro')).toBeLessThan(-70)
    expect(Math.abs(dof(get('703-hammer-curl'), 0.3, 'forearm_l.pro'))).toBeLessThan(5)
    expect(dof(get('714-ez-bar-reverse-curl'), 0.3, 'forearm_l.pro')).toBeGreaterThan(40)
  })

  it('supinates from neutral early in the concentric when asked', () => {
    const b = bake(getTemplate('curl'), parseParams('curl', { supinate: true }), skel)
    expect(Math.abs(dof(b, 0.625, 'forearm_l.pro'))).toBeLessThan(1)
    expect(dof(b, 0, 'forearm_l.pro')).toBeLessThan(-75)
  })

  it('incline puts the upper arm behind the trunk, spider in front of it, both vertical in the world', () => {
    const incline = get('702-incline-dumbbell-curl')
    const spider = get('712-spider-curl')
    expect(dof(incline, 0.625, 'shoulder_l.plane')).toBeLessThan(-80)
    expect(dof(incline, 0.625, 'shoulder_l.elev')).toBeGreaterThan(35)
    expect(dof(spider, 0.625, 'shoulder_l.plane')).toBeGreaterThan(80)
    expect(dof(spider, 0.625, 'shoulder_l.elev')).toBeGreaterThan(35)
    for (const b of [incline, spider]) expect(humerusFromVertical(b, at(b, 0.625))).toBeLessThan(3)
  })
})
