import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, placeParts } from '../collide.ts'
import { fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist, qconj, qrot, sub, type V3 } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { DEFAULT_TEMPO, loopDuration } from '../timing.ts'
import { getTemplate, parseParams } from './index.ts'
import { armElevation, flareOf, forearmLean, forearmTilt, minClear, solidOf } from './press-body.ts'

const skel = testSkeleton()
const T = 'incline-press'
const variants = motionRecords(T)
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate(T), parseParams(T, v.params, v.laterality), skel)]))
const get = (id: number) => baked.get(id)!
const run = (raw: Record<string, unknown>, laterality = 'bilateral') => bake(getTemplate(T), parseParams(T, raw, laterality), skel)
/** the flat barbell bench, for comparison */
const flat = bake(getTemplate('horizontal-press'), parseParams('horizontal-press', { implement: 'barbell', gripWidth: 1.4, elbowFlare: 45 }, 'bilateral'), skel)

const [ECC, PB, , PT] = DEFAULT_TEMPO
const TOP = 0
const BOTTOM = (PT / 2 + ECC + PB / 2) / loopDuration(DEFAULT_TEMPO)
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]
const pose = (b: Baked, u: number) => ({ f: fk(skel, frameQ(b, at(b, u))), impl: frameImplements(b, at(b, u)) })
const implPos = (b: Baked, u: number, id: string) => pose(b, u).impl[b.implements.findIndex((s) => s.id === id)].pos as V3
const inThorax = (b: Baked, u: number, p: V3) => {
  const { f } = pose(b, u)
  return qrot(qconj(f.rot[skel.seg.thorax2]), sub(p, f.pos[skel.seg.thorax2]))
}
/** the frames with the elbows folded past 60 deg, where the forearm's lean and the elbow position read */
const folded = (b: Baked) => Array.from({ length: b.frames }, (_, i) => frameQ(b, i)).filter((q) => q[skel.dof['elbow_l.flex']] > 60).map((q) => fk(skel, q))
const load = (b: Baked) => (b.params.implement === 'dumbbell' ? 'db_l' : 'bar')

