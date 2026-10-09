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

/** wave 3b variants with their own arm path or body (drag, cross-body, concentration, waiter, high cable), tested below */
const own = (b: Baked) => Boolean(b.params.path || b.params.support || b.params.hold || b.params.armPosition)
const arc = [...baked.keys()].filter((slug) => !own(get(slug)))

/** the working side: the left arm of bilateral records (mirrored), the record's side of unilateral ones */
const work = (b: Baked) => (b.params.laterality === 'unilateral' && b.params.side !== 'left' ? 'r' : 'l')

/** upper-arm angle from vertical in the world, deg */
function humerusFromVertical(b: Baked, i: number, s: 'l' | 'r' = 'l') {
  const f = fk(skel, frameQ(b, i))
  return angleBetween(sub(segPos(skel, f, `forearm_${s}`), segPos(skel, f, `humerus_${s}`)), [0, -1, 0]) * RAD
}

/** upper-arm swing in the side view (forward +), deg */
function humerusSwing(b: Baked, i: number, s: 'l' | 'r' = 'l') {
  const f = fk(skel, frameQ(b, i))
  const h = sub(segPos(skel, f, `forearm_${s}`), segPos(skel, f, `humerus_${s}`))
  return Math.atan2(h[2], -h[1]) * RAD
}

