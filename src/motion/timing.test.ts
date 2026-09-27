import { describe, expect, it } from 'vitest'
import { DEFAULT_TEMPO, frameCount, loopDuration, minJerk, phaseAt, type Tempo } from './timing.ts'

describe('timing', () => {
  it('minimum-jerk profile has zero velocity and acceleration at both ends', () => {
    const h = 1e-4
    for (const x of [0, 1]) {
      const v = (minJerk(x + h) - minJerk(x - h)) / (2 * h)
      const a = (minJerk(x + h) - 2 * minJerk(x) + minJerk(x - h)) / (h * h)
      expect(Math.abs(v)).toBeLessThan(1e-3)
      expect(Math.abs(a)).toBeLessThan(0.05)
    }
    expect(minJerk(0.5)).toBeCloseTo(0.5, 12)
  })

  it('walks top -> eccentric -> bottom -> concentric -> top with the tempo durations', () => {
    const T = loopDuration(DEFAULT_TEMPO)
    expect(T).toBeCloseTo(3.7, 12)
    const at = (sec: number) => phaseAt(sec / T)
    expect(at(0).name).toBe('top')
    expect(at(0.3).name).toBe('ecc')
    expect(at(2.3).name).toBe('bottom')
    expect(at(2.5).name).toBe('con')
    expect(at(3.6).name).toBe('top')
    expect(at(0).c).toBe(1)
    expect(at(2.3).c).toBe(0)
  })

  it('is continuous in value, velocity and acceleration across the loop seam, with and without lag', () => {
    for (const tempo of [DEFAULT_TEMPO, [1.5, 0, 1, 0.3] as Tempo, [0.6, 0, 0.6, 0] as Tempo]) {
      for (const lag of [0, 0.03]) {
        const n = 4000
        const c = Array.from({ length: n }, (_, i) => phaseAt(i / n, tempo, lag).c)
        const d1 = c.map((v, i) => c[(i + 1) % n] - v)
        const d2 = c.map((_, i) => d1[i] - d1[(i - 1 + n) % n])
        const maxStep = Math.max(...d1.map(Math.abs))
        const maxAcc = Math.max(...d2.map(Math.abs))
        // the seam (index n-1 -> 0) is no worse than the rest of the loop
        expect(Math.abs(c[0] - c[n - 1])).toBeLessThanOrEqual(maxStep + 1e-12)
        expect(Math.abs(d2[0])).toBeLessThanOrEqual(maxAcc + 1e-12)
        expect(maxStep).toBeLessThan(0.01)
      }
    }
  })

  it('frame count follows duration x fps', () => {
    expect(frameCount(DEFAULT_TEMPO, 30)).toBe(111)
  })
})
