import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { handFrame } from '../constraints.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist, dot, sub } from '../math.ts'
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
    expect([...baked.keys()]).toEqual([
      '205-reverse-pec-deck', '210-bent-over-rear-delt-fly', '213-cable-rear-delt-fly', '228-band-pull-apart', '230-incline-prone-rear-delt-raise',
      '231-prone-t-raise',
    ])
  })

  it.each([...baked.keys()])('%s: horizontal abduction from in front to in line with the shoulders, elbows soft, no shrug', (slug) => {
    const b = get(slug)
    // research: horizontal abduction ~-90 -> 0 (the pull-apart starts a little wider so the light band stretches less)
    expect(arm(b, BOTTOM).plane).toBeGreaterThan(b.params.implement === 'band' ? 70 : 75)
    expect(Math.abs(arm(b, TOP).plane)).toBeLessThan(10)
    // prone on the 45 deg pad the arms hang at 45 deg of flexion, then rise level with the shoulders
    const low = b.params.posture === 'lying_prone' ? 40 : 70
    for (const u of [TOP, 0.3, BOTTOM]) expect(arm(b, u).elev).toBeGreaterThan(low)
    if (b.params.posture === 'lying_prone') expect(arm(b, TOP).elev).toBeGreaterThan(80)
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

  it.each(['230-incline-prone-rear-delt-raise', '231-prone-t-raise'])('%s: chest on the incline pad, body still, the dumbbells hang plumb at the bottom', (slug) => {
    const b = get(slug)
    const bench = b.implements.find((s) => s.id === 'bench')!
    for (const i of [0, at(b, BOTTOM)]) {
      const pad = placeParts(bench, frameImplements(b, i).find((p) => p.id === bench.id)!).filter((s) => s.part.pad)
      const trunk = bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => c.region === 'trunk')
      const rest = Math.min(...trunk.flatMap((c) => pad.map((s) => capsuleSolidClearance(c, s))))
      expect(rest).toBeGreaterThan(-0.015)
      expect(rest).toBeLessThan(0.002)
    }
    for (const name of ['pelvis.ty', 'pelvis.tz', 'pelvis.tilt', 'lumbar.flex', 'knee_l.flex']) {
      const v = series(b, name)
      expect(Math.max(...v) - Math.min(...v)).toBeLessThan(1e-9)
    }
    const f = fk(skel, frameQ(b, at(b, BOTTOM)))
    const gh = segPos(skel, f, 'humerus_l'), elbow = segPos(skel, f, 'forearm_l')
    expect(Math.hypot(elbow[0] - gh[0], elbow[2] - gh[2])).toBeLessThan(0.01)
    // the hands turn smoothly: no humeral or forearm rotation step
    for (const name of ['shoulder_l.rot', 'forearm_l.pro']) {
      const v = series(b, name)
      for (let i = 1; i < v.length; i++) expect(Math.abs(v[i] - v[i - 1])).toBeLessThan(6)
    }
  })

  it('prone hands at the top: palms down on the rear delt raise, thumbs up and palms towards the head on the T-raise', () => {
    const palmAtTop = (slug: string) => {
      const b = get(slug)
      const q = frameQ(b, at(b, TOP))
      const fr = thoraxFrame(skel, q)
      const palm = handFrame(skel, fk(skel, q), 'l').palm
      return { fwd: dot(palm, fr.fwd), up: dot(palm, fr.up) }
    }
    // the trunk's front faces the floor prone, so palms down is along the thorax's forward axis
    expect(palmAtTop('230-incline-prone-rear-delt-raise').fwd).toBeGreaterThan(0.7)
    expect(palmAtTop('231-prone-t-raise').up).toBeGreaterThan(0.7)
  })

  it('band pull-apart (228): arms straight in front at shoulder height open to the shoulder line, the band across the chest', () => {
    const b = get('228-band-pull-apart')
    const start = arm(b, BOTTOM), end = arm(b, TOP)
    expect(start.plane).toBeGreaterThan(70)
    expect(end.plane).toBeLessThan(12)
    // pronated: palms face the floor through the whole arc, so the band runs along the knuckles
    for (let i = 0; i < b.frames; i += 5) {
      const q = frameQ(b, i)
      const f = fk(skel, q)
      for (const s of ['l', 'r'] as const) expect(dot(handFrame(skel, f, s).palm, thoraxFrame(skel, q).up)).toBeLessThan(-0.9)
    }
    for (const a of [start, end]) {
      expect(a.elev).toBeGreaterThan(80)
      expect(a.elev).toBeLessThan(95)
    }
    expect(Math.max(...series(b, 'elbow_l.flex'))).toBeLessThan(10)
    // shoulder blades set back at the finish
    expect(series(b, 'clavicle_l.prot')[at(b, TOP)]).toBeLessThan(series(b, 'clavicle_l.prot')[at(b, BOTTOM)] - 10)
    // the band's free point stays in front of the chest
    for (let i = 0; i < b.frames; i += 5) {
      const q = frameQ(b, i)
      const mid = frameImplements(b, i)[b.implements.findIndex((s) => s.id === 'band_mid')].pos
      const f = fk(skel, q)
      expect(dot(sub(mid, segPos(skel, f, 'thorax2')), thoraxFrame(skel, q).fwd)).toBeGreaterThan(0.08)
    }
  })

  it('unsupported variants throw', () => {
    const t = getTemplate('rear-raise')
    const run = (params: Record<string, unknown>, lat?: string) => () => t.setup(parseParams('rear-raise', params, lat), skel)
    expect(run({ implement: 'dumbbell' }, 'unilateral')).toThrow(/variant not implemented yet/)
    expect(run({ implement: 'cable', posture: 'lying_prone', benchAngle: 45 })).toThrow(/variant not implemented yet/)
    expect(run({ implement: 'cable', torsoAngle: 45 })).toThrow(/variant not implemented yet/)
  })
})