describe('incline-press template', () => {
  it('covers every record of the template', () => {
    expect([...baked.keys()].sort()).toEqual([102, 103, 109])
  })

  it.each(variants.map((v) => v.id))('%s: finite, feet planted, hands on the implement, body still, seamless loop', (id) => {
    const b = get(id)
    expect(b.q.every(Number.isFinite)).toBe(true)
    const base = frameQ(b, 0)
    for (let i = 0; i < b.frames; i++) {
      const q = frameQ(b, i)
      const f = fk(skel, q)
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        if ('world' in c.target) expect(dist(sitePos(skel, f, c.site), c.target.world)).toBeLessThan(0.002)
        else {
          const { implement, grip } = c.target
          const k = b.implements.findIndex((s) => s.id === implement)
          expect(dist(sitePos(skel, f, c.site), siteWorld(b.implements[k], impl[k], grip).pos)).toBeLessThan(0.005)
        }
      }
      for (const n of ['pelvis.tx', 'pelvis.ty', 'pelvis.tz', 'pelvis.tilt', 'lumbar.flex', 'thorax.flex', 'clavicle_l.prot', 'neck.flex']) {
        expect(Math.abs(q[skel.dof[n]] - base[skel.dof[n]]), n).toBeLessThan(1e-6)
      }
      expect(q[skel.dof['clavicle_l.prot']]).toBeLessThan(-10)
    }
    const last = frameQ(b, b.frames - 1)
    for (let k = 0; k < b.nDof; k++) expect(Math.abs(last[k] - base[k])).toBeLessThan(0.05)
    // soft lockout; elbows folded at the touch as on the flat bench
    expect(dof(b, TOP, 'elbow_l.flex')).toBeGreaterThan(2)
    expect(dof(b, TOP, 'elbow_l.flex')).toBeLessThan(10)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeGreaterThan(120)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeLessThan(152)
  })

  it.each(variants.map((v) => v.id))('%s: reclined at the bench angle, butt on the seat, upper back and head on the pad', (id) => {
    const b = get(id)
    expect(b.params.benchAngle).toBe(30)
    const { f, impl } = pose(b, TOP)
    const k = b.implements.findIndex((s) => s.id === 'bench')
    const seat = solidOf(b.implements[k], impl[k], 0)
    const back = solidOf(b.implements[k], impl[k], 1)
    const caps = bodyCapsules(skel, f)
    const butt = minClear(caps.filter((c) => c.segment === 'pelvis'), seat)
    const upper = minClear(caps.filter((c) => c.segment === 'thorax2'), back)
    const head = minClear(caps.filter((c) => c.region === 'head'), back)
    for (const [what, v] of [['butt', butt], ['upper back', upper], ['head', head]] as const) {
      expect(v, what).toBeGreaterThan(-0.015)
      expect(v, what).toBeLessThan(0.002)
    }
    // the upper trunk lies along the pad: ~30 deg plus a little thoracic extension
    const up = sub(segPos(skel, f, 'neck1'), segPos(skel, f, 'thorax1'))
    const incline = (Math.atan2(up[1], -up[2]) * 180) / Math.PI
    expect(incline).toBeGreaterThan(25)
    expect(incline).toBeLessThan(45)
  })

  it('the touch point moves up the chest towards the clavicles on the incline (Rodriguez-Ridao 2020)', () => {
    const y = (b: Baked, id: string) => inThorax(b, BOTTOM, implPos(b, BOTTOM, id))[1]
    expect(y(get(103), 'bar') - y(flat, 'bar')).toBeGreaterThan(0.06)
    expect(y(get(109), 'bar') - y(flat, 'bar')).toBeGreaterThan(0.06)
    // upper chest: above the nipple line, below the clavicles
    expect(y(get(103), 'bar')).toBeGreaterThan(0)
    expect(y(get(103), 'bar')).toBeLessThan(0.1)
    // a light touch: the bar rests on the chest without sinking in
    for (const id of [103, 109]) {
      const b = get(id)
      const trunk = bodyCapsules(skel, pose(b, BOTTOM).f).filter((c) => c.region === 'trunk')
      const k = b.implements.findIndex((s) => s.id === 'bar')
      const touch = minClear(trunk, placeParts(b.implements[k], pose(b, BOTTOM).impl[k])[0])
      expect(touch, String(id)).toBeGreaterThan(-0.008)
      expect(touch, String(id)).toBeLessThan(0.002)
    }
  })

  it('free weights lock out over the shoulders with a flatter J; the Smith bar stays on its vertical rail', () => {
    for (const id of [102, 103]) {
      const b = get(id)
      const top = implPos(b, TOP, load(b))
      expect(Math.abs(top[2] - segPos(skel, pose(b, TOP).f, 'humerus_l')[2]), String(id)).toBeLessThan(0.02)
    }
    const flatTravel = implPos(flat, BOTTOM, 'bar')[2] - implPos(flat, TOP, 'bar')[2]
    const b = get(103)
    expect(implPos(b, BOTTOM, 'bar')[2] - implPos(b, TOP, 'bar')[2]).toBeLessThan(flatTravel)
    const smith = get(109)
    const k = smith.implements.findIndex((s) => s.id === 'bar')
    const z0 = frameImplements(smith, 0)[k].pos[2]
    for (let i = 0; i < smith.frames; i++) {
      const p = frameImplements(smith, i)[k].pos
      expect(Math.abs(p[0])).toBeLessThan(1e-6)
      expect(Math.abs(p[2] - z0)).toBeLessThan(0.001)
    }
  })

  it('barbell and Smith flare the elbows to ~38 deg at the 1.4x grip, dumbbells to 40 (under 45: Green & Comfort 2007)', () => {
    for (const [id, want] of [[103, 38], [109, 38], [102, 40]] as const) expect(Math.abs(flareOf(skel, pose(get(id), BOTTOM).f) - want), String(id)).toBeLessThan(2)
  })

  it.each([
    [103, 37, 38],
    [109, 36, 32],
  ])('%s: mid-press the elbows stay off the ribs (upper arm >= %s deg from the trunk) and the forearm leans at most %s deg', (id, elev, lean) => {
    // the frontal-only forearm hold pinned the elbows (103: 34.5 deg) with the forearm leaning ~35 deg towards the
    // head; a J (103) or the fixed rail (109) keeps some lean, now split between the planes
    const b = get(id)
    for (const f of folded(b)) {
      expect(armElevation(skel, f)).toBeGreaterThan(elev)
      expect(forearmLean(skel, f)).toBeLessThan(lean)
      expect(forearmTilt(skel, f)).toBeGreaterThan(-28)
    }
  })

  it('dumbbells (102) keep the forearms at their touch lean the whole press, elbows opening steadily', () => {
    // the forearm leaned ~38 deg towards the head mid-press (dumbbells beside the face) with the elbows at 35 deg
    const b = get(102)
    const { f: fb, impl } = pose(b, BOTTOM)
    const k = b.implements.findIndex((s) => s.id === 'db_l')
    const [lean0, elev0] = [forearmLean(skel, fb), armElevation(skel, fb)]
    expect(lean0).toBeLessThan(21)
    for (const f of folded(b)) {
      expect(forearmLean(skel, f)).toBeLessThan(lean0 + 6)
      expect(armElevation(skel, f)).toBeGreaterThan(elev0 - 2)
    }
    for (let i = 0; i < b.frames; i++) expect(frameImplements(b, i)[k].pos[0] - impl[k].pos[0]).toBeLessThan(0.1)
  })

  it('dumbbells (102) clear the chest at the bottom and converge over the shoulders without touching', () => {
    const b = get(102)
    const ks = ['db_l', 'db_r'].map((id) => b.implements.findIndex((s) => s.id === id))
    const { f, impl } = pose(b, BOTTOM)
    const trunk = bodyCapsules(skel, f).filter((c) => c.region === 'trunk')
    for (const k of ks) for (const s of placeParts(b.implements[k], impl[k])) expect(minClear(trunk, s)).toBeGreaterThan(0.005)
    let closest = Infinity
    for (let i = 0; i < b.frames; i++) {
      const im = frameImplements(b, i)
      closest = Math.min(closest, dist(im[ks[0]].pos as V3, im[ks[1]].pos as V3))
    }
    expect(closest).toBeGreaterThan(0.3)
    expect(closest).toBeLessThan(0.4)
  })

  it('unsupported variants throw with a reason', () => {
    expect(() => run({ implement: 'dumbbell', grip: 'neutral' })).toThrow(/variant not implemented yet/)
    expect(() => run({ implement: 'machine' })).toThrow(/variant not implemented yet/)
    expect(() => run({ posture: 'seated' })).toThrow(/variant not implemented yet/)
    expect(() => run({}, 'unilateral')).toThrow(/variant not implemented yet/)
  })
})
