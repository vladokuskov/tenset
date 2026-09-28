import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist, sub } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'
import { planeElevOf, thoraxFrame } from './isolation.ts'

const skel = testSkeleton()
const variants = motionRecords('rear-raise')
const baked = new Map(variants.map((v) => [v.slug, bake(getTemplate('rear-raise'), parseParams('rear-raise', v.params, v.laterality), skel)]))
const get = (slug: string) => baked.get(slug)!
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const TOP = 0
const BOTTOM = 0.625

/** left humerus plane of elevation and elevation in the thorax frame, deg */
function arm(b: Baked, u: number) {
  const q = frameQ(b, at(b, u))
  const f = fk(skel, q)
  return planeElevOf(sub(segPos(skel, f, 'forearm_l'), segPos(skel, f, 'humerus_l')), thoraxFrame(skel, q))
}

const series = (b: Baked, name: string) => Array.from({ length: b.frames }, (_, i) => frameQ(b, i)[skel.dof[name]])

describe('rear-raise template', () => {
  it('covers every rear-raise record', () => {
    expect([...baked.keys()]).toEqual(['205-reverse-pec-deck', '210-bent-over-rear-delt-fly', '213-cable-rear-delt-fly'])
  })

  it.each([...baked.keys()])('%s: horizontal abduction from in front to in line with the shoulders, elbows soft, no shrug', (slug) => {
    const b = get(slug)
    // research: horizontal abduction ~-90 -> 0
    expect(arm(b, BOTTOM).plane).toBeGreaterThan(75)
    expect(Math.abs(arm(b, TOP).plane)).toBeLessThan(10)
    for (const u of [TOP, 0.3, BOTTOM]) expect(arm(b, u).elev).toBeGreaterThan(70)
    const elbows = series(b, 'elbow_l.flex')
    if (b.params.implement === 'machine') {
      // "arms nearly straight": solved onto the handle arcs
      expect(Math.max(...elbows)).toBeLessThan(20)
    } else for (const e of elbows) expect(e).toBeCloseTo(b.params.elbowAngle as number, 6)
    expect(Math.max(...series(b, 'clavicle_l.elev'))).toBeLessThan(2.5)
    // the shoulder blades squeeze back at the top
    const prot = series(b, 'clavicle_l.prot')
    expect(prot[at(b, TOP)]).toBeLessThan(prot[at(b, BOTTOM)] - 3)
  })

  it.each([...baked.keys()])('%s: hands stay on the load, feet stay planted, the loop closes', (slug) => {
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

  it('bent over: flat back hinged ~70 deg, the dumbbells hang under the shoulders at the bottom', () => {
    const b = get('210-bent-over-rear-delt-fly')
    const f = fk(skel, frameQ(b, at(b, BOTTOM)))
    const trunk = sub(segPos(skel, f, 'neck1'), segPos(skel, f, 'pelvis'))
    const hinge = (Math.atan2(trunk[2], trunk[1]) * 180) / Math.PI
    expect(hinge).toBeGreaterThan(60)
    expect(hinge).toBeLessThan(85)
    // the upper arm hangs plumb; the soft elbow brings the dumbbells in under the chest
    const gh = segPos(skel, f, 'humerus_l'), elbow = segPos(skel, f, 'forearm_l'), hand = sitePos(skel, f, 'grip_l')
    expect(Math.hypot(elbow[0] - gh[0], elbow[2] - gh[2])).toBeLessThan(0.01)
    expect(gh[1] - hand[1]).toBeGreaterThan(0.45)
    expect(Math.hypot(hand[0] - gh[0], hand[2] - gh[2])).toBeLessThan(0.15)
    for (const name of ['pelvis.tz', 'pelvis.tilt', 'lumbar.flex', 'knee_l.flex']) {
      const v = series(b, name)
      expect(Math.max(...v) - Math.min(...v)).toBeLessThan(1e-9)
    }
  })

  it('cable: each hand holds the opposite tower\'s cable at shoulder height', () => {
    const b = get('213-cable-rear-delt-fly')
    const gh = segPos(skel, fk(skel, frameQ(b, 0)), 'humerus_l')
    for (const c of b.cables!) {
      expect(Math.sign(c.pulley[0])).toBe(c.implement === 'handle_l' ? -1 : 1)
      expect(Math.abs(c.pulley[1] - gh[1])).toBeLessThan(0.1)
    }
  })

  it('reverse pec deck: chest on the pad through the rep', () => {
    const b = get('205-reverse-pec-deck')
    const frame = b.implements.find((s) => s.kind === 'pec_deck')!
    for (const i of [0, at(b, BOTTOM)]) {
      const pad = placeParts(frame, frameImplements(b, i).find((p) => p.id === frame.id)!).filter((s) => s.part.pad)
      const trunk = bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => c.region === 'trunk')
      const rest = Math.min(...trunk.flatMap((c) => pad.map((s) => capsuleSolidClearance(c, s))))
      expect(rest).toBeGreaterThan(-0.015)
      expect(rest).toBeLessThan(0.002)
    }
  })

  it('unsupported variants throw', () => {
    const t = getTemplate('rear-raise')
    const run = (params: Record<string, unknown>, lat?: string) => () => t.setup(parseParams('rear-raise', params, lat), skel)
    expect(run({ implement: 'dumbbell' }, 'unilateral')).toThrow(/variant not implemented yet/)
    expect(run({ implement: 'dumbbell', posture: 'lying_prone' })).toThrow(/variant not implemented yet/)
    expect(run({ implement: 'cable', torsoAngle: 45 })).toThrow(/variant not implemented yet/)
  })
})
