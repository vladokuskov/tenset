import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../../bake.ts'
import { bodyCapsules, capsuleSolidClearance, placeParts } from '../../collide.ts'
import { fk, segPos } from '../../fk.ts'
import { angleBetween, RAD, sub } from '../../math.ts'
import { motionRecords, testSkeleton } from '../../testing.ts'
import { getTemplate, parseParams } from '../index.ts'
import { contactError, seamRatio } from './checks.ts'
import { BENCH_TOP } from './copenhagen.ts'

const skel = testSkeleton()
const rec = motionRecords('hold').find((r) => r.id === 538)!
const b: Baked = bake(getTemplate('hold'), parseParams('hold', rec.params, rec.laterality), skel)
const top = rec.params.side === 'left' ? 'l' : 'r'
const sup = top === 'l' ? 'r' : 'l'

describe('hold Copenhagen plank', () => {
  it('a unilateral breathing hold: contacts held, the loop closes', () => {
    expect(rec.laterality).toBe('unilateral')
    for (let i = 0; i < b.frames; i++) expect(contactError(skel, b, i)).toBeLessThan(0.005)
    expect(seamRatio(skel, b)).toBeLessThan(1.5)
  })

  it('the body runs in one line from the shoulders over the hips to the top ankle on the bench', () => {
    const mid = (f: ReturnType<typeof fk>, a: string, c: string) => segPos(skel, f, a).map((x, k) => (x + segPos(skel, f, c)[k]) / 2) as [number, number, number]
    for (let i = 0; i < b.frames; i += 5) {
      const f = fk(skel, frameQ(b, i))
      const ankle = segPos(skel, f, `foot_${top}`), hip = mid(f, 'femur_l', 'femur_r'), sh = mid(f, 'humerus_l', 'humerus_r')
      expect(angleBetween(sub(hip, ankle), sub(sh, hip)) * RAD).toBeLessThan(12)
      expect(ankle[1]).toBeGreaterThan(BENCH_TOP)
    }
  })

  it('the top shin rests on the bench pad, the bottom leg hangs clear of the floor', () => {
    const spec = b.implements.find((s) => s.id === 'bench')!
    for (let i = 0; i < b.frames; i += 5) {
      const caps = bodyCapsules(skel, fk(skel, frameQ(b, i)))
      const pad = placeParts(spec, frameImplements(b, i).find((p) => p.id === 'bench')!).filter((s) => s.part.pad)
      const shin = Math.min(...caps.filter((c) => c.region === `shank_${top}`).flatMap((c) => pad.map((s) => capsuleSolidClearance(c, s))))
      expect(shin).toBeLessThan(0.002)
      expect(shin).toBeGreaterThan(-0.015)
      const foot = Math.min(...caps.filter((c) => c.region === `foot_${sup}`).map((c) => Math.min(c.a[1], c.b[1]) - c.r))
      expect(foot).toBeGreaterThan(0.01)
    }
  })

  it('throws for the bilateral record shape (the working leg must be named)', () => {
    expect(() => getTemplate('hold').setup(parseParams('hold', { kind: 'copenhagen_plank' }), skel)).toThrow(/variant not implemented yet/)
  })
})
