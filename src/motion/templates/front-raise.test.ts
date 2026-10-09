import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { handFrame } from '../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts, segmentDistance } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { cableForce, siteWorld } from '../implements.ts'
import { dist, dot, sub, type V3 } from '../math.ts'
import { shoulderRhythm } from '../skeleton.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'
import { planeElevOf, thoraxFrame } from './isolation.ts'

const skel = testSkeleton()
const variants = motionRecords('front-raise')
const baked = new Map(variants.map((v) => [v.slug, bake(getTemplate('front-raise'), parseParams('front-raise', v.params, v.laterality), skel)]))
const get = (slug: string) => baked.get(slug)!
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]
const TOP = 0
const BOTTOM = 0.625

/** left humerus plane of elevation and elevation in the thorax frame, deg */
function arm(b: Baked, u: number) {
  const q = frameQ(b, at(b, u))
  const f = fk(skel, q)
  return planeElevOf(sub(segPos(skel, f, 'forearm_l'), segPos(skel, f, 'humerus_l')), thoraxFrame(skel, q))
}

const series = (b: Baked, name: string) => Array.from({ length: b.frames }, (_, i) => frameQ(b, i)[skel.dof[name]])
const spread = (v: number[]) => Math.max(...v) - Math.min(...v)

describe('front-raise template', () => {
  it('covers every front-raise record', () => {
    expect([...baked.keys()]).toEqual(['207-prone-y-raise', '209-dumbbell-front-raise', '233-cable-front-raise', '234-plate-front-raise', '236-dumbbell-scaption-raise'])
  })

  it('dumbbell front raise: straight forward from in front of the thighs to shoulder height, soft fixed elbow, no shrug, still trunk', () => {
    const b = get('209-dumbbell-front-raise')
    // research: plane ~90, elevation 0 -> 85
    for (const u of [0.25, 0.5, 0.8]) expect(arm(b, u).plane).toBeCloseTo(90, 0)
    expect(arm(b, BOTTOM).elev).toBeLessThan(25)
    expect(arm(b, TOP).elev).toBeGreaterThan(85)
    expect(arm(b, TOP).elev).toBeLessThan(95)
    expect(spread(series(b, 'elbow_l.flex'))).toBeLessThan(1e-9)
    expect(dof(b, TOP, 'elbow_l.flex')).toBe(10)
    // the clavicle only follows the rhythm, no shrug on top of it
    expect(Math.max(...series(b, 'clavicle_l.elev'))).toBeLessThanOrEqual(shoulderRhythm(90, 90).elev + 0.01)
    for (const name of ['lumbar.flex', 'thorax.flex', 'pelvis.tilt']) expect(spread(series(b, name))).toBeLessThan(1e-9)
    // the forward load sways the body at the ankles a little, as the approved lean-away raise does
    expect(spread(series(b, 'pelvis.tz'))).toBeLessThan(0.045)
    // the dumbbells start in front of the thighs, just clear of them
    const q = frameQ(b, at(b, BOTTOM))
    const thighs = bodyCapsules(skel, fk(skel, q)).filter((c) => c.region.startsWith('thigh_'))
    const impl = frameImplements(b, at(b, BOTTOM))
    let gap = Infinity
    b.implements.forEach((spec, k) => {
      for (const s of placeParts(spec, impl[k])) for (const c of thighs) gap = Math.min(gap, capsuleSolidClearance(c, s))
    })
    expect(gap).toBeGreaterThan(0.002)
    expect(gap).toBeLessThan(0.03)
  })

  it('prone Y-raise: from hanging under the shoulders up into the Y, shoulder blades down and back, chest on the incline pad', () => {
    const b = get('207-prone-y-raise')
    expect(arm(b, TOP).plane).toBeCloseTo(b.params.plane as number, 0)
    expect(arm(b, TOP).elev).toBeCloseTo(b.params.topElevation as number, 0)
    // arms hang vertically at the bottom: hands under the shoulders
    const f = fk(skel, frameQ(b, at(b, BOTTOM)))
    const gh = segPos(skel, f, 'humerus_l'), hand = sitePos(skel, f, 'grip_l')
    expect(gh[1] - hand[1]).toBeGreaterThan(0.5)
    expect(Math.hypot(hand[0] - gh[0], hand[2] - gh[2])).toBeLessThan(0.12)
    // less clavicle elevation than the rhythm alone, and retraction at the top
    expect(dof(b, TOP, 'clavicle_l.elev')).toBeLessThan(0.5 * shoulderRhythm(160, 45).elev)
    expect(dof(b, TOP, 'clavicle_l.prot')).toBeLessThan(dof(b, BOTTOM, 'clavicle_l.prot') - 5)
    const bench = b.implements.find((s) => s.id === 'bench')!
    const pad = placeParts(bench, frameImplements(b, 0).find((p) => p.id === 'bench')!).filter((s) => s.part.pad)
    const trunk = bodyCapsules(skel, fk(skel, frameQ(b, 0))).filter((c) => c.region === 'trunk')
    const rest = Math.min(...trunk.flatMap((c) => pad.map((s) => capsuleSolidClearance(c, s))))
    expect(rest).toBeGreaterThan(-0.015)
    expect(rest).toBeLessThan(0.002)
  })

  it('scaption raise: in the scapular plane to shoulder height, thumbs turning up, soft fixed elbow, still trunk', () => {
    const b = get('236-dumbbell-scaption-raise')
    // ~30 deg forward of the frontal plane; research: elevation 0 -> ~90
    for (const u of [0.25, 0.5, 0.8]) expect(arm(b, u).plane).toBeCloseTo(30, 0)
    expect(arm(b, BOTTOM).elev).toBeLessThan(25)
    expect(arm(b, TOP).elev).toBeGreaterThan(85)
    expect(arm(b, TOP).elev).toBeLessThan(95)
    expect(spread(series(b, 'elbow_l.flex'))).toBeLessThan(1e-9)
    for (const name of ['lumbar.flex', 'thorax.flex', 'pelvis.tilt']) expect(spread(series(b, name))).toBeLessThan(1e-9)
    // palms in at the bottom; thumbs up at the top: the index side of the hand faces up
    const hand = (u: number) => {
      const q = frameQ(b, at(b, u))
      return { h: handFrame(skel, fk(skel, q), 'l'), fr: thoraxFrame(skel, q) }
    }
    const lo = hand(BOTTOM), hi = hand(TOP)
    expect(dot(lo.h.palm, lo.fr.right)).toBeGreaterThan(0.7)
    expect(Math.abs(dot(hi.h.axis, hi.fr.up))).toBeGreaterThan(0.7)
    for (const name of ['shoulder_l.rot', 'forearm_l.pro']) {
      const v = series(b, name)
      for (let i = 1; i < v.length; i++) expect(Math.abs(v[i] - v[i - 1])).toBeLessThan(6)
    }
  })

  it.each([...baked.keys()])('%s: hands stay on the dumbbells, feet stay planted, the loop closes', (slug) => {
    const b = get(slug)
    for (let i = 0; i < b.frames; i += 3) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        if ('world' in c.target) expect(dist(sitePos(skel, f, c.site), c.target.world)).toBeLessThan(0.005)
        else {
          const { implement, grip } = c.target
          const k = b.implements.findIndex((s) => s.id === implement)
          expect(dist(sitePos(skel, f, c.site), siteWorld(b.implements[k], impl[k], grip).pos)).toBeLessThan(0.005)
        }
      }
    }
    const first = frameQ(b, 0), last = frameQ(b, b.frames - 1)
    expect(Math.max(...first.map((v, k) => Math.abs(v - last[k])))).toBeLessThan(0.5)
  })

  it('plate (234): one plate by its rims, from in front of the thighs to eye level, nearly straight arms, still trunk', () => {
    const b = get('234-plate-front-raise')
    const top = arm(b, TOP), bottom = arm(b, BOTTOM)
    expect(top.elev).toBeGreaterThan(100)
    expect(top.elev).toBeLessThan(115)
    expect(bottom.elev).toBeLessThan(35)
    for (const u of [TOP, BOTTOM]) expect(dof(b, u, 'elbow_l.flex')).toBeLessThan(20)
    // both hands on the plate's rims every frame
    for (let i = 0; i < b.frames; i += 5) {
      const f = fk(skel, frameQ(b, i))
      const pose = frameImplements(b, i)[0]
      for (const [s, site] of [['l', 'rim_l'], ['r', 'rim_r']] as const) expect(dist(sitePos(skel, f, `grip_${s}`), siteWorld(b.implements[0], pose, site).pos)).toBeLessThan(0.005)
    }
    // at the top the plate stands upright in front of the eyes
    const f = fk(skel, frameQ(b, at(b, TOP)))
    const plate = frameImplements(b, at(b, TOP))[0]
    expect(Math.abs(plate.pos[1] - segPos(skel, f, 'head')[1])).toBeLessThan(0.12)
    expect(spread(series(b, 'lumbar.flex')) + spread(series(b, 'thorax.flex'))).toBeLessThan(1)
  })

  it('cable rope (233): back to a low pulley, the cable between the legs to the rope, fists a fixed width apart, thumbs up', () => {
    const b = get('233-cable-front-raise')
    const top = arm(b, TOP), bottom = arm(b, BOTTOM)
    // straight forward to shoulder height (research: plane ~90, elevation to ~85-90), from in front of the thighs
    expect(top.elev).toBeGreaterThan(80)
    expect(top.elev).toBeLessThan(100)
    expect(bottom.elev).toBeLessThan(35)
    for (const u of [TOP, BOTTOM]) expect(dof(b, u, 'elbow_l.flex')).toBeLessThan(20)
    const cable = b.cables![0]
    let gap = Infinity
    for (let i = 0; i < b.frames; i += 2) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      // the pulley sits low and behind the heels
      expect(cable.pulley[1]).toBeLessThan(0.2)
      expect(cable.pulley[2]).toBeLessThan(sitePos(skel, f, 'heel_l')[2] - 0.4)
      // the fists keep the rope ends' spacing
      const d = dist(handFrame(skel, f, 'l').pos, handFrame(skel, f, 'r').pos)
      expect(Math.abs(d - 0.2)).toBeLessThan(0.01)
      // the cable runs between the legs: where it crosses the legs' plane it is inside both thighs and shanks
      const { at } = cableForce(cable, impl[b.implements.findIndex((s) => s.id === cable.implement)])
      const legs = bodyCapsules(skel, f).filter((c) => /^(thigh|shank)_/.test(c.region))
      for (const c of legs) gap = Math.min(gap, segmentDistance(c.a, c.b, at, cable.pulley).d - c.r)
    }
    expect(gap).toBeGreaterThan(0.005)
    // the rope's strands leave the fists at the little fingers, towards the pulley
    const f = fk(skel, frameQ(b, at(b, TOP)))
    const h = handFrame(skel, f, 'l')
    const ferrule = frameImplements(b, at(b, TOP))[b.implements.findIndex((s) => s.id === 'handle')].pos as V3
    expect(dot(sub(ferrule, h.pos), h.axis)).toBeLessThan(0)
    expect(spread(series(b, 'lumbar.flex')) + spread(series(b, 'thorax.flex'))).toBeLessThan(1)
  })

  it('unsupported variants throw', () => {
    const t = getTemplate('front-raise')
    const run = (params: Record<string, unknown>) => () => t.setup(parseParams('front-raise', params), skel)
    expect(run({ implement: 'barbell' })).toThrow(/variant not implemented yet/)
    expect(run({ implement: 'cable' })).toThrow(/variant not implemented yet/)
    expect(run({ implement: 'cable', attachment: 'rope', posture: 'seated' })).toThrow(/variant not implemented yet/)
    expect(run({ implement: 'dumbbell', posture: 'seated' })).toThrow(/variant not implemented yet/)
  })
})
