import { describe, expect, it } from 'vitest'
import { bake, compactSize, decode, encode, frameQ, type Baked } from '../../src/motion/bake.ts'
import { createSkeleton, type SkeletonData } from '../../src/motion/skeleton.ts'
import { dumbbellPoses } from '../../src/motion/templates/arms.ts'
import { getTemplate, parseParams } from '../../src/motion/templates/index.ts'
import { clearances, runGates, skeletonGate } from './gates.ts'
import { loadMotionExercises, loadSkeleton, skeletonSourceIssue } from './load.ts'

const skel = loadSkeleton()

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

  it('reads the 24 exercise records whose motion template is implemented', () => {
    const ids = loadMotionExercises().map((r) => r.id).sort((a, b) => a - b)
    expect(ids).toEqual([203, 204, 214, 301, 302, 303, 309, 310, 311, 401, 402, 405, 406, 407, 408, 701, 702, 703, 710, 711, 712, 713, 714, 719])
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
