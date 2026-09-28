import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist, sub } from '../math.ts'
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
    expect([...baked.keys()]).toEqual(['207-prone-y-raise', '209-dumbbell-front-raise'])
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

  it('unsupported variants throw', () => {
    const t = getTemplate('front-raise')
    const run = (params: Record<string, unknown>) => () => t.setup(parseParams('front-raise', params), skel)
    expect(run({ implement: 'barbell' })).toThrow(/variant not implemented yet/)
    expect(run({ implement: 'cable' })).toThrow(/variant not implemented yet/)
    expect(run({ implement: 'dumbbell', posture: 'seated' })).toThrow(/variant not implemented yet/)
  })
})
