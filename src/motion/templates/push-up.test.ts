import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts, segmentDistance } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist, qrot, RAD } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { armElevation } from './press-body.ts'
import { _pushUp, pushUp } from './push-up.ts'
import { RING_LEAN, ringLean } from './rings.ts'
import { RING_HEIGHT } from '../implements/index.ts'
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
/** kneeling: the capsules round the knees, which rest on the floor */
const KNEES = /^(shank_[lr]1|thigh_[lr][23])/

describe('push-up template', () => {
  it('covers every record of the template', () => {
    expect([...baked.keys()].sort()).toEqual([106, 113, 114, 115, 125, 126, 134, 223, 732])
  })

  it.each([...baked.keys()].filter((id) => !baked.get(id)!.params.pike))('%s: elbow ~6 at the top to the chest a fist above the support, plank rigid', (id) => {
    const b = baked.get(id)!
    expect(dof(b, TOP, 'elbow_l.flex')).toBeLessThan(10)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeGreaterThan(75)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeLessThan(135)
    for (let i = 0; i < b.frames; i += 3) {
      const q = frameQ(b, i)
      expect(q[skel.dof['hip_l.flex']]).toBeCloseTo(2, 5)
      if (!b.params.kneeling) expect(q[skel.dof['knee_l.flex']]).toBeCloseTo(2, 5)
      expect(q[skel.dof['lumbar.flex']]).toBeCloseTo(0, 5)
    }
    // bottom: the chest a fist (8 cm) over the support under the hands, or the head 4 cm off the floor where that
    // comes first (feet on a box tip the head down; the neck extends there, so the chest still binds first)
    const support = b.params.elevation === 'hands' ? 0.45 : b.params.implement === 'rings' ? RING_HEIGHT.push_up : 0
    const caps = bodyCapsules(skel, fk(skel, frameQ(b, at(b, BOTTOM))))
    const low = (re: RegExp) => Math.min(...caps.filter((c) => re.test(c.segment)).map((c) => Math.min(c.a[1], c.b[1]) - c.r))
    const chest = low(/^thorax/) - support, head = low(/^head$/)
    expect(chest).toBeGreaterThan(0.06)
    expect(chest).toBeLessThan(0.1)
    expect(head).toBeGreaterThan(0.035)
    expect(Math.min(chest - 0.08, head - 0.04)).toBeCloseTo(0, 3)
  })

  it.each([...baked.keys()].filter((id) => baked.get(id)!.params.implement !== 'rings'))('%s: palms and balls of the feet planted, palms near flat, wrists in range, seamless', (id) => {
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
      // diamond: the turned-in hands tip up to ~25 deg at the bottom (the forearms lean out to the tucked elbows and the
      // rig's pronation runs out at 85)
      expect(Math.acos(-n[1]) * RAD, `palm tilt @${i}`).toBeLessThan((b.params.gripWidth as number) < 0.5 ? 26 : 15)
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
      const caps = bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => FREE.test(c.region) && !(b.params.kneeling && KNEES.test(c.name)))
      for (const c of caps) floor = Math.min(floor, Math.min(c.a[1], c.b[1]) - c.r)
      if (box >= 0) for (const s of placeParts(b.implements[box], frameImplements(b, i)[box])) for (const c of caps) prop = Math.min(prop, capsuleSolidClearance(c, s))
    }
    // diamond: the wrist end of the forearm passes ~1 mm over the floor on the way down (the hand flat, turned in)
    expect(floor).toBeGreaterThan((b.params.gripWidth as number) < 0.5 ? 0.001 : 0.003)
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

  it('feet on a box: the balls of the feet on its top just behind the front edge, toes turned under, near level', () => {
    const b = baked.get(115)!
    const k = b.implements.findIndex((s) => s.kind === 'plyo_box')
    const parts = b.implements[k].parts.filter((q): q is Extract<typeof q, { shape: 'box' }> => q.shape === 'box')
    const d = parts[0].size[2]
    const h = Math.max(...parts.map((q) => q.center[1] + q.size[1] / 2))
    for (let i = 0; i < b.frames; i += 3) {
      const box = frameImplements(b, i)[k].pos
      const f = fk(skel, frameQ(b, i))
      for (const s of ['l', 'r']) {
        const ball = sitePos(skel, f, `ball_${s}`)
        const edge = box[2] + d / 2 - ball[2]
        expect(edge, `ball_${s} on the top @${i}`).toBeGreaterThan(0.02)
        expect(edge, `ball_${s} near the front edge @${i}`).toBeLessThan(0.05)
        expect(Math.abs(ball[1] - h), `ball_${s} height @${i}`).toBeLessThan(0.01)
        // toes turned under (pointing at the hands), not hanging straight down off the edge (dir y ~ -1)
        const toes = qrot(f.rot[skel.seg[`toes_${s}`]], [0, 0, 1])
        expect(toes[2], `toes_${s} forward @${i}`).toBeGreaterThan(0.95)
        expect(toes[1], `toes_${s} near level @${i}`).toBeGreaterThan(-0.25)
      }
    }
  })

  it('hands on a box incline the body, feet on a box decline it', () => {
    const floor = baked.get(113)!, hands = baked.get(114)!, feet = baked.get(115)!
    expect(pitch(hands, BOTTOM)).toBeGreaterThan(pitch(floor, BOTTOM) + 20)
    expect(pitch(feet, BOTTOM)).toBeLessThan(0)
    expect(pitch(floor, TOP)).toBeGreaterThan(12)
    expect(pitch(floor, TOP)).toBeLessThan(25)
  })

  it('kneeling (134): the knees rest on the floor in one place the whole rep, balls of the feet planted behind, a shorter and steeper plank', () => {
    const b = baked.get(134)!
    const knee0 = segPos(skel, fk(skel, frameQ(b, 0)), 'tibia_l')
    for (let i = 0; i < b.frames; i++) {
      const f = fk(skel, frameQ(b, i))
      const low = Math.min(...bodyCapsules(skel, f).filter((c) => KNEES.test(c.name)).map((c) => Math.min(c.a[1], c.b[1]) - c.r))
      expect(low, `knee rest @${i}`).toBeGreaterThan(-0.006)
      expect(low, `knee rest @${i}`).toBeLessThan(-0.004)
      expect(dist(segPos(skel, f, 'tibia_l'), knee0), `knee still @${i}`).toBeLessThan(0.01)
      expect(frameQ(b, i)[skel.dof['knee_l.flex']]).toBeGreaterThan(10)
    }
    expect(pitch(b, TOP)).toBeGreaterThan(pitch(baked.get(113)!, TOP) + 10)
  })

  it('diamond (732): the hands together under the chest, fingers turned in, the chest lowered to just over them', () => {
    const b = baked.get(732)!
    const f = fk(skel, frameQ(b, at(b, BOTTOM)))
    const [l, r] = [sitePos(skel, f, 'grip_l'), sitePos(skel, f, 'grip_r')]
    expect(dist(l, r)).toBeLessThan(0.2)
    // the left hand's fingers point forward and in (towards -X)
    const fingers = qrot(f.rot[skel.seg.hand_l], [0, -1, 0])
    expect(fingers[0]).toBeLessThan(-0.3)
    // under the chest: the hands sit between the shoulders, about on the shoulder line
    expect(Math.abs(l[0])).toBeLessThan(skel.data.shoulderWidth / 2 - 0.08)
    expect(Math.abs(l[2] - segPos(skel, f, 'humerus_l')[2])).toBeLessThan(0.08)
    // the elbows stay nearer the ribs than on the regular push-up: ~20-25 deg out seen from above (the band push-up's
    // standard grip ~35) and narrower, the elbows pointing back towards the feet
    const elbow = (id: number) => {
      const g = fk(skel, frameQ(baked.get(id)!, at(baked.get(id)!, BOTTOM)))
      const sh = segPos(skel, g, 'humerus_l'), el = segPos(skel, g, 'forearm_l'), wr = segPos(skel, g, 'hand_l')
      const fore = Math.asin((el[1] - wr[1]) / dist(el, wr)) * RAD
      return { x: el[0], top: Math.atan2(el[0] - sh[0], sh[2] - el[2]) * RAD, fore }
    }
    expect(elbow(732).top).toBeGreaterThan(15)
    expect(elbow(732).top).toBeLessThan(28)
    expect(elbow(732).top).toBeLessThan(elbow(125).top - 8)
    expect(elbow(732).x).toBeLessThan(elbow(125).x - 0.04)
    // the forearms stay well off the floor (the chest sinks to the hands, not onto the forearms)
    expect(elbow(732).fore).toBeGreaterThan(22)
  })

  it('band (125): the strip crosses the upper back and wraps the back of each shoulder to the floor beside the hands, clear of the trunk and arms', () => {
    const b = baked.get(125)!
    expect(b.implements.some((s) => s.kind === 'band')).toBe(true)
    const ids = b.implements.filter((s) => s.id.startsWith('wrap_')).map((s) => s.id)
    expect(ids).toHaveLength(10)
    for (let i = 0; i < b.frames; i += 5) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      const caps = bodyCapsules(skel, f).filter((c) => /^(upperarm|trunk)/.test(c.region))
      for (const id of ids) {
        const p = impl[b.implements.findIndex((s) => s.id === id)].pos
        expect(Math.min(...caps.map((c) => segmentDistance(c.a, c.b, p, p).d - c.r)), `${id} @${i}`).toBeGreaterThan(-0.01)
      }
      // the back node rides on the upper back, above the floor-facing chest
      const back = impl[b.implements.findIndex((s) => s.id === 'back')].pos
      expect(back[1]).toBeGreaterThan(0.2)
    }
  })

  it('pike (223): hips high, folded ~90 deg, the head lowering to the floor just in front of the hands, arms pressing overhead', () => {
    const b = baked.get(223)!
    for (let i = 0; i < b.frames; i += 5) {
      const q = frameQ(b, i)
      expect(q[skel.dof['hip_l.flex']]).toBeCloseTo(88, 5)
      const f = fk(skel, q)
      expect(segPos(skel, f, 'pelvis')[1]).toBeGreaterThan(segPos(skel, f, 'humerus_l')[1] + 0.2)
    }
    expect(dof(b, TOP, 'elbow_l.flex')).toBeLessThan(10)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeGreaterThan(75)
    // arms overhead relative to the trunk at the top (~115 deg; the hands sit ahead of the head)
    expect(armElevation(skel, fk(skel, frameQ(b, at(b, TOP))))).toBeGreaterThan(105)
    const f = fk(skel, frameQ(b, at(b, BOTTOM)))
    const head = bodyCapsules(skel, f).filter((c) => c.region === 'head')
    expect(Math.min(...head.map((c) => Math.min(c.a[1], c.b[1]) - c.r))).toBeCloseTo(0.04, 3)
    expect(segPos(skel, f, 'head')[2]).toBeGreaterThan(sitePos(skel, f, 'grip_l')[2])
  })

  it('rings (126): the hands close on rings that stay put, under the shoulders at the top, elbows by the sides, thumbs turning out', () => {
    const b = baked.get(126)!
    expect(b.q.every(Number.isFinite)).toBe(true)
    const ids = ['ring_l', 'ring_r'].map((id) => b.implements.findIndex((s) => s.id === id))
    const anchor = b.implements.find((s) => s.id === 'rings')!
    const ai = b.implements.indexOf(anchor)
    const grip0 = ids.map((k) => siteWorld(b.implements[k], frameImplements(b, 0)[k], 'grip').pos)
    // the grips just above the floor
    expect(grip0[0][1]).toBeCloseTo(RING_HEIGHT.push_up, 3)
    for (let i = 0; i < b.frames; i++) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        const target = 'world' in c.target ? c.target.world : siteWorld(b.implements[b.implements.findIndex((s) => s.id === (c.target as { implement: string }).implement)], impl[b.implements.findIndex((s) => s.id === (c.target as { implement: string }).implement)], (c.target as { grip: string }).grip).pos
        expect(dist(sitePos(skel, f, c.site), target), `${c.site} @${i}`).toBeLessThan(0.005)
      }
      ids.forEach((k, j) => {
        expect(dist(siteWorld(b.implements[k], impl[k], 'grip').pos, grip0[j])).toBeLessThan(0.002)
        expect(ringLean({ anchor: anchor as never, anchorPose: impl[ai], implements: b.implements }, impl[k], j ? 'r' : 'l')).toBeLessThan(RING_LEAN + 9)
      })
      // a straight wrist on the ring
      expect(Math.abs(frameQ(b, i)[skel.dof['wrist_l.flex']])).toBeLessThan(30)
    }
    const top = fk(skel, frameQ(b, at(b, TOP)))
    expect(Math.abs(segPos(skel, top, 'humerus_l')[2] - grip0[0][2])).toBeLessThan(0.02)
    // the straps hang from a beam overhead, outside the arms
    expect(siteWorld(anchor, frameImplements(b, 0)[ai], 'strap_l').pos[0]).toBeGreaterThan(segPos(skel, top, 'humerus_l')[0] + 0.08)
    // "keep the rings close to your sides": the elbows ~18 deg out at the bottom, tucked tighter than the floor push-up
    const flareAt = (bb: Baked) => _pushUp.flare(skel, frameQ(bb, at(bb, BOTTOM)))
    expect(Math.abs(flareAt(b) - 18)).toBeLessThan(3)
    expect(flareAt(b)).toBeLessThan(flareAt(baked.get(106)!) - 5)
    // thumbs turn out at the top
    const yaw = (u: number) => {
      const f = fk(skel, frameQ(b, at(b, u)))
      const ax = qrot(f.rot[skel.seg.hand_l], skel.data.sites.grip_l.axis!)
      return Math.atan2(ax[0], ax[2]) * RAD
    }
    expect(yaw(TOP) - yaw(BOTTOM)).toBeGreaterThan(12)
    const first = frameQ(b, 0), last = frameQ(b, b.frames - 1)
    for (const d of skel.dofs) expect(Math.abs(first[d.index] - last[d.index]), d.name).toBeLessThan(d.unit === 'm' ? 0.002 : 1)
  })

  it('unsupported variants throw', () => {
    expect(() => bake(t, parse({ implement: 'rings', kneeling: true }), skel)).toThrow(/variant not implemented yet/)
    expect(() => bake(t, parse({ implement: 'rings', elevation: 'feet' }), skel)).toThrow(/variant not implemented yet/)
    expect(() => bake(t, parse({ pike: true, kneeling: true }), skel)).toThrow(/variant not implemented yet/)
    expect(() => bake(t, parse({ kneeling: true, elevation: 'hands' }), skel)).toThrow(/variant not implemented yet/)
    expect(() => bake(t, parse({}, 'unilateral'), skel)).toThrow(/variant not implemented yet/)
  })
})
