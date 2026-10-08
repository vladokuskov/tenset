import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../collide.ts'
import { fk, localToWorld, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist, qconj, qrot, sub, type V3 } from '../math.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { DEFAULT_TEMPO, loopDuration } from '../timing.ts'
import { getTemplate, parseParams } from './index.ts'
import { armElevation, flareOf, forearmLean, forearmSag, forearmTilt, minClear, solidOf } from './press-body.ts'

const skel = testSkeleton()
const T = 'horizontal-press'
const variants = motionRecords(T)
const baked = new Map(variants.map((v) => [v.id, bake(getTemplate(T), parseParams(T, v.params, v.laterality), skel)]))
const get = (id: number) => baked.get(id)!
const run = (raw: Record<string, unknown>) => bake(getTemplate(T), parseParams(T, raw, 'bilateral'), skel)

const [ECC, PB, , PT] = DEFAULT_TEMPO
/** loop fractions of the lockout (mid top pause) and the touch (mid bottom pause) */
const TOP = 0
const BOTTOM = (PT / 2 + ECC + PB / 2) / loopDuration(DEFAULT_TEMPO)
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]
const pose = (b: Baked, u: number) => ({ f: fk(skel, frameQ(b, at(b, u))), impl: frameImplements(b, at(b, u)) })
const implPos = (b: Baked, u: number, id: string) => pose(b, u).impl[b.implements.findIndex((s) => s.id === id)].pos as V3
/** a point in the upper-trunk frame (x left, y up the spine, z out of the chest) */
const inThorax = (b: Baked, u: number, p: V3) => {
  const { f } = pose(b, u)
  return qrot(qconj(f.rot[skel.seg.thorax2]), sub(p, f.pos[skel.seg.thorax2]))
}
/** the frames with the elbows folded past 60 deg, where the forearm's lean and the elbow position read */
const folded = (b: Baked) => Array.from({ length: b.frames }, (_, i) => frameQ(b, i)).filter((q) => q[skel.dof['elbow_l.flex']] > 60).map((q) => fk(skel, q))

