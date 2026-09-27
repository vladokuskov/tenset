import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { bodyCapsules, capsuleClearance, capsuleSolidClearance, placeParts } from '../collide.ts'
import { zeroQ } from '../skeleton.ts'
import { siteWorld } from '../implements.ts'
import { angleBetween, dist, RAD, sub } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('curl')
const baked = new Map(variants.map((v) => [v.slug, bake(getTemplate('curl'), parseParams('curl', v.params, v.laterality), skel)]))
const get = (slug: string) => baked.get(slug)!
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]

/** upper-arm angle from vertical in the world, deg */
function humerusFromVertical(b: Baked, i: number) {
  const f = fk(skel, frameQ(b, i))
  return angleBetween(sub(segPos(skel, f, 'forearm_l'), segPos(skel, f, 'humerus_l')), [0, -1, 0]) * RAD
}

/** upper-arm swing in the side view (forward +), deg */
function humerusSwing(b: Baked, i: number) {
  const f = fk(skel, frameQ(b, i))
  const h = sub(segPos(skel, f, 'forearm_l'), segPos(skel, f, 'humerus_l'))
  return Math.atan2(h[2], -h[1]) * RAD
}

describe('curl template', () => {
  it.each([...baked.keys()])('%s: elbow ~8-17 -> 125-140, upper arm quiet, no shrug, hands on the load', (slug) => {
    const b = get(slug)
    // bars end a little short of lockout: the carrying angle and full supination stop the elbows ~12-17 deg
    expect(dof(b, 0.625, 'elbow_l.flex')).toBeLessThan(b.params.implement === 'dumbbell' ? 12 : 20)
    expect(dof(b, 0, 'elbow_l.flex')).toBeGreaterThan(120)
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < b.frames; i++) {
      const q = frameQ(b, i)
      expect(q[skel.dof['clavicle_l.elev']]).toBeLessThan(1)
      const h = humerusSwing(b, i)
      lo = Math.min(lo, h)
      hi = Math.max(hi, h)
      expect(humerusFromVertical(b, i)).toBeLessThan(35)
      const f = fk(skel, q)
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        if (c.kind !== 'grip' || !('implement' in c.target)) continue
        const { implement, grip } = c.target
        const k = b.implements.findIndex((s) => s.id === implement)
        expect(dist(sitePos(skel, f, c.site), siteWorld(b.implements[k], impl[k], grip).pos)).toBeLessThan(0.005)
      }
    }
    // the upper arm only drifts a little forward near the top: no swing (cable variants may hang forward at the
    // bottom, pulled towards the low pulley)
    expect(hi - lo).toBeLessThan(b.params.implement === 'cable' ? 22 : 15)
  })

  it('standing curls keep the body still and the upper arms beside the waist, not in it', () => {
    // clearance beyond whatever overlap the pair already has standing relaxed (as the penetration gate counts it)
    const rest = bodyCapsules(skel, fk(skel, zeroQ(skel)))
    const restGap = new Map(rest.flatMap((a) => rest.map((t) => [`${a.name}/${t.name}`, capsuleClearance(a, t)] as const)))
    for (const [slug, b] of baked) {
      if (b.params.posture !== 'standing') continue
      let zLo = Infinity, zHi = -Infinity, waist = Infinity
      for (let i = 0; i < b.frames; i++) {
        const q = frameQ(b, i)
        const z = q[skel.dof['pelvis.tz']]
        zLo = Math.min(zLo, z)
        zHi = Math.max(zHi, z)
        const caps = bodyCapsules(skel, fk(skel, q))
        const arms = caps.filter((c) => c.region.startsWith('upperarm_'))
        const trunk = caps.filter((c) => c.region === 'trunk' && c.segment !== 'thorax2')
        waist = Math.min(waist, ...arms.flatMap((a) => trunk.map((t) => capsuleClearance(a, t) + Math.max(0, -restGap.get(`${a.name}/${t.name}`)!))))
      }
      expect(zHi - zLo, `${slug} hip travel`).toBeLessThan(0.05)
      // soft contact only (the penetration gate allows 12 mm)
      expect(waist, `${slug} upper arm into the waist`).toBeGreaterThan(-0.012)
    }
  })

  it('standing dumbbells clear the thighs: the carrying angle swings them out (no shoulder abduction stand-in)', () => {
    for (const slug of ['711-dumbbell-curl', '703-hammer-curl']) {
      const b = get(slug)
      let worst = Infinity
      for (let i = 0; i < b.frames; i++) {
        const thighs = bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => c.region.startsWith('thigh_'))
        const impl = frameImplements(b, i)
        b.implements.forEach((spec, k) => {
          for (const s of placeParts(spec, impl[k])) for (const t of thighs) worst = Math.min(worst, capsuleSolidClearance(t, s))
        })
      }
      expect(worst, slug).toBeGreaterThan(-0.003)
      expect(Math.abs(dof(b, 0.625, 'shoulder_l.elev'))).toBeLessThan(6)
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

  it('incline puts the upper arm behind the trunk, spider in front of it, both vertical in the side view', () => {
    const incline = get('702-incline-dumbbell-curl')
    const spider = get('712-spider-curl')
    expect(dof(incline, 0.625, 'shoulder_l.plane')).toBeLessThan(-60)
    expect(dof(incline, 0.625, 'shoulder_l.elev')).toBeGreaterThan(35)
    expect(dof(spider, 0.625, 'shoulder_l.plane')).toBeGreaterThan(80)
    expect(dof(spider, 0.625, 'shoulder_l.elev')).toBeGreaterThan(35)
    for (const b of [incline, spider]) {
      const f = fk(skel, frameQ(b, at(b, 0.625)))
      const h = sub(segPos(skel, f, 'forearm_l'), segPos(skel, f, 'humerus_l'))
      expect((Math.abs(Math.atan2(h[2], -h[1])) * 180) / Math.PI).toBeLessThan(3)
    }
    // incline: elbows a little out so the dumbbells pass outside the hips
    expect(humerusFromVertical(incline, at(incline, 0.625))).toBeGreaterThan(10)
  })
})
