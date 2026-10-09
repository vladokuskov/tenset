import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bake, compactSize, decode, encode, frameImplements, frameQ, type Baked, type CompactMotion } from '../../src/motion/bake.ts'
import { fk } from '../../src/motion/fk.ts'
import { qconj, qrot } from '../../src/motion/math.ts'
import { bodyCapsules, placeParts } from '../../src/motion/collide.ts'
import type { Part } from '../../src/motion/implements.ts'
import type { BandSpec } from '../../src/motion/implements/bands.ts'
import { createSkeleton, type SkeletonData } from '../../src/motion/skeleton.ts'
import { dumbbellPoses } from '../../src/motion/templates/arms.ts'
import { getTemplate, parseParams } from '../../src/motion/templates/index.ts'
import { armAngles, clearances, frames, HORIZONTAL_ABDUCTION, PROP_TOL, runGates, skeletonGate } from './gates.ts'
import { loadMotionExercises, loadSkeleton, skeletonSourceIssue } from './load.ts'

const skel = loadSkeleton()
const BAKED = new URL('../../src/features/figure/motion/baked/', import.meta.url)

function shipped(id: string, raw: Record<string, unknown>) {
  const b = bake(getTemplate(id), parseParams(id, raw), skel)
  const c = encode(b, skel)
  return { b: decode(c, skel), bytes: compactSize(c) }
}

const clone = (b: Baked): Baked => ({ ...b, q: b.q.slice(), ip: b.ip.slice() })
const failed = (b: Baked) => runGates(b, skel).filter((g) => !g.pass)

describe('motion QA gates', () => {
  const squat = shipped('squat', { hold: 'back_high' })

  it('pass on a clean baked squat and pull-up', () => {
    expect(runGates(squat.b, skel, squat.bytes).filter((g) => !g.pass)).toEqual([])
    const pull = shipped('vertical-pull', {})
    expect(runGates(pull.b, skel, pull.bytes).filter((g) => !g.pass)).toEqual([])
  })

  it('catch an injected one-frame IK flip', () => {
    const b = clone(squat.b)
    const frame = 30
    b.q[frame * b.nDof + skel.dof['elbow_l.flex']] -= 25
    b.q[frame * b.nDof + skel.dof['shoulder_l.rot']] += 25
    const bad = failed(b)
    const flip = bad.filter((g) => /flip/.test(g.name))
    expect(flip.length).toBeGreaterThan(0)
    for (const g of flip) expect(Math.abs(g.frame! - frame)).toBeLessThanOrEqual(2)
  })

  it('catch an injected 10 mm foot slide', () => {
    const b = clone(squat.b)
    // both feet drift 10 mm sideways over a few frames and stay there for part of the rep
    for (let i = 40; i < 70; i++) b.q[i * b.nDof + skel.dof['pelvis.tx']] += 0.01 * Math.min(1, (i - 40) / 4)
    const bad = failed(b)
    const slip = bad.find((g) => g.name === 'foot slip')
    expect(slip).toBeDefined()
    expect(slip!.value).toBeGreaterThan(9)
    expect(slip!.value).toBeLessThan(11)
    expect(bad.some((g) => g.name === 'foot target error')).toBe(true)
  })

  it('catch a loop that does not close', () => {
    const b = clone(squat.b)
    // head pitch drifts 6 deg over the loop, so the last frame no longer meets the first
    for (let i = 0; i < b.frames; i++) b.q[i * b.nDof + skel.dof['head.flex']] += (6 * i) / b.frames
    expect(failed(b).map((g) => g.name)).toContain('loop seam position')
  })

  it('catch knee hyperextension', () => {
    const b = clone(squat.b)
    for (let i = 0; i < b.frames; i++) b.q[i * b.nDof + skel.dof['knee_r.flex']] -= 6
    expect(failed(b).map((g) => g.name)).toContain('knee/elbow hyperextension')
  })
})

