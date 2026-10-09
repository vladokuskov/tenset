import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts, segmentDistance } from '../collide.ts'
import { centerOfMass, fk, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist, qconj, qrot, type V3 } from '../math.ts'
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
    expect(variants.map((v) => v.id).sort()).toEqual([201, 202, 208, 212, 216, 217, 220, 221, 222, 235])
  })

  it.each([...baked.keys()])('%s: elbow and arm elevation inside the research ranges at both ends', (slug) => {
    const b = baked.get(slug)!
    // the working arm (one-arm work: the record's side)
    const s = b.params.laterality === 'unilateral' && b.params.side === 'right' ? 'r' : 'l'
    // top: arms (nearly) locked overhead; machines stop a little short, the Smith locks out a little in front of the head
    expect(dof(b, TOP, `elbow_${s}.flex`)).toBeLessThan(b.params.implement === 'machine' ? 14 : 10)
    expect(dof(b, TOP, `shoulder_${s}.elev`)).toBeGreaterThan(({ machine: 150, smith: 155 } as Record<string, number>)[b.params.implement as string] ?? 165)
    // bottom: humeral elevation ~30-75, elbow ~95-145 (the rig's elbow stops at 150)
    expect(dof(b, BOTTOM, `elbow_${s}.flex`)).toBeGreaterThan(95)
    expect(dof(b, BOTTOM, `elbow_${s}.flex`)).toBeLessThan(146)
    expect(dof(b, BOTTOM, `shoulder_${s}.elev`)).toBeGreaterThan(30)
    expect(dof(b, BOTTOM, `shoulder_${s}.elev`)).toBeLessThan(80)
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

  it('Arnold press (216): palms to the face with the elbows in front at the bottom, turned palms forward with the elbows out at the top', () => {
    const b = get(216)
    const hand = (u: number) => {
      const f = fk(skel, frameQ(b, at(b, u)))
      return { f, palm: qrot(f.rot[skel.seg.hand_l], skel.data.sites.grip_l.normal!), thorax: f.rot[skel.seg.thorax2] }
    }
    const inThorax = (h: ReturnType<typeof hand>, v: V3) => qrot(qconj(h.thorax), v)
    const bottom = hand(BOTTOM), top = hand(TOP)
    // palm towards the face (back) at the bottom, forward at lockout
    expect(inThorax(bottom, bottom.palm)[2]).toBeLessThan(-0.6)
    expect(inThorax(top, top.palm)[2]).toBeGreaterThan(0.6)
    // elbows in front at the bottom (plane of elevation near the sagittal), out to the side at the top
    expect(dof(b, BOTTOM, 'shoulder_l.plane')).toBeGreaterThan(75)
    expect(dof(b, TOP, 'shoulder_l.plane')).toBeLessThan(35)
    // the dumbbells before the face, clear of it
    const head = bodyCapsules(skel, bottom.f).filter((c) => c.region === 'head')
    const k = b.implements.findIndex((x) => x.id === 'db_l')
    const db = placeParts(b.implements[k], frameImplements(b, at(b, BOTTOM))[k])
    expect(Math.min(...db.flatMap((x) => head.map((c) => capsuleSolidClearance(c, x))))).toBeGreaterThan(0)
  })

  it('kettlebell press (220): one arm from the rack to beside the ear, the bell on the back of the forearm, the free arm hanging', () => {
    const b = get(220)
    expect(b.implements.map((x) => x.id)).toEqual(['kb_r'])
    expect(b.symmetric).toBe(false)
    for (let i = 0; i < b.frames; i += 5) {
      const q = frameQ(b, i)
      // the bell rests on the forearm, or in the rack in the crook against the upper arm
      const caps = bodyCapsules(skel, fk(skel, q)).filter((c) => c.region === 'forearm_r' || c.region === 'hand_r' || c.region === 'upperarm_r')
      const spec = b.implements[0]
      const bell = placeParts({ ...spec, parts: spec.parts.filter((p) => p.shape === 'cylinder' && p.r > 0.03) }, frameImplements(b, i)[0])
      const touch = Math.min(...bell.flatMap((x) => caps.map((c) => capsuleSolidClearance(c, x))))
      expect(touch, `@${i}`).toBeLessThan(0.001)
      expect(touch, `@${i}`).toBeGreaterThan(-0.006)
      expect(q[skel.dof['shoulder_l.elev']]).toBeLessThan(15)
    }
    // the rack: palm in, the fist under the chin near the midline, the forearm tilted in ~15-25 deg, the elbow down in
    // front of the ribs and the bell in front of the shoulder (not out beside the deltoid); lockout: palm forward
    const f = fk(skel, frameQ(b, at(b, BOTTOM)))
    {
      const fist = sitePos(skel, f, 'grip_r'), el = segPos(skel, f, 'forearm_r'), sh = segPos(skel, f, 'humerus_r')
      const bell = frameImplements(b, at(b, BOTTOM))[0].pos
      expect(fist[0]).toBeGreaterThan(-0.13)
      expect(fist[0]).toBeLessThan(-0.05)
      expect(fist[2]).toBeGreaterThan(sh[2] + 0.08)
      expect(el[2]).toBeGreaterThan(sh[2] + 0.1)
      const tilt = (Math.atan2(fist[0] - el[0], fist[1] - el[1]) * 180) / Math.PI
      expect(tilt).toBeGreaterThan(12)
      expect(tilt).toBeLessThan(28)
      expect(bell[0]).toBeGreaterThan(sh[0] - 0.06)
      expect(bell[2]).toBeGreaterThan(sh[2] + 0.08)
    }
    const thorax = f.rot[skel.seg.thorax2]
    const palm = qrot(qconj(thorax), qrot(f.rot[skel.seg.hand_r], skel.data.sites.grip_r.normal!))
    expect(palm[0]).toBeGreaterThan(0.6)
    expect(dof(b, BOTTOM, 'elbow_r.flex')).toBeGreaterThan(130)
  })

  it('band press (222): the band under both soles, up the front of the body to the handles at the shoulders', () => {
    const b = get(222)
    const strip = b.implements.find((x) => x.kind === 'band')!
    expect(strip).toBeDefined()
    const soles = ['sole_l', 'sole_r'].map((id) => frameImplements(b, 0)[b.implements.findIndex((x) => x.id === id)].pos)
    for (const p of soles) expect(p[1]).toBeLessThan(0.005)
    // the strip passes in front of the shoulder joints
    for (const u of [TOP, BOTTOM]) {
      const f = fk(skel, frameQ(b, at(b, u)))
      const front = frameImplements(b, at(b, u))[b.implements.findIndex((x) => x.id === 'front_l')].pos
      expect(front[2]).toBeGreaterThan(segPos(skel, f, 'humerus_l')[2] + 0.08)
    }
    // every frame: from the ring past the front of the arm down to the outer edge of the sole, clear of the arm and the
    // trunk, and down beside the foot rather than through it
    const k = (id: string) => b.implements.findIndex((x) => x.id === id)
    const pathPt = (impl: ReturnType<typeof frameImplements>, p: { implement: string; site?: string; at?: V3 }) => {
      const spec = b.implements[k(p.implement)]
      const local = p.site ? spec.sites[p.site].pos : [0, 0, 0]
      const o = p.at ?? [0, 0, 0]
      return siteWorld({ ...spec, sites: { x: { pos: [local[0] + o[0], local[1] + o[1], local[2] + o[2]] } } }, impl[k(p.implement)], 'x').pos
    }
    const path = (strip as unknown as { band: { path: { implement: string; site?: string; at?: V3 }[] } }).band.path
    for (let i = 0; i < b.frames; i += 2) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      const pts = path.map((p) => pathPt(impl, p))
      const caps = bodyCapsules(skel, f)
      const near = (k0: number, re: RegExp) => Math.min(...caps.filter((c) => re.test(c.region)).map((c) => segmentDistance(c.a, c.b, pts[k0], pts[k0 + 1]).d - c.r))
      expect(near(0, /^(upperarm|forearm)_l$|^trunk$/), `ring-front @${i}`).toBeGreaterThan(0)
      expect(near(1, /^(upperarm|forearm)_l$|^trunk$/), `front-sole @${i}`).toBeGreaterThan(0)
      expect(near(1, /^foot_l$/), `front-sole foot @${i}`).toBeGreaterThan(-0.001)
    }
  })

  it('Z press (235): sitting on the floor, legs straight, trunk upright and still, the seated dumbbell path', () => {
    const b = get(235)
    expect(b.implements.some((x) => x.kind === 'bench')).toBe(false)
    const base = frameQ(b, 0)
    for (let i = 0; i < b.frames; i += 5) {
      const q = frameQ(b, i)
      for (const n of ['pelvis.ty', 'pelvis.tilt', 'knee_l.flex', 'hip_l.flex']) expect(q[skel.dof[n]]).toBeCloseTo(base[skel.dof[n]], 6)
    }
    const caps = bodyCapsules(skel, fk(skel, base))
    const low = (re: RegExp) => Math.min(...caps.filter((c) => re.test(c.segment)).map((c) => Math.min(c.a[1], c.b[1]) - c.r))
    expect(low(/^pelvis$/)).toBeCloseTo(-0.003, 3)
    expect(base[skel.dof['knee_l.flex']]).toBeLessThan(5)
    expect(base[skel.dof['hip_l.flex']]).toBeGreaterThan(80)
  })

  it('unsupported variants throw', () => {
    expect(() => bake(t, parse({ implement: 'kettlebell', posture: 'standing', grip: 'neutral' }), skel)).toThrow(/variant not implemented yet/)
    expect(() => bake(t, parse({ implement: 'dumbbell', posture: 'standing', support: 'floor' }), skel)).toThrow(/variant not implemented yet/)
    expect(() => bake(t, parse({ implement: 'dumbbell', posture: 'seated', grip: 'supinated' }), skel)).toThrow(/variant not implemented yet/)
    expect(() => bake(t, parse({ implement: 'smith', posture: 'seated' }), skel)).toThrow(/variant not implemented yet/)
    expect(() => bake(t, parse({ implement: 'barbell', posture: 'standing' }, 'alternating'), skel)).toThrow(/variant not implemented yet/)
  })
})
