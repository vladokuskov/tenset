import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts, segmentDistance, solidClearance } from '../collide.ts'
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
    expect([...baked.keys()].sort()).toEqual([101, 107, 108, 116, 117, 118, 119, 120, 121, 124, 128, 135, 707])
  })

  it.each(variants.filter((v) => v.params.posture !== 'standing').map((v) => v.id))('%s: finite, feet planted, hands on the implement, body still, seamless loop', (id) => {
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

  it.each([101, 107, 121, 707])('%s: soft lockout over the shoulders, elbows folded at the touch (Madsen & McLaughlin 1984)', (id) => {
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

  it.each([[107, 0.1], [121, 0.12]])('dumbbells (%s) keep the forearms vertical the whole press ("forearms vertical"), elbows opening steadily', (id, wider) => {
    // with the hands free sideways the forearm holds its touch lean in 3D (it leaned ~35 deg towards the head
    // mid-press with the elbows pinned at 29 deg); the dumbbells arc a little wider on the way up. Neutral handles
    // (121) sit over the elbows at the touch: on the bar's path they leaned ~45 deg with the elbows out past them
    const b = get(id)
    const { f: fb, impl } = pose(b, BOTTOM)
    const k = b.implements.findIndex((s) => s.id === 'db_l')
    const [lean0, elev0] = [forearmLean(skel, fb), armElevation(skel, fb)]
    expect(lean0).toBeLessThan(15)
    for (const f of folded(b)) {
      expect(forearmLean(skel, f)).toBeLessThan(Math.min(20, lean0 + 6))
      expect(forearmTilt(skel, f)).toBeGreaterThan(-20)
      expect(armElevation(skel, f)).toBeGreaterThan(elev0 - 2)
    }
    for (let i = 0; i < b.frames; i++) expect(frameImplements(b, i)[k].pos[0] - impl[k].pos[0]).toBeLessThan(wider)
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

  it('Smith (120): the bar runs straight up and down its rails over the lower chest, soft lockout, elbows folded at the touch', () => {
    const b = get(120)
    const top = implPos(b, TOP, 'bar'), bottom = implPos(b, BOTTOM, 'bar')
    for (let i = 0; i < b.frames; i++) {
      const p = frameImplements(b, i)[0].pos
      expect(Math.abs(p[0])).toBeLessThan(1e-9)
      expect(Math.abs(p[2] - bottom[2])).toBeLessThan(1e-9)
    }
    expect(top[1] - bottom[1]).toBeGreaterThan(0.3)
    expect(inThorax(b, BOTTOM, bottom)[1]).toBeLessThan(0)
    expect(dof(b, TOP, 'elbow_l.flex')).toBeGreaterThan(2)
    expect(dof(b, TOP, 'elbow_l.flex')).toBeLessThan(10)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeGreaterThan(110)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeLessThan(150)
  })

  it('neutral-grip dumbbells (121): handles along the torso, palms facing, elbows nearer the sides than on 107', () => {
    const b = get(121)
    const k = b.implements.findIndex((s) => s.id === 'db_l')
    for (const u of [TOP, BOTTOM]) {
      const { f, impl } = pose(b, u)
      const along = qrot(impl[k].rot, b.implements[k].sites.c.axis!)
      const up = qrot(f.rot[skel.seg.thorax2], [0, 1, 0])
      expect(Math.abs(along[0] * up[0] + along[1] * up[1] + along[2] * up[2])).toBeGreaterThan(0.9)
    }
    expect(flareOf(skel, pose(b, BOTTOM).f)).toBeLessThan(flareOf(skel, pose(get(107), BOTTOM).f))
  })

  it.each([[118, 45], [119, 40]])('floor press (%s): lying on the floor, the upper arms stop on it at ~%s deg out with the forearms vertical', (id, flare) => {
    const b = get(id)
    const { f } = pose(b, BOTTOM)
    const caps = bodyCapsules(skel, f)
    const low = (re: RegExp) => Math.min(...caps.filter((c) => re.test(c.region)).map((c) => Math.min(c.a[1], c.b[1]) - c.r))
    // the back and the upper arm on the floor (a few mm of soft tissue), no bench
    expect(b.implements.some((s) => s.kind === 'bench')).toBe(false)
    expect(low(/^trunk$/)).toBeGreaterThan(-0.005)
    expect(low(/^trunk$/)).toBeLessThan(0.002)
    expect(low(/^upperarm_l$/)).toBeGreaterThan(-0.005)
    expect(low(/^upperarm_l$/)).toBeLessThan(0.002)
    expect(Math.abs(flareOf(skel, f) - flare)).toBeLessThan(2)
    expect(Math.abs(forearmTilt(skel, f))).toBeLessThan(3)
    expect(Math.abs(forearmSag(skel, f))).toBeLessThan(3)
    // the elbow about square at the bottom (forearm vertical over a level upper arm), soft at lockout
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeGreaterThan(75)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeLessThan(105)
    expect(dof(b, TOP, 'elbow_l.flex')).toBeLessThan(10)
    // knees up, feet flat
    expect(dof(b, BOTTOM, 'knee_l.flex')).toBeGreaterThan(85)
  })

  it('kettlebell floor press (119): the bell rests on the back of the forearm the whole rep, the hand through the window', () => {
    const b = get(119)
    const k = b.implements.findIndex((s) => s.id === 'kb_l')
    for (let i = 0; i < b.frames; i += 5) {
      const caps = bodyCapsules(skel, fk(skel, frameQ(b, i))).filter((c) => c.region === 'forearm_l' || c.region === 'hand_l')
      const bell = placeParts({ ...b.implements[k], parts: b.implements[k].parts.filter((p) => p.shape === 'cylinder' && p.r > 0.03) }, frameImplements(b, i)[k])
      const touch = Math.min(...bell.flatMap((s) => caps.map((c) => capsuleSolidClearance(c, s))))
      expect(touch, `@${i}`).toBeGreaterThan(-0.006)
      expect(touch, `@${i}`).toBeLessThan(0.001)
    }
  })

  it('squeeze press (135): the dumbbells pressed together side by side all rep, lowered onto the chest', () => {
    const b = get(135)
    const [l, r] = ['db_l', 'db_r'].map((id) => b.implements.findIndex((s) => s.id === id))
    for (let i = 0; i < b.frames; i += 4) {
      const impl = frameImplements(b, i)
      const [a, c] = [placeParts(b.implements[l], impl[l]), placeParts(b.implements[r], impl[r])]
      const gap = Math.min(...a.flatMap((x) => c.map((y) => solidClearance(x, y))))
      expect(gap, `@${i}`).toBeGreaterThan(-0.003)
      expect(gap, `@${i}`).toBeLessThan(0.004)
    }
    // the heads on the chest at the bottom
    const { f, impl } = pose(b, BOTTOM)
    const trunk = bodyCapsules(skel, f).filter((c) => c.region === 'trunk')
    const onChest = Math.min(...placeParts(b.implements[l], impl[l]).flatMap((s) => trunk.map((c) => capsuleSolidClearance(c, s))))
    expect(onChest).toBeLessThan(0.002)
    expect(onChest).toBeGreaterThan(-0.008)
    expect(dof(b, TOP, 'elbow_l.flex')).toBeLessThan(10)
  })

  it.each([124, 128])('standing press (%s): split stance held still, the hands from beside the chest to together in front at chest height', (id) => {
    const b = get(id)
    const base = frameQ(b, 0)
    for (let i = 0; i < b.frames; i++) {
      const q = frameQ(b, i)
      for (const n of ['pelvis.tx', 'pelvis.ty', 'pelvis.tz', 'pelvis.tilt']) expect(Math.abs(q[skel.dof[n]] - base[skel.dof[n]]), n).toBeLessThan(1e-6)
    }
    const hands = (u: number) => {
      const { f } = pose(b, u)
      return { l: sitePos(skel, f, 'grip_l'), r: sitePos(skel, f, 'grip_r'), chest: localToWorld(skel, f, 'thorax2', [0, 0, 0.1]) }
    }
    const top = hands(TOP), bottom = hands(BOTTOM)
    // lockout: hands together (~17 cm apart) in front at about chest height; the stretch: beside the chest, elbows back
    expect(dist(top.l, top.r)).toBeGreaterThan(0.13)
    expect(dist(top.l, top.r)).toBeLessThan(0.21)
    expect(top.l[2] - top.chest[2]).toBeGreaterThan(0.35)
    expect(Math.abs(top.l[1] - top.chest[1])).toBeLessThan(0.12)
    // (the reference point sits 10 cm out from the spine, ~12 cm inside the chest's front)
    expect(bottom.l[2] - bottom.chest[2]).toBeLessThan(0.3)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeGreaterThan(100)
    expect(dof(b, TOP, 'elbow_l.flex')).toBeLessThan(10)
    expect(segPos(skel, pose(b, BOTTOM).f, 'forearm_l')[2]).toBeLessThan(sitePos(skel, pose(b, BOTTOM).f, 'grip_l')[2])
    // a press, not a fly: the hands travel on a straight level line (never above the shoulders), at the bottom no more
    // than ~10 cm outside the shoulder joints, the upper arms ~45-60 deg out from the trunk
    const sh = segPos(skel, pose(b, BOTTOM).f, 'humerus_l')
    expect(bottom.l[0] - sh[0]).toBeLessThan(0.1)
    for (let i = 0; i < b.frames; i++) {
      const g = fk(skel, frameQ(b, i))
      const h = sitePos(skel, g, 'grip_l')
      expect(Math.abs(h[1] - top.l[1]), `level @${i}`).toBeLessThan(0.02)
      expect(h[1], `below the shoulder @${i}`).toBeLessThan(segPos(skel, g, 'humerus_l')[1] - 0.05)
    }
    expect(armElevation(skel, pose(b, BOTTOM).f)).toBeGreaterThan(40)
    expect(armElevation(skel, pose(b, BOTTOM).f)).toBeLessThan(62)
  })

  it('cable press (124) pulls from two towers behind; the band press (128) runs from a post behind, past the chest', () => {
    const cb = get(124)
    expect(cb.cables?.length).toBe(2)
    // the pulleys ~0.4-0.6 m behind the shoulders, so at the bottom the cables pull mostly back, not out to the side
    const g = fk(skel, frameQ(cb, at(cb, BOTTOM)))
    for (const c of cb.cables!) {
      expect(c.pulley[2] - segPos(skel, g, 'humerus_l')[2]).toBeLessThan(-0.4)
      expect(c.pulley[2] - segPos(skel, g, 'humerus_l')[2]).toBeGreaterThan(-0.65)
      const h = sitePos(skel, g, c.pulley[0] > 0 ? 'grip_l' : 'grip_r')
      expect(Math.abs(c.pulley[0] - h[0])).toBeLessThan(Math.abs(c.pulley[2] - h[2]))
    }
    const b = get(128)
    expect(b.cables).toBeUndefined()
    const anchor = b.implements.find((s) => s.kind === 'band_anchor')!
    expect(frameImplements(b, 0)[b.implements.indexOf(anchor)].pos[2]).toBeLessThan(-0.5)
    // the strip passes the side of the chest outside the trunk
    const { f, impl } = pose(b, TOP)
    const side = impl[b.implements.findIndex((s) => s.id === 'side_l')].pos as V3
    const trunk = bodyCapsules(skel, f).filter((c) => c.region === 'trunk')
    expect(Math.min(...trunk.map((c) => segmentDistance(c.a, c.b, side, side).d - c.r))).toBeGreaterThan(0)
    // every run of the strip from the ring past the arm to the hook keeps off the arm's capsules, every frame
    for (let i = 0; i < b.frames; i++) {
      const g = fk(skel, frameQ(b, i))
      const im = frameImplements(b, i)
      const at_ = (id: string) => im[b.implements.findIndex((x) => x.id === id)].pos as V3
      for (const s of ['l', 'r']) {
        const ring = siteWorld(b.implements.find((x) => x.id === `handle_${s}`)!, im[b.implements.findIndex((x) => x.id === `handle_${s}`)], 'ring').pos
        const hook = siteWorld(anchor, im[b.implements.indexOf(anchor)], 'hook').pos
        const pts = [ring, at_(`arm_${s}`), at_(`side_${s}`), hook]
        const arm = bodyCapsules(skel, g).filter((c) => c.region === `upperarm_${s}` || c.region === `forearm_${s}`)
        for (let k = 0; k + 1 < pts.length; k++) {
          expect(Math.min(...arm.map((c) => segmentDistance(c.a, c.b, pts[k], pts[k + 1]).d - c.r)), `${s} run ${k} @${i}`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('unsupported variants throw with a reason', () => {
    expect(() => run({ implement: 'kettlebell' })).toThrow(/variant not implemented yet/)
    expect(() => run({ implement: 'barbell', support: 'floor' })).toThrow(/variant not implemented yet/)
    expect(() => run({ implement: 'dumbbell', grip: 'pronated', squeeze: true })).toThrow(/variant not implemented yet/)
    expect(() => run({ implement: 'cable', posture: 'standing' })).toThrow(/variant not implemented yet/)
    expect(() => run({ benchAngle: -5 })).toThrow(/variant not implemented yet/)
    expect(() => run({ benchAngle: -20, implement: 'smith' })).toThrow(/variant not implemented yet/)
    expect(() => run({ benchAngle: -20, implement: 'dumbbell', squeeze: true, grip: 'neutral' })).toThrow(/variant not implemented yet/)
    expect(() => run({ benchAngle: 5 })).toThrow(/variant not implemented yet/)
    expect(() => run({ implement: 'barbell', grip: 'neutral' })).toThrow(/variant not implemented yet/)
    expect(() => run({ implement: 'machine', posture: 'lying_supine' })).toThrow(/variant not implemented yet/)
    expect(() => bake(getTemplate(T), parseParams(T, {}, 'unilateral'), skel)).toThrow(/variant not implemented yet/)
  })

  it.each([116, 117])('decline (%s): head down the pad with the legs hooked on the rollers, the load to the low chest and back over the shoulders', (id) => {
    const b = get(id)
    const k = b.implements.findIndex((s) => s.kind === 'decline_bench')
    const bench = b.implements[k]
    const { f, impl } = pose(b, TOP)
    const caps = bodyCapsules(skel, f)
    const [pad, kneeRoller, ankleRoller] = placeParts(bench, impl[k])
    // butt, upper back and head on the pad; the head lower than the hips by the decline
    for (const [what, re] of [['butt', /^pelvis$/], ['upper back', /^thorax2$/]] as const) {
      const v = minClear(caps.filter((c) => re.test(c.segment)), pad)
      expect(v, what).toBeGreaterThan(-0.015)
      expect(v, what).toBeLessThan(0.002)
    }
    const head = minClear(caps.filter((c) => c.region === 'head'), pad)
    expect(head).toBeGreaterThan(-0.01)
    expect(head).toBeLessThan(0.003)
    const down = segPos(skel, f, 'pelvis')[1] - segPos(skel, f, 'head')[1]
    expect(down).toBeGreaterThan(0.15)
    // the knee roller in the bend behind the knees, the ankle roller over the fronts of the ankles: both press lightly
    const legs = caps.filter((c) => /^(thigh|shank|foot)_/.test(c.region))
    for (const roller of [kneeRoller, ankleRoller]) {
      const v = minClear(legs, roller)
      expect(v).toBeGreaterThan(-0.008)
      expect(v).toBeLessThan(0.001)
    }
    expect(segPos(skel, f, 'tibia_l')[2]).toBeGreaterThan(bench.sites.knee.pos[2])
    expect(segPos(skel, f, 'foot_l')[2]).toBeLessThan(bench.sites.ankle.pos[2])
    // soft lockout over the shoulders, elbows folded at the bottom; the touch below the flat bench's, on the low chest
    expect(dof(b, TOP, 'elbow_l.flex')).toBeLessThan(10)
    expect(dof(b, BOTTOM, 'elbow_l.flex')).toBeGreaterThan(id === 116 ? 120 : 90)
    const load = id === 116 ? 'bar' : 'db_l'
    expect(Math.abs(implPos(b, TOP, load)[2] - segPos(skel, f, 'humerus_l')[2])).toBeLessThan(0.02)
    if (id === 116) {
      expect(inThorax(b, BOTTOM, implPos(b, BOTTOM, 'bar'))[1]).toBeLessThan(inThorax(get(101), BOTTOM, implPos(get(101), BOTTOM, 'bar'))[1] - 0.01)
      // uprights at the head end, the cups just under the locked-out bar
      const rack = b.implements.find((s) => s.kind === 'bench_rack')!
      expect(rack.sites.l.pos[1]).toBeLessThan(implPos(b, TOP, 'bar')[1])
    }
    // within passive horizontal abduction at the bottom
    expect(armElevation(skel, pose(b, BOTTOM).f)).toBeGreaterThan(30)
  })

  it('dumbbells and machine never touch the body beyond soft contact', () => {
    for (const id of [107, 108, 121]) {
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