describe('horizontal-press template', () => {
  it('covers every record of the template', () => {
    expect([...baked.keys()].sort()).toEqual([101, 107, 108, 707])
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
      // only the arms move: the pelvis, the arch and the retracted, depressed scapulae hold still
      for (const n of ['pelvis.tx', 'pelvis.ty', 'pelvis.tz', 'pelvis.tilt', 'lumbar.flex', 'thorax.flex', 'clavicle_l.prot', 'clavicle_l.elev', 'neck.flex']) {
        expect(Math.abs(q[skel.dof[n]] - base[skel.dof[n]]), n).toBeLessThan(1e-6)
      }
      expect(q[skel.dof['clavicle_l.prot']]).toBeLessThan(-10)
    }
    // the loop is cut mid top pause: both sides of the seam are the same still pose
    const last = frameQ(b, b.frames - 1)
    for (let k = 0; k < b.nDof; k++) expect(Math.abs(last[k] - base[k])).toBeLessThan(0.05)
  })

  it.each([101, 107, 707])('%s: soft lockout over the shoulders, elbows folded at the touch (Madsen & McLaughlin 1984)', (id) => {
    const b = get(id)
    // lockout with soft elbows, the load over the shoulder joints
    expect(dof(b, TOP, 'elbow_l.flex')).toBeGreaterThan(2)
    expect(dof(b, TOP, 'elbow_l.flex')).toBeLessThan(10)
    const top = b.params.implement === 'dumbbell' ? implPos(b, TOP, 'db_l') : implPos(b, TOP, 'bar')
    expect(Math.abs(top[2] - segPos(skel, pose(b, TOP).f, 'humerus_l')[2])).toBeLessThan(0.02)
    // with the load on or beside the chest the elbows drop below the shoulders and fold to ~120-150 deg (the rig's
    // grip site sits mid-palm)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeGreaterThan(120)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeLessThan(150)
    const { f } = pose(b, BOTTOM)
    expect(segPos(skel, f, 'forearm_l')[1]).toBeLessThan(segPos(skel, f, 'humerus_l')[1])
  })

  it('101: the bar touches the lower chest lightly and presses back in a J to over the shoulders', () => {
    const b = get(101)
    const bottom = implPos(b, BOTTOM, 'bar')
    const top = implPos(b, TOP, 'bar')
    // touch on the lower chest, just below the nipple line
    expect(inThorax(b, BOTTOM, bottom)[1]).toBeGreaterThan(-0.08)
    expect(inThorax(b, BOTTOM, bottom)[1]).toBeLessThan(-0.02)
    const trunk = bodyCapsules(skel, pose(b, BOTTOM).f).filter((c) => c.region === 'trunk')
    const touch = minClear(trunk, placeParts(b.implements[0], pose(b, BOTTOM).impl[0])[0])
    expect(touch).toBeGreaterThan(-0.008)
    expect(touch).toBeLessThan(0.002)
    // the bar travels 10-20 cm towards the head, most of it early in the press: at half height over 60% is done
    expect(bottom[2] - top[2]).toBeGreaterThan(0.1)
    expect(bottom[2] - top[2]).toBeLessThan(0.2)
    const mid = (bottom[1] + top[1]) / 2
    let best = { dy: Infinity, z: 0 }
    for (let i = 0; i < b.frames; i++) {
      const p = frameImplements(b, i)[0].pos
      const conc = i / b.frames > BOTTOM
      if (conc && Math.abs(p[1] - mid) < best.dy) best = { dy: Math.abs(p[1] - mid), z: p[2] }
    }
    expect((best.z - top[2]) / (bottom[2] - top[2])).toBeLessThan(0.4)
  })

  it('elbow flare follows the grip: the close grip tucks, the 1.4x grip stays under ~45 deg (Green & Comfort 2007)', () => {
    const flare = (id: number) => flareOf(skel, pose(get(id), BOTTOM).f)
    expect(Math.abs(flare(707) - 20)).toBeLessThan(2)
    expect(Math.abs(flare(101) - 45)).toBeLessThan(2)
    expect(Math.abs(flare(107) - 45)).toBeLessThan(2)
    expect(get(707).params.gripWidth).toBeLessThan(get(101).params.gripWidth as number)
  })

  it.each([101, 107, 707])('%s: butt, upper back and head rest on the bench, the lumbar arch clears it', (id) => {
    const b = get(id)
    const { f, impl } = pose(b, TOP)
    const k = b.implements.findIndex((s) => s.id === 'bench')
    const seat = solidOf(b.implements[k], impl[k], 0)
    const back = solidOf(b.implements[k], impl[k], 1)
    const caps = bodyCapsules(skel, f)
    const on = (pick: (c: (typeof caps)[number]) => boolean) => Math.min(minClear(caps.filter(pick), seat), minClear(caps.filter(pick), back))
    for (const [what, pick] of [
      ['butt', (c: (typeof caps)[number]) => c.segment === 'pelvis'],
      ['upper back', (c: (typeof caps)[number]) => c.segment === 'thorax2' || c.segment === 'thorax1'],
      ['head', (c: (typeof caps)[number]) => c.region === 'head'],
    ] as const) {
      expect(on(pick), what).toBeGreaterThan(-0.015)
      expect(on(pick), what).toBeLessThan(0.002)
    }
    expect(on((c) => c.segment === 'lumbar2' || c.segment === 'lumbar3'), 'lumbar arch').toBeGreaterThan(0.02)
  })

  it.each([101, 107, 108, 707])('%s: at the bottom the upper arm stays within passive horizontal abduction (~45 deg past the chest plane)', (id) => {
    const { f } = pose(get(id), BOTTOM)
    const ua = qrot(qconj(f.rot[skel.seg.thorax2]), sub(segPos(skel, f, 'forearm_l'), segPos(skel, f, 'humerus_l')))
    const below = (Math.asin(-ua[2] / Math.hypot(...ua)) * 180) / Math.PI
    expect(below).toBeGreaterThan(25)
    // the close grip touches lower on the sternum with the elbows tucked: still inside the passive ~45 deg
    expect(below).toBeLessThan(id === 707 ? 45 : 40)
  })

  it.each([[101, 40, 36]])('%s: mid-press the elbows stay off the ribs (upper arm >= %s deg from the trunk) and the forearm leans at most %s deg', (id, elev, lean) => {
    // the frontal-only forearm hold pinned the elbows to the ribs mid-press (101: 33 deg, 707: 14) and flared them
    // back out at the touch, with the forearm leaning ~34 / 40 deg towards the head. On a J path the bar is over the
    // shoulders before the elbows are, so some lean is inherent: it is now split between the planes, the elbows open
    const b = get(id)
    const touch = armElevation(skel, pose(b, BOTTOM).f)
    for (const f of folded(b)) {
      expect(armElevation(skel, f)).toBeGreaterThan(elev)
      expect(armElevation(skel, f)).toBeGreaterThan(touch - 18)
      expect(forearmLean(skel, f)).toBeLessThan(lean)
      // the elbows never swing far out past the hands either (a fixed pole leaned the forearms in ~30 deg)
      expect(forearmTilt(skel, f)).toBeGreaterThan(-30)
    }
  })

  it('dumbbells (107) keep the forearms vertical the whole press ("forearms vertical"), elbows opening steadily', () => {
    // with the hands free sideways the forearm holds its touch lean in 3D (it leaned ~35 deg towards the head
    // mid-press with the elbows pinned at 29 deg); the dumbbells arc a little wider on the way up
    const b = get(107)
    const { f: fb, impl } = pose(b, BOTTOM)
    const k = b.implements.findIndex((s) => s.id === 'db_l')
    const [lean0, elev0] = [forearmLean(skel, fb), armElevation(skel, fb)]
    expect(lean0).toBeLessThan(15)
    for (const f of folded(b)) {
      expect(forearmLean(skel, f)).toBeLessThan(lean0 + 6)
      expect(armElevation(skel, f)).toBeGreaterThan(elev0 - 2)
    }
    for (let i = 0; i < b.frames; i++) expect(frameImplements(b, i)[k].pos[0] - impl[k].pos[0]).toBeLessThan(0.1)
  })

  it('707: close grip touches low on the sternum with the forearms stacked under the bar, then presses back in the J', () => {
    // the forearm leaned 17 deg at the touch ("stack your wrists over your elbows"); mid-press some lean is inherent
    // to the J (the bar is over the shoulders before the elbows are), as on 101
    const b = get(707)
    const bottom = implPos(b, BOTTOM, 'bar')
    const top = implPos(b, TOP, 'bar')
    expect(inThorax(b, BOTTOM, bottom)[1]).toBeGreaterThan(-0.13)
    expect(inThorax(b, BOTTOM, bottom)[1]).toBeLessThan(-0.07)
    const trunk = bodyCapsules(skel, pose(b, BOTTOM).f).filter((c) => c.region === 'trunk')
    const touch = minClear(trunk, placeParts(b.implements[0], pose(b, BOTTOM).impl[0])[0])
    expect(touch).toBeGreaterThan(-0.008)
    expect(touch).toBeLessThan(0.002)
    expect(Math.abs(forearmSag(skel, pose(b, BOTTOM).f))).toBeLessThan(6)
    // the bar sits low in the palm: the wrist extends no more than 20 deg
    expect(-dof(b, BOTTOM, 'wrist_l.flex')).toBeLessThan(20.5)
    for (const f of folded(b)) {
      expect(forearmLean(skel, f)).toBeLessThan(38)
      // elbows tucked near the sides, off the ribs (the rejected hold had 14 deg), not far out past the hands
      expect(armElevation(skel, f)).toBeGreaterThan(18)
      expect(forearmTilt(skel, f)).toBeGreaterThan(-20)
    }
    expect(bottom[2] - top[2]).toBeGreaterThan(0.1)
  })

  it.each([101, 707])('%s: the bar comes down on a straight diagonal (half the horizontal travel at half height)', (id) => {
    const b = get(id)
    const bottom = implPos(b, BOTTOM, 'bar')
    const top = implPos(b, TOP, 'bar')
    const mid = (bottom[1] + top[1]) / 2
    let best = { dy: Infinity, z: 0 }
    for (let i = 0; i < b.frames; i++) {
      const p = frameImplements(b, i)[0].pos
      if (i / b.frames < BOTTOM && Math.abs(p[1] - mid) < best.dy) best = { dy: Math.abs(p[1] - mid), z: p[2] }
    }
    const done = (best.z - top[2]) / (bottom[2] - top[2])
    expect(done).toBeGreaterThan(0.4)
    expect(done).toBeLessThan(0.6)
  })

  it('dumbbells (107) clear the chest at the bottom, never touch each other, and finish close over the shoulders', () => {
    const b = get(107)
    const ks = ['db_l', 'db_r'].map((id) => b.implements.findIndex((s) => s.id === id))
    const { f, impl } = pose(b, BOTTOM)
    const trunk = bodyCapsules(skel, f).filter((c) => c.region === 'trunk')
    for (const k of ks) for (const s of placeParts(b.implements[k], impl[k])) expect(minClear(trunk, s)).toBeGreaterThan(0.005)
    let closest = Infinity
    for (let i = 0; i < b.frames; i++) {
      const im = frameImplements(b, i)
      closest = Math.min(closest, dist(im[ks[0]].pos as V3, im[ks[1]].pos as V3))
    }
    // handles converge to ~35 cm apart at lockout (inner heads a few cm apart), never closer
    expect(closest).toBeGreaterThan(0.3)
    expect(closest).toBeLessThan(0.4)
  })

  it('chest press machine (108): seated on a reclined pad, handles level with mid-chest from a stretch to soft elbows', () => {
    const b = get(108)
    expect(dof(b, TOP, 'elbow_l.flex')).toBeGreaterThan(2)
    expect(dof(b, TOP, 'elbow_l.flex')).toBeLessThan(10)
    const grip = (u: number) => sitePos(skel, pose(b, u).f, 'grip_l')
    const chest = (u: number) => localToWorld(skel, pose(b, u).f, 'thorax2', [0, -0.05, 0.12])
    const front = Math.max(...bodyCapsules(skel, pose(b, BOTTOM).f).filter((c) => c.segment === 'thorax2').map((c) => Math.max(c.a[2], c.b[2]) + c.r))
    // hands start level with the front of the chest and push ~45 cm forward, level with it at both ends
    expect(Math.abs(grip(BOTTOM)[2] - front)).toBeLessThan(0.02)
    expect(grip(TOP)[2] - grip(BOTTOM)[2]).toBeGreaterThan(0.4)
    for (const u of [TOP, BOTTOM]) expect(Math.abs(grip(u)[1] - chest(u)[1])).toBeLessThan(0.05)
    // back and head up against the pad, trunk reclined ~10 deg
    const k = b.implements.findIndex((s) => s.id === 'machine')
    const { f, impl } = pose(b, TOP)
    const back = solidOf(b.implements[k], impl[k], 1)
    const caps = bodyCapsules(skel, f)
    expect(minClear(caps.filter((c) => c.segment === 'thorax2'), back)).toBeLessThan(0.002)
    expect(minClear(caps.filter((c) => c.segment === 'thorax2'), back)).toBeGreaterThan(-0.015)
    const up = sub(segPos(skel, f, 'neck1'), segPos(skel, f, 'lumbar1'))
    const lean = (Math.atan2(-up[2], up[1]) * 180) / Math.PI
    expect(lean).toBeGreaterThan(3)
    expect(lean).toBeLessThan(20)
  })

  it('unsupported variants throw with a reason', () => {
    expect(() => run({ benchAngle: -15 })).toThrow(/variant not implemented yet/)
    expect(() => run({ benchAngle: 5 })).toThrow(/variant not implemented yet/)
    expect(() => run({ implement: 'dumbbell', grip: 'neutral' })).toThrow(/variant not implemented yet/)
    expect(() => run({ implement: 'machine', posture: 'lying_supine' })).toThrow(/variant not implemented yet/)
    expect(() => bake(getTemplate(T), parseParams(T, {}, 'unilateral'), skel)).toThrow(/variant not implemented yet/)
  })

  it('dumbbells and machine never touch the body beyond soft contact', () => {
    for (const id of [107, 108]) {
      const b = get(id)
      let worst = Infinity
      for (let i = 0; i < b.frames; i += 3) {
        const caps = bodyCapsules(skel, fk(skel, frameQ(b, i)))
        const impl = frameImplements(b, i)
        b.implements.forEach((spec, k) => {
          if (spec.kind !== 'dumbbell' && spec.kind !== 'press_arms') return
          for (const s of placeParts(spec, impl[k])) for (const c of caps) if (!c.region.startsWith('hand')) worst = Math.min(worst, capsuleSolidClearance(c, s))
        })
      }
      expect(worst, String(id)).toBeGreaterThan(-0.003)
    }
  })
})