describe('penetration gate', () => {
  const record = (id: number) => loadMotionExercises().find((r) => r.id === id)!
  const bakeRecord = (id: number) => {
    const r = record(id)
    return bake(getTemplate(r.template), parseParams(r.template, r.params, r.laterality), skel)
  }
  const penetration = (b: Baked) => runGates(b, skel).filter((g) => g.name.startsWith('penetration') && !g.pass)

  it('reads the exercise records whose motion template is implemented (the first 24 and any family work)', () => {
    const ids = loadMotionExercises().map((r) => r.id).sort((a, b) => a - b)
    expect(ids).toEqual(expect.arrayContaining([203, 204, 214, 301, 302, 303, 309, 310, 311, 401, 402, 405, 406, 407, 408, 701, 702, 703, 710, 711, 712, 713, 714, 719]))
  })

  it('reports the closest approach per pair and passes the shipped dumbbell and barbell curls', () => {
    for (const id of [711, 710]) {
      const b = bakeRecord(id)
      expect(penetration(b)).toEqual([])
      const rows = clearances(b, skel)
      expect(rows.some((r) => r.pair.includes('thigh_l') && r.pair.includes('db_l'))).toBe(id === 711)
      expect(rows.some((r) => r.kind === 'body' && r.pair.includes('upperarm') && r.pair.includes('trunk'))).toBe(true)
      for (const r of rows) expect(r.excess).toBe(0)
    }
  })

  it('catches review bug 1: dumbbells driven into the thighs (no arm abduction at the bottom of a curl)', () => {
    // the arms hang straight down and a few degrees in, as before the fix; the dumbbells follow the hands
    const b = bakeRecord(711)
    const ip = b.ip.slice()
    for (let i = 0; i < b.frames; i++) {
      const q = frameQ(b, i)
      if (q[skel.dof['elbow_l.flex']] > 40) continue
      for (const s of ['l', 'r']) {
        q[skel.dof[`shoulder_${s}.plane`]] = 180
        q[skel.dof[`shoulder_${s}.elev`]] = 4
      }
      b.q.set(q, i * b.nDof)
      dumbbellPoses(skel, q).forEach((p, k) => ip.set([...p.pos, ...p.rot], (i * b.implements.length + k) * 7))
    }
    const bad = penetration({ ...b, ip })
    expect(bad.map((g) => g.name)).toContain('penetration body-prop')
    expect(bad.find((g) => g.name === 'penetration body-prop')!.detail).toMatch(/thigh_[lr] \/ db_[lr]/)
  })

  it('catches review bug 2: elbows pulled into the waist on a shoulder-width barbell curl', () => {
    const b = bakeRecord(710)
    const q = b.q.slice()
    for (let i = 0; i < b.frames; i++) {
      for (const s of ['l', 'r']) {
        // upper arms swung ~12 deg in towards the midline: the elbows end up on the waist
        q[i * b.nDof + skel.dof[`shoulder_${s}.plane`]] = 180
        q[i * b.nDof + skel.dof[`shoulder_${s}.elev`]] = 12
      }
    }
    const broken = { ...b, q }
    expect(penetration(broken).map((g) => g.name)).toContain('penetration body-body')
    const waist = clearances(broken, skel).filter((r) => /upperarm/.test(r.pair) && /trunk/.test(r.pair) && r.excess > 0)
    expect(waist.length).toBeGreaterThan(0)
  })

  it('checks the drawn machines: a smith frame drawn 8 cm off the bar line puts a carriage through the hand', { timeout: 20_000 }, () => {
    const b = bakeRecord(407)
    const gate = (x: Baked) => runGates(x, skel).find((g) => g.name === 'penetration body-machine')!
    expect(gate(b).pass).toBe(true)
    // the bar (a template implement) slides along its own axis, the drawn machine follows it off the lifter's line
    const k = b.implements.findIndex((s) => s.id === 'bar')
    const ip = b.ip.slice()
    for (let i = 0; i < b.frames; i++) ip[(i * b.implements.length + k) * 7] += 0.08
    const moved = { ...b, ip }
    expect(penetration(moved).map((g) => g.name)).toEqual(['penetration body-machine'])
    expect(gate(moved).detail).toMatch(/^hand_[lr] \/ smith:/)
  })

  it('checks the drawn machines: a cable stack standing where the working hand raises catches it', { timeout: 20_000 }, () => {
    const b = bakeRecord(204)
    const stack = b.implements.find((s) => s.id === 'stack')!
    const toward = -Math.sign(stack.parts[0].shape === 'cylinder' ? stack.parts[0].a[0] : 1) * 0.25
    const shift = (v: [number, number, number]): [number, number, number] => [v[0] + toward, v[1], v[2]]
    const parts = stack.parts.map((p) => (p.shape === 'cylinder' ? { ...p, a: shift(p.a), b: shift(p.b) } : p))
    const moved = { ...b, cables: b.cables!.map((c) => ({ ...c, pulley: shift(c.pulley) })), implements: b.implements.map((s) => (s.id === 'stack' ? { ...s, parts } : s)) }
    expect(penetration(b)).toEqual([])
    const bad = penetration(moved).find((g) => g.name === 'penetration body-machine')
    expect(bad?.detail).toMatch(/ \/ cable-stack:(frame|stack|rail)#/)
  })

  it('checks equipment against equipment: plates against the smith frame, dumbbell against dumbbell and bench', { timeout: 30_000 }, () => {
    const gate = (x: Baked) => runGates(x, skel).find((g) => g.name === 'penetration equipment-equipment')!
    const smith = bakeRecord(407)
    expect(gate(smith).pass).toBe(true)
    expect(clearances(smith, skel).some((r) => r.kind === 'equipment' && /^bar#\d+ \/ smith:/.test(r.pair))).toBe(true)
    // plates 3 cm thicker on each face reach the frame the loaded bar clears by about 25 mm
    const thick = (p: Part): Part => {
      if (p.shape !== 'cylinder' || p.r < 0.1) return p
      const d = Math.sign(p.b[0] - p.a[0]) * 0.03
      return { ...p, a: [p.a[0] - d, p.a[1], p.a[2]], b: [p.b[0] + d, p.b[1], p.b[2]] }
    }
    const big = { ...smith, implements: smith.implements.map((s) => (s.id === 'bar' ? { ...s, parts: s.parts.map(thick) } : s)) }
    expect(gate(big).pass).toBe(false)
    expect(gate(big).detail).toMatch(/^bar#\d+ \/ smith:/)

    // both dumbbells of a curl drawn 12 cm closer together
    const curl = bakeRecord(711)
    expect(gate(curl).pass).toBe(true)
    const r = curl.implements.findIndex((s) => s.id === 'db_r')
    const ip = curl.ip.slice()
    for (let i = 0; i < curl.frames; i++) ip[(i * curl.implements.length + r) * 7] += 0.12
    expect(gate({ ...curl, ip }).detail).toMatch(/^db_[lr]#\d+ \/ db_[lr]#\d+/)

    // spider curl: the left dumbbell pushed into the bench pad
    const spider = bakeRecord(712)
    expect(gate(spider).pass).toBe(true)
    const n = spider.implements.length
    const [bench, l] = ['bench', 'db_l'].map((id) => spider.implements.findIndex((s) => s.id === id))
    const sip = spider.ip.slice()
    for (let i = 0; i < spider.frames; i++) sip.set(placeParts(spider.implements[bench], frameImplements(spider, i)[bench])[0].center, (i * n + l) * 7)
    expect(gate({ ...spider, ip: sip }).detail).toMatch(/^db_l#\d+ \/ bench#\d+/)
  })

  it('checks drawn pads with the pad tolerance and frames, rails and stacks as rigid', { timeout: 20_000 }, () => {
    const rows = clearances(bakeRecord(303), skel).filter((r) => r.kind === 'machine')
    expect(rows.length).toBeGreaterThan(30)
    for (const r of rows) expect(r.tol, r.pair).toBe(r.pair.includes(':pad#') ? PROP_TOL.pad : PROP_TOL.rigid)
    // the thighs press into the rollers deeper than a rigid part allows, within the padding
    const roller = rows.filter((r) => /^thigh_[lr] \/ lat-pulldown:pad#/.test(r.pair))
    expect(roller.length).toBeGreaterThan(0)
    expect(Math.min(...roller.map((r) => r.min))).toBeLessThan(-PROP_TOL.rigid)
    expect(roller.every((r) => r.excess === 0)).toBe(true)
  })

  it('lets a declared rest raise the tolerance on a padded support, as an implement and as drawn', () => {
    // incline push-up: flat palms on the box's rubber tread, where the hand's fist capsule reads as a sink
    const file = readdirSync(BAKED).find((f) => f.startsWith('114-'))!
    const b = decode((JSON.parse(readFileSync(new URL(file, BAKED), 'utf8')) as { motion: CompactMotion }).motion, skel)
    const rest = b.rests!.find((r) => r.implement === 'box')!
    const tread = (x: Baked) => clearances(x, skel).filter((r) => /^hand_l \/ box(#|:pad#)1$/.test(r.pair))
    expect(tread(b).map((r) => r.kind).sort()).toEqual(['machine', 'prop'])
    for (const r of tread(b)) expect(r.tol).toBe(rest.tol)
    expect(penetration(b)).toEqual([])
    // without the rest the pad tolerance applies, and a rest below it never tightens a pad
    expect(penetration({ ...b, rests: undefined }).map((g) => g.name).sort()).toEqual(['penetration body-machine', 'penetration body-prop'])
    for (const r of tread({ ...b, rests: [{ ...rest, tol: 5 }] })) expect(r.tol).toBe(PROP_TOL.pad)
  })

  it('checks the body against the floor, and takes per-template tolerance overrides', { timeout: 20_000 }, () => {
    const floor = (x: Baked) => runGates(x, skel).find((g) => g.name === 'penetration body-floor')!
    const b = bakeRecord(401)
    expect(floor(b).pass).toBe(true)
    // the whole lifter sunk 12 mm into the floor for part of the rep
    const q = b.q.slice()
    for (let i = 30; i < 60; i++) q[i * b.nDof + skel.dof['pelvis.ty']] -= 0.012
    const sunk = { ...b, q }
    expect(floor(sunk).pass).toBe(false)
    expect(floor(sunk).detail).toMatch(/^foot_[lr] \/ floor clearance -1[12]/)
    expect(floor({ ...sunk, tolerances: { floor: 15 } }).pass).toBe(true)

    // a body pair tolerance raised for this template only
    const curl = bakeRecord(710)
    const cq = curl.q.slice()
    for (let i = 0; i < curl.frames; i++) {
      for (const s of ['l', 'r']) {
        cq[i * curl.nDof + skel.dof[`shoulder_${s}.plane`]] = 180
        cq[i * curl.nDof + skel.dof[`shoulder_${s}.elev`]] = 12
      }
    }
    const broken = { ...curl, q: cq }
    const body = (x: Baked) => runGates(x, skel).find((g) => g.name === 'penetration body-body')!
    const labels = [...new Set(clearances(broken, skel).filter((r) => r.kind === 'body' && r.excess > 0).map((r) => r.pair))]
    expect(body(broken).pass).toBe(false)
    expect(body({ ...broken, tolerances: { body: Object.fromEntries(labels.map((l) => [l, 200])) } }).pass).toBe(true)
  })

  it('fails baked motion when the skeleton changes, and skeleton.json when the body model changes', () => {
    const c = encode(bakeRecord(203), skel)
    expect(skeletonGate(c, skel).pass).toBe(true)
    const data = JSON.parse(JSON.stringify(skel.data)) as SkeletonData
    data.segments.forearm_l.length += 0.01
    expect(skeletonGate(c, createSkeleton(data)).pass).toBe(false)
    expect(skeletonSourceIssue(skel)).toBeNull()
    expect(skeletonSourceIssue(createSkeleton({ ...skel.data, source: { ...skel.data.source, sha256: '0'.repeat(64) } }))).toMatch(/changed/)
  })
})

describe('shoulder horizontal abduction gate', () => {
  const record = (id: number) => loadMotionExercises().find((r) => r.id === id)!
  const bakeRecord = (id: number) => {
    const r = record(id)
    return bake(getTemplate(r.template), parseParams(r.template, r.params, r.laterality), skel)
  }
  const gate = (x: Baked) => runGates(x, skel).find((g) => g.name === 'shoulder horizontal abduction')!
  /** the lateral raise with both arms swung to `plane` (deg forward of the frontal plane) wherever they are raised */
  const swung = (b: Baked, plane: number) => {
    const q = b.q.slice()
    for (let i = 0; i < b.frames; i++) for (const s of ['l', 'r']) if (q[i * b.nDof + skel.dof[`shoulder_${s}.elev`]] > 30) q[i * b.nDof + skel.dof[`shoulder_${s}.plane`]] = plane
    return { ...b, q }
  }

  it('measures the arm behind the thorax frontal plane only while it is raised towards the horizontal', () => {
    const b = bakeRecord(203)
    const top = frameQ(b, 110)
    expect(top[skel.dof['shoulder_l.plane']]).toBe(20)
    const a = armAngles(skel, fk(skel, top), 'l')
    expect(a.elev).toBeCloseTo(85, 0)
    expect(a.behind).toBeCloseTo(-20, 0)
    // the hanging arms at the bottom of the raise are outside the judged window
    const low = Array.from({ length: b.frames }, (_, i) => armAngles(skel, fk(skel, frameQ(b, i)), 'l').elev)
    expect(Math.min(...low)).toBeLessThan(HORIZONTAL_ABDUCTION.elev[0])
  })

  it('passes the approved lateral raise and an arm 40 deg behind the chest, fails one 55 deg behind', () => {
    const b = bakeRecord(203)
    expect(gate(b).pass).toBe(true)
    expect(gate(swung(b, -40)).pass).toBe(true)
    const bad = gate(swung(b, -55))
    expect(bad.pass).toBe(false)
    expect(bad.value).toBeCloseTo(55, 0)
    expect(bad.detail).toMatch(/^shoulder_[lr] at \d+ deg elevation/)
    expect(gate({ ...swung(b, -55), tolerances: { horizontalAbduction: 60 } }).pass).toBe(true)
  })

  it('does not read shoulder extension with the arm low (incline curl hang, back squat) as horizontal abduction', () => {
    for (const id of [702, 401]) expect(gate(bakeRecord(id)).pass, `${id}`).toBe(true)
  })
})

describe('lateral balance gate', () => {
  const record = (id: number) => loadMotionExercises().find((r) => r.id === id)!
  const bakeRecord = (id: number) => {
    const r = record(id)
    return bake(getTemplate(r.template), parseParams(r.template, r.params, r.laterality), skel)
  }
  const gate = (x: Baked) => runGates(x, skel).find((g) => g.name === 'balance (lateral, past the feet)')!

  it('passes a bilateral stance and the cable pull a lifter leans against, fails a sideways pull nobody could stand', () => {
    const curl = bakeRecord(711)
    expect(gate(curl).pass).toBe(true)
    expect(gate(curl).detail).toMatch(/^between the feet/)
    // the one-sided cable raise leans against its cable and keeps the pressure between the feet
    expect(gate(bakeRecord(204)).pass).toBe(true)
    // 60 kg pulling the left dumbbell sideways at hand height tips the pressure well past the left foot
    const pulled = { ...curl, cables: [{ pulley: [4, 0.9, 0] as [number, number, number], implement: 'db_l', point: [0, 0, 0] as [number, number, number], kg: 60 }] }
    const bad = gate(pulled)
    expect(bad.pass).toBe(false)
    expect(bad.value).toBeGreaterThan(100)
    expect(gate({ ...pulled, tolerances: { lateral: 2000 } }).pass).toBe(true)
  })

  it('holds single-leg work over the stance foot', () => {
    const curl = bakeRecord(711)
    // the left knee bent 70 deg lifts that foot: the same body now stands on the right foot with the pressure still
    // between the feet
    const q = curl.q.slice()
    for (let i = 0; i < curl.frames; i++) q[i * curl.nDof + skel.dof['knee_l.flex']] = 70
    const single = { ...curl, q, contacts: curl.contacts.filter((c) => !/_l$/.test(c.site) || c.kind === 'grip') }
    const g = gate(single)
    expect(g.detail).toMatch(/^over foot_r/)
    expect(g.pass).toBe(false)
    expect(g.value).toBeGreaterThan(60)
  })

  it('skips hanging, seated and hand-supported setups unless the template declares the check', { timeout: 20_000 }, () => {
    expect(gate(bakeRecord(301)).detail).toBe('not judged: no planted feet')
    expect(gate(bakeRecord(702)).detail).toMatch(/^not judged: /)
    // the lean-away raise hangs off the post with the free hand: without it the lean would tip the lifter over
    const lean = bakeRecord(214)
    expect(gate(lean).detail).toBe('not judged: grip_l on post')
    const declared = gate({ ...lean, balance: { ...lean.balance!, lateral: true } })
    expect(declared.pass).toBe(false)
    expect(declared.value).toBeGreaterThan(100)
    const curl = bakeRecord(711)
    expect(gate({ ...curl, balance: { ...curl.balance!, lateral: false } }).detail).toBe('not judged: declared off')
  })
})

describe('wave 3 gates', () => {
  const shippedBake = (id: number) => {
    const file = readdirSync(BAKED).find((f) => f.startsWith(`${id}-`))!
    return decode((JSON.parse(readFileSync(new URL(file, BAKED), 'utf8')) as { motion: CompactMotion }).motion, skel)
  }
  const gate = (x: Baked, name: string) => runGates(x, skel).find((g) => g.name === name)!
  /** move implement `id` by `d` (m) on every frame, or pin it to its frame 0 pose */
  const moveImplement = (x: Baked, id: string, d: [number, number, number] | 'freeze'): Baked => {
    const ip = x.ip.slice()
    const k = x.implements.findIndex((s) => s.id === id)
    const n = x.implements.length
    for (let i = 0; i < x.frames; i++) {
      const o = (i * n + k) * 7
      if (d === 'freeze') ip.set(x.ip.subarray(k * 7, k * 7 + 7), o)
      else for (let j = 0; j < 3; j++) ip[o + j] += d[j]
    }
    return { ...x, ip }
  }

  it('checks drawn-only bands against the body, except the fists, the wrapped segments and their folds', { timeout: 30_000 }, () => {
    const pull = shippedBake(334)
    expect(gate(pull, 'penetration body-strap').pass).toBe(true)
    // without its draped points the band runs straight from the bar to the shin node, through the thigh
    const knee = pull.implements.findIndex((s) => s.id === 'band_knee')
    const straight = moveImplement(pull, 'band_knee', [0, 0, 0])
    for (const id of ['band_front0', 'band_front1', 'band_front2', 'band_back0', 'band_back1', 'band_back2']) {
      const k = pull.implements.findIndex((s) => s.id === id)
      for (let i = 0; i < pull.frames; i++) straight.ip.set(pull.ip.subarray((i * pull.implements.length + knee) * 7, (i * pull.implements.length + knee) * 7 + 3), (i * pull.implements.length + k) * 7)
    }
    const g = gate(straight, 'penetration body-strap')
    expect(g.pass).toBe(false)
    expect(g.detail).toMatch(/strap:band/)
    expect(gate({ ...straight, tolerances: { strap: 500 } }, 'penetration body-strap').pass).toBe(true)
    // the knee band of the lateral walk and the Spanish squat band behind the knees sit on the legs they wrap
    for (const id of [537, 436]) expect(gate(shippedBake(id), 'penetration body-strap').pass, `${id}`).toBe(true)
  })

  it('checks a band between riding nodes past the wrapped ends: a knee-to-knee band through the thighs fails', { timeout: 30_000 }, () => {
    const walk = shippedBake(537)
    // the crossing runs between the knees are checked against the thighs now, not skipped as jointed segments
    expect(clearances(walk, skel).some((r) => r.kind === 'strap' && /^thigh_[lr] \/ strap:band$/.test(r.pair))).toBe(true)
    // a straight strip from 20 cm outside the left knee to 20 cm outside the right one runs through both thighs
    const ip0 = frameImplements(walk, 0)
    const local = (id: string, d: [number, number, number]) => qrot(qconj(ip0.find((p) => p.id === id)!.rot), d)
    const band = walk.implements.find((s) => s.id === 'band') as BandSpec
    const through = { ...band, band: { ...band.band, closed: false, path: [{ implement: 'knee_l', at: local('knee_l', [0.2, 0, 0]) }, { implement: 'knee_r', at: local('knee_r', [-0.2, 0, 0]) }] } }
    const g = gate({ ...walk, implements: walk.implements.map((s) => (s.id === 'band' ? through : s)) }, 'penetration body-strap')
    expect(g.pass).toBe(false)
    expect(g.detail).toMatch(/^thigh_[lr] \/ strap:band/)
  })

  it('judges stepping loops: the planted stretches of a foot hold still, the lateral balance covers them', { timeout: 30_000 }, () => {
    const walk = shippedBake(537)
    expect(gate(walk, 'foot slip (stepping)').pass).toBe(true)
    expect(gate(walk, 'balance (lateral, past the feet)').detail).not.toMatch(/not judged/)
    // both feet slide 20 mm sideways while they stand between the steps
    const q = walk.q.slice()
    for (let i = 84; i < 120; i++) q[i * walk.nDof + skel.dof['pelvis.tx']] += 0.02 * Math.min(1, (i - 84) / 10)
    const slip = gate({ ...walk, q }, 'foot slip (stepping)')
    expect(slip.pass).toBe(false)
    expect(slip.value).toBeGreaterThan(15)
    // a lunge lands its stepping foot inside the glide allowance
    expect(gate(shippedBake(424), 'foot landing glide (stepping)').pass).toBe(true)
  })

  it('fails a machine lever that does not travel', { timeout: 30_000 }, () => {
    const row = shippedBake(338)
    expect(gate(row, 'machine travel').pass).toBe(true)
    const frozen = gate(moveImplement(row, 'tbar_lever', 'freeze'), 'machine travel')
    expect(frozen.pass).toBe(false)
    expect(frozen.detail).toBe('tbar_lever')
    // an isometric hold with a free weight has no lever
    expect(runGates(shippedBake(824), skel).some((g) => g.name === 'machine travel')).toBe(false)
  })

  it('fails standing equipment inside other standing equipment', { timeout: 30_000 }, () => {
    const thrust = shippedBake(531)
    expect(gate(thrust, 'penetration fixed equipment').pass).toBe(true)
    // the thrust bench pushed 20 cm sideways stands in the Smith frame
    const g = gate(moveImplement(thrust, 'thrust_bench', [0.2, 0, 0]), 'penetration fixed equipment')
    expect(g.pass).toBe(false)
    expect(g.detail).toMatch(/smith-reversed.*thrust-bench|thrust-bench.*smith-reversed/)
  })

  it('judges hand-supported floor work against the support polygon of hands and feet', { timeout: 30_000 }, () => {
    const name = 'balance (support polygon, hands on the floor)'
    const plank = shippedBake(804)
    expect(gate(plank, name).pass).toBe(true)
    expect(gate(plank, name).detail).toBeUndefined()
    // a 60 kg pull sideways at the hips puts the pressure well outside the hands and feet
    const pulled = { ...plank, implements: [...plank.implements], cables: [{ pulley: [3, 0.4, 0.6] as [number, number, number], implement: 'mat', point: [0, 0.4, 0.6] as [number, number, number], kg: 60 }] }
    const g = gate(pulled, name)
    expect(g.pass).toBe(false)
    expect(g.value).toBeGreaterThan(15)
    expect(gate({ ...pulled, tolerances: { support: 5000 } }, name).pass).toBe(true)
    // lying and standing work is not judged
    expect(gate(shippedBake(819), name).detail).toBe('not judged: lying on the floor')
    expect(gate(shippedBake(711), name).detail).toBe('not judged: no hand on the floor')
  })

  it('judges a shoulder tap over the tripod of the planted hand and the feet', { timeout: 30_000 }, () => {
    const name = 'balance (support polygon, hands on the floor)'
    const tap = shippedBake(828)
    expect(gate(tap, name).pass).toBe(true)
    // the right hand is up at frame 60; a 20 kg pull at the hips towards it puts the pressure past the line from the
    // left hand to the right foot while it taps
    const F = frames(tap, skel)
    expect(bodyCapsules(skel, F.f[60]).filter((c) => c.region === 'hand_r').every((c) => Math.min(c.a[1], c.b[1]) - c.r > 0.2)).toBe(true)
    const hip = F.f[60].pos[skel.seg.pelvis]
    const mat = F.impl[60].find((p) => p.id === 'mat')!.pos
    const g = gate({ ...tap, cables: [{ pulley: [-3, hip[1], hip[2]], implement: 'mat', point: [hip[0] - mat[0], hip[1] - mat[1], hip[2] - mat[2]], kg: 20 }] }, name)
    expect(g.pass).toBe(false)
    expect(g.value).toBeGreaterThan(15)
    expect(g.detail).not.toMatch(/hand_r/)
    expect(g.detail).toMatch(/hand_l/)
  })

  it('fails a free hand declared to rest on a pad that floats off it', { timeout: 30_000 }, () => {
    const name = 'declared hand rest contact'
    const preacher = shippedBake(721)
    expect(gate(preacher, name).pass).toBe(true)
    const off = gate(moveImplement(preacher, 'preacher', [0, -0.05, 0]), name)
    expect(off.pass).toBe(false)
    expect(off.detail).toBe('hand_l / preacher')
    // a gripping hand listed in a rest only gets a tolerance there
    expect(runGates(shippedBake(828), skel).some((g) => g.name === name)).toBe(false)
  })
})