describe('curl template', () => {
  it.each(arc)('%s: elbow ~8-17 -> 125-140, upper arm quiet, no shrug, hands on the load', (slug) => {
    const b = get(slug)
    const s = work(b)
    // bars end a little short of lockout: the carrying angle and full supination stop the elbows ~12-17 deg
    expect(dof(b, 0.625, `elbow_${s}.flex`)).toBeLessThan(b.params.implement === 'dumbbell' ? 12 : 20)
    expect(dof(b, 0, `elbow_${s}.flex`)).toBeGreaterThan(120)
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < b.frames; i++) {
      const q = frameQ(b, i)
      expect(q[skel.dof[`clavicle_${s}.elev`]]).toBeLessThan(1)
      const h = humerusSwing(b, i, s)
      lo = Math.min(lo, h)
      hi = Math.max(hi, h)
      expect(humerusFromVertical(b, i, s)).toBeLessThan(35)
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
      if (b.params.posture !== 'standing' || b.params.armPosition) continue
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

  it('bars and cable attachments stay at least 10 mm off the thighs over the whole loop', () => {
    for (const slug of ['701-ez-bar-curl', '710-barbell-curl', '714-ez-bar-reverse-curl', '713-cable-curl', '719-rope-hammer-curl']) {
      const b = get(slug)
      const k = b.implements.findIndex((s) => ['barbell', 'ez_bar', 'cable_handle'].includes(s.kind))
      let worst = Infinity
      for (let i = 0; i < b.frames; i++) {
        const thighs = bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => c.region.startsWith('thigh_'))
        for (const s of placeParts(b.implements[k], frameImplements(b, i)[k])) for (const t of thighs) worst = Math.min(worst, capsuleSolidClearance(t, s))
      }
      expect(worst, slug).toBeGreaterThanOrEqual(0.01)
      expect(worst, slug).toBeLessThan(0.025)
      expect(b.rests?.find((r) => r.implement === b.implements[k].id)?.tol, slug).toBe(-10)
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

  it('Bayesian: the working upper arm stays behind the trunk, the cable runs back to a low pulley, the free arm hangs', () => {
    const b = get('722-bayesian-cable-curl')
    for (let i = 0; i < b.frames; i++) expect(humerusSwing(b, i, 'r')).toBeLessThan(-8)
    expect(dof(b, 0, 'elbow_r.flex')).toBeLessThan(130)
    // staggered stance, working foot back: the trunk stays near upright, the base holds the cable
    for (let i = 0; i < b.frames; i += 10) expect(Math.abs(frameQ(b, i)[skel.dof['pelvis.tilt']])).toBeLessThan(5)
    const pulley = b.cables![0].pulley
    expect(pulley[2]).toBeLessThan(-0.5)
    expect(pulley[1]).toBeLessThan(0.3)
    for (const u of [0, 0.625]) expect(dof(b, u, 'elbow_l.flex')).toBeLessThan(20)
  })

  it('grip widths: close EZ inside, wide barbell outside the standard grips', () => {
    const gap = (slug: string) => {
      const b = get(slug)
      const f = fk(skel, frameQ(b, at(b, 0.625)))
      return dist(sitePos(skel, f, 'grip_l'), sitePos(skel, f, 'grip_r'))
    }
    expect(gap('753-close-grip-ez-bar-curl')).toBeLessThan(gap('701-ez-bar-curl') - 0.05)
    expect(gap('754-wide-grip-barbell-curl')).toBeGreaterThan(gap('710-barbell-curl') + 0.12)
    expect(dof(get('751-reverse-cable-curl'), 0.3, 'forearm_l.pro')).toBeGreaterThan(40)
  })

  /** the hands stay on their implement sites over the loop */
  const handsOn = (b: Baked) => {
    for (let i = 0; i < b.frames; i++) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        if (c.kind !== 'grip' || !('implement' in c.target)) continue
        const { implement, grip } = c.target
        const k = b.implements.findIndex((s) => s.id === implement)
        expect(dist(sitePos(skel, f, c.site), siteWorld(b.implements[k], impl[k], grip).pos)).toBeLessThan(0.005)
      }
    }
  }

  it('Zottman: palms up on the way up, palms down on the way down, turning at the top and bottom', () => {
    const b = get('725-zottman-curl')
    const T = b.tempo[0] + b.tempo[1] + b.tempo[2] + b.tempo[3]
    // mid eccentric palms down, mid concentric palms up
    expect(dof(b, (b.tempo[3] / 2 + b.tempo[0] / 2) / T, 'forearm_l.pro')).toBeGreaterThan(70)
    expect(dof(b, (b.tempo[3] / 2 + b.tempo[0] + b.tempo[1] + b.tempo[2] / 2) / T, 'forearm_l.pro')).toBeLessThan(-75)
    // the turn is smooth: no frame-to-frame jump
    for (let i = 1; i < b.frames; i++) expect(Math.abs(frameQ(b, i)[skel.dof['forearm_l.pro']] - frameQ(b, i - 1)[skel.dof['forearm_l.pro']])).toBeLessThan(15)
    handsOn(b)
  })

  it('cross-body: the dumbbell travels towards the opposite shoulder, thumb up, one arm at a time', () => {
    const b = get('726-cross-body-hammer-curl')
    // top of the right rep (u = 0): the hand crosses well inside its shoulder; the left hangs
    const f = fk(skel, frameQ(b, 0))
    expect(sitePos(skel, f, 'grip_r')[0]).toBeGreaterThan(segPos(skel, f, 'humerus_r')[0] + 0.12)
    expect(dof(b, 0, 'shoulder_r.rot')).toBeGreaterThan(30)
    expect(dof(b, 0, 'elbow_l.flex')).toBeLessThan(20)
    expect(Math.abs(dof(b, 0.625, 'forearm_r.pro'))).toBeLessThan(5)
    handsOn(b)
  })

  it('band curls: a handle in each hand, the band from the rings down under both feet', () => {
    for (const slug of ['727-band-curl', '752-band-hammer-curl']) {
      const b = get(slug)
      const strip = b.implements.find((s) => s.kind === 'band') as unknown as { band: { path: { implement: string; at?: number[] }[] } }
      expect(strip.band.path[0].implement).toBe('handle_l')
      expect(strip.band.path.at(-1)!.implement).toBe('handle_r')
      for (const p of strip.band.path.filter((x) => x.implement === 'floor')) expect(p.at![1]).toBeLessThan(0.01)
      expect(dof(b, 0, 'elbow_l.flex')).toBeGreaterThan(130)
      expect(dof(b, 0.625, 'elbow_l.flex')).toBeLessThan(12)
      handsOn(b)
    }
    expect(dof(get('727-band-curl'), 0.3, 'forearm_l.pro')).toBeLessThan(-70)
    expect(Math.abs(dof(get('752-band-hammer-curl'), 0.3, 'forearm_l.pro'))).toBeLessThan(5)
  })

  it('drag curl: the bar stays against the body and the elbows travel back', () => {
    const b = get('723-barbell-drag-curl')
    const k = b.implements.findIndex((s) => s.kind === 'barbell')
    for (let i = 0; i < b.frames; i += 4) {
      const caps = bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => c.region === 'trunk' || c.region.startsWith('thigh_'))
      const gap = Math.min(...placeParts(b.implements[k], frameImplements(b, i)[k]).flatMap((s) => caps.map((c) => capsuleSolidClearance(c, s))))
      expect(gap).toBeGreaterThan(-0.003)
      expect(gap).toBeLessThan(0.03)
    }
    // top: the upper arm well behind the trunk, elbow past 110; bottom: arms all but straight
    expect(humerusSwing(b, at(b, 0))).toBeLessThan(-30)
    expect(dof(b, 0, 'elbow_l.flex')).toBeGreaterThan(110)
    expect(dof(b, 0.625, 'elbow_l.flex')).toBeLessThan(15)
    handsOn(b)
  })

  it('concentration curl: seated, the working upper arm still against the inner thigh, the free arm still', () => {
    const b = get('724-concentration-curl')
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < b.frames; i++) {
      const q = frameQ(b, i)
      lo = Math.min(lo, q[skel.dof['shoulder_r.elev']])
      hi = Math.max(hi, q[skel.dof['shoulder_r.elev']])
      expect(q[skel.dof['elbow_l.flex']]).toBeCloseTo(frameQ(b, 0)[skel.dof['elbow_l.flex']], 6)
    }
    expect(hi - lo).toBeLessThan(0.5)
    const f = fk(skel, frameQ(b, 0))
    const caps = bodyCapsules(skel, f)
    const brace = Math.min(...caps.filter((c) => c.region === 'upperarm_r').flatMap((a) => caps.filter((c) => c.region === 'thigh_r').map((t) => capsuleClearance(a, t))))
    expect(brace).toBeLessThan(0.01)
    expect(dof(b, 0, 'elbow_r.flex')).toBeGreaterThan(130)
    expect(dof(b, 0.625, 'elbow_r.flex')).toBeLessThan(15)
    handsOn(b)
  })

  it('waiter curl: one dumbbell upright in both palms on the midline, elbows at the sides', () => {
    // 730 stays a card (its ROM stops short of straight arms), so the variant is baked from its params here
    const b = bake(getTemplate('curl'), parseParams('curl', { implement: 'dumbbell', grip: 'supinated', hold: 'two_hand', posture: 'standing' }, 'bilateral'), skel)
    for (let i = 0; i < b.frames; i += 6) {
      const pose = frameImplements(b, i)[0]
      expect(Math.abs(pose.pos[0])).toBeLessThan(1e-6)
      expect(humerusFromVertical(b, i)).toBeLessThan(25)
    }
    // upright at the top (handle along world up)
    const top = frameImplements(b, 0)[0]
    const up = 2 * (top.rot[0] * top.rot[1] + top.rot[2] * top.rot[3])
    expect(up).toBeGreaterThan(0.95)
    expect(dof(b, 0, 'elbow_l.flex')).toBeGreaterThan(120)
    handsOn(b)
  })

  it.each(['720-ez-bar-preacher-curl', '721-dumbbell-preacher-curl', '728-ez-bar-reverse-preacher-curl'])('preacher curl %s: upper arms still on the 45 deg pad, elbow ~15 -> 120', (slug) => {
    const b = get(slug)
    const s = work(b)
    const k = b.implements.findIndex((i) => i.kind === 'preacher_bench')
    const pad = placeParts(b.implements[k], frameImplements(b, 0)[k])[0]
    let lo = Infinity, hi = -Infinity
    const rot: number[] = []
    for (let i = 0; i < b.frames; i++) {
      const f = fk(skel, frameQ(b, i))
      const h = humerusSwing(b, i, s)
      lo = Math.min(lo, h)
      hi = Math.max(hi, h)
      // the back of the upper arm rests on the pad: never more than a centimetre in, never more than 8 mm off it
      const gap = Math.min(...bodyCapsules(skel, f).filter((c) => c.region === `upperarm_${s}`).map((c) => capsuleSolidClearance(c, pad)))
      expect(gap).toBeGreaterThan(-0.01)
      expect(gap).toBeLessThan(0.008)
      // the elbow sits on the pad, inside its edge
      expect(Math.abs(segPos(skel, f, `forearm_${s}`)[0])).toBeLessThan(0.22)
      rot.push(dof(b, i / b.frames, `shoulder_${s}.rot`))
    }
    // the humerus barely twists: the forearm turn and the wrist take the bar
    expect(Math.max(...rot) - Math.min(...rot)).toBeLessThan(15)
    // the pad holds the upper arm about 45 deg forward of vertical in the side view
    expect(hi - lo).toBeLessThan(7)
    expect(Math.abs((hi + lo) / 2 - 45)).toBeLessThan(6)
    // almost straight at the bottom (the bar's grips leave the elbows a few degrees more bent than the dumbbell)
    expect(dof(b, 0.625, `elbow_${s}.flex`)).toBeLessThan(18)
    expect(dof(b, 0, `elbow_${s}.flex`)).toBeGreaterThan(110)
    handsOn(b)
  })

  it('high cable curl: upper arms level out to the sides, hands curling towards the ears, body still', () => {
    const b = get('729-high-cable-curl')
    for (let i = 0; i < b.frames; i++) {
      const q = frameQ(b, i)
      expect(Math.abs(q[skel.dof['shoulder_l.elev']] - 88)).toBeLessThan(1)
    }
    expect(dof(b, 0, 'elbow_l.flex')).toBeGreaterThan(120)
    const f = fk(skel, frameQ(b, 0))
    expect(sitePos(skel, f, 'grip_l')[1]).toBeGreaterThan(sitePos(skel, f, 'chin')[1])
    expect(b.cables?.length).toBe(2)
    let zLo = Infinity, zHi = -Infinity
    for (let i = 0; i < b.frames; i++) {
      const z = frameQ(b, i)[skel.dof['pelvis.tz']]
      zLo = Math.min(zLo, z)
      zHi = Math.max(zHi, z)
    }
    expect(zHi - zLo).toBeLessThan(0.01)
    handsOn(b)
  })
})
