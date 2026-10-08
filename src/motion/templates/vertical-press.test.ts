import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../collide.ts'
import { centerOfMass, fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist } from '../math.ts'
import type { Skeleton } from '../skeleton.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { SCHEMAS } from './schemas.ts'
import type { AnyTemplate } from './types.ts'
import { verticalPress } from './vertical-press.ts'

const skel: Skeleton = testSkeleton()
const t = verticalPress as unknown as AnyTemplate
const parse = (raw: Record<string, unknown>, laterality = 'bilateral') => SCHEMAS['vertical-press'].parse({ ...raw, laterality })
const variants = motionRecords('vertical-press')
const baked = new Map(variants.map((v) => [v.slug, bake(t, parse(v.params, v.laterality), skel)]))
const get = (id: number) => [...baked].find(([slug]) => slug.startsWith(`${id}-`))![1]
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]
/** lockout (top pause) and the bottom pause of the default tempo */
const TOP = 0, BOTTOM = 0.635

describe('vertical-press template', () => {
  it('covers every record of the template', () => {
    expect(variants.map((v) => v.id).sort()).toEqual([201, 202, 208, 212, 217, 221])
  })

  it.each([...baked.keys()])('%s: elbow and arm elevation inside the research ranges at both ends', (slug) => {
    const b = baked.get(slug)!
    // top: arms (nearly) locked overhead; machines stop a little short, the Smith locks out a little in front of the head
    expect(dof(b, TOP, 'elbow_l.flex')).toBeLessThan(b.params.implement === 'machine' ? 14 : 10)
    expect(dof(b, TOP, 'shoulder_l.elev')).toBeGreaterThan(({ machine: 150, smith: 155 } as Record<string, number>)[b.params.implement as string] ?? 165)
    // bottom: humeral elevation ~35-75, elbow ~95-145 (the rig's elbow stops at 150)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeGreaterThan(95)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeLessThan(146)
    expect(dof(b, BOTTOM, 'shoulder_l.elev')).toBeGreaterThan(30)
    expect(dof(b, BOTTOM, 'shoulder_l.elev')).toBeLessThan(80)
  })

  it.each([...baked.keys()])('%s: hands on the load and feet planted every frame, finite, seamless loop', (slug) => {
    const b = baked.get(slug)!
    expect(b.q.every(Number.isFinite)).toBe(true)
    for (let i = 0; i < b.frames; i++) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        const target = 'world' in c.target ? c.target.world : (() => {
          const { implement, grip } = c.target
          const k = b.implements.findIndex((s) => s.id === implement)
          return siteWorld(b.implements[k], impl[k], grip).pos
        })()
        expect(dist(sitePos(skel, f, c.site), target), `${c.site} @${i}`).toBeLessThan(0.005)
      }
    }
    const first = frameQ(b, 0), last = frameQ(b, b.frames - 1)
    for (const d of skel.dofs) expect(Math.abs(first[d.index] - last[d.index]), d.name).toBeLessThan(d.unit === 'm' ? 0.002 : 1)
  })

  it('barbell: vertical line in front of the face, back over the midfoot at lockout, the head clearing it', () => {
    const b = get(201)
    const k = b.implements.findIndex((s) => s.kind === 'barbell')
    const bar = (u: number) => frameImplements(b, at(b, u))[k].pos
    const mid = (sitePos(skel, fk(skel, frameQ(b, 0)), 'midfoot_l')[2] + sitePos(skel, fk(skel, frameQ(b, 0)), 'midfoot_r')[2]) / 2
    expect(Math.abs(bar(TOP)[2] - mid)).toBeLessThan(0.01)
    expect(bar(BOTTOM)[2] - mid).toBeGreaterThan(0.02)
    expect(bar(BOTTOM)[2] - mid).toBeLessThan(0.12)
    let head = Infinity
    for (let i = 0; i < b.frames; i++) {
      const p = frameImplements(b, i)[k]
      expect(Math.abs(p.pos[0])).toBeLessThan(1e-6)
      const caps = bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => c.region === 'head' || c.region === 'neck')
      for (const c of caps) head = Math.min(head, capsuleSolidClearance(c, placeParts(b.implements[k], p)[0]))
      // system centre of mass over the midfoot (the balance gate's 2.5 cm)
      expect(Math.abs(centerOfMass(skel, fk(skel, frameQ(b, i)), [{ mass: b.implements[k].mass, pos: p.pos }])[2] - mid)).toBeLessThan(0.025)
    }
    expect(head).toBeGreaterThan(0.015)
    // head back (chin in) while the bar passes the face, through under the bar at lockout
    expect(dof(b, BOTTOM, 'neck.flex')).toBeLessThan(-10)
    expect(dof(b, TOP, 'neck.flex')).toBeGreaterThan(5)
    // a little lean back at the bottom, near upright at lockout
    const lean = (u: number) => dof(b, u, 'pelvis.tilt') + dof(b, u, 'lumbar.flex') + dof(b, u, 'thorax.flex')
    expect(lean(BOTTOM)).toBeLessThan(lean(TOP) - 3)
  })

  it('Smith: the bar rides one vertical rail line', () => {
    const b = get(212)
    const k = b.implements.findIndex((s) => s.kind === 'barbell')
    const z0 = frameImplements(b, 0)[k].pos[2]
    for (let i = 0; i < b.frames; i++) {
      const p = frameImplements(b, i)[k].pos
      expect(Math.abs(p[0])).toBeLessThan(1e-6)
      expect(Math.abs(p[2] - z0)).toBeLessThan(1e-4)
    }
    expect(b.balance).toBeUndefined()
  })

  it('seated dumbbells press from ear level to overhead with the hands closing in; the machine rides its arc', () => {
    const db = get(202)
    const x = (u: number) => frameImplements(db, at(db, u)).find((p) => p.id === 'db_l')!.pos[0]
    expect(x(BOTTOM)).toBeGreaterThan(x(TOP) + 0.15)
    const m = get(208)
    const k = m.implements.findIndex((s) => s.kind === 'press_handles')
    const y = (u: number) => frameImplements(m, at(m, u))[k].pos[1]
    expect(y(TOP) - y(BOTTOM)).toBeGreaterThan(0.3)
  })

  it('standing dumbbells (217): ear level to overhead, hands closing in, body and dumbbells balanced over the midfoot', () => {
    const b = get(217)
    const ks = ['db_l', 'db_r'].map((id) => b.implements.findIndex((s) => s.id === id))
    const x = (u: number) => frameImplements(b, at(b, u))[ks[0]].pos[0]
    expect(x(BOTTOM)).toBeGreaterThan(x(TOP) + 0.15)
    const f0 = fk(skel, frameQ(b, 0))
    const mid = (sitePos(skel, f0, 'midfoot_l')[2] + sitePos(skel, f0, 'midfoot_r')[2]) / 2
    for (let i = 0; i < b.frames; i++) {
      const im = frameImplements(b, i)
      const load = ks.map((k) => ({ mass: b.implements[k].mass, pos: im[k].pos }))
      expect(Math.abs(centerOfMass(skel, fk(skel, frameQ(b, i)), load)[2] - mid)).toBeLessThan(0.025)
    }
    // ribs down: the trunk stays within a few degrees of upright, no lay-back
    const lean = (u: number) => dof(b, u, 'pelvis.tilt') + dof(b, u, 'lumbar.flex') + dof(b, u, 'thorax.flex')
    for (const u of [TOP, BOTTOM]) expect(Math.abs(lean(u))).toBeLessThan(6)
    expect(b.balance).toBeDefined()
  })

  it('seated barbell (221): body still on the bench, bar on a vertical line from below the chin to over the shoulders, the head clearing it', () => {
    const b = get(221)
    const k = b.implements.findIndex((s) => s.kind === 'barbell')
    const bar = (u: number) => frameImplements(b, at(b, u))[k].pos
    const fTop = fk(skel, frameQ(b, at(b, TOP)))
    expect(Math.abs(bar(TOP)[2] - segPos(skel, fTop, 'humerus_l')[2])).toBeLessThan(0.02)
    expect(bar(BOTTOM)[2] - bar(TOP)[2]).toBeGreaterThan(0.03)
    expect(bar(BOTTOM)[1]).toBeLessThan(sitePos(skel, fk(skel, frameQ(b, at(b, BOTTOM))), 'chin')[1])
    const base = frameQ(b, 0)
    let head = Infinity
    for (let i = 0; i < b.frames; i++) {
      const q = frameQ(b, i)
      for (const n of ['pelvis.tx', 'pelvis.ty', 'pelvis.tz', 'pelvis.tilt', 'lumbar.flex', 'thorax.flex']) expect(Math.abs(q[skel.dof[n]] - base[skel.dof[n]]), n).toBeLessThan(1e-6)
      const p = frameImplements(b, i)[k]
      expect(Math.abs(p.pos[0])).toBeLessThan(1e-6)
      const caps = bodyCapsules(skel, fk(skel, q)).filter((c) => c.region === 'head' || c.region === 'neck')
      for (const c of caps) head = Math.min(head, capsuleSolidClearance(c, placeParts(b.implements[k], p)[0]))
    }
    expect(head).toBeGreaterThan(0.015)
    expect(dof(b, BOTTOM, 'neck.flex')).toBeLessThan(-10)
    expect(dof(b, TOP, 'neck.flex')).toBeGreaterThan(5)
  })

  it('unsupported variants throw', () => {
    expect(() => bake(t, parse({ implement: 'smith', posture: 'seated' }), skel)).toThrow(/variant not implemented yet/)
    expect(() => bake(t, parse({ implement: 'barbell', posture: 'standing' }, 'alternating'), skel)).toThrow(/variant not implemented yet/)
  })
})
