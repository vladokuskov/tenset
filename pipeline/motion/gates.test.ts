import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bake, compactSize, decode, encode, frameImplements, frameQ, type Baked, type CompactMotion } from '../../src/motion/bake.ts'
import { placeParts } from '../../src/motion/collide.ts'
import type { Part } from '../../src/motion/implements.ts'
import { createSkeleton, type SkeletonData } from '../../src/motion/skeleton.ts'
import { dumbbellPoses } from '../../src/motion/templates/arms.ts'
import { getTemplate, parseParams } from '../../src/motion/templates/index.ts'
import { clearances, PROP_TOL, runGates, skeletonGate } from './gates.ts'
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
