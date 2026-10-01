import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { fk, localToWorld, segPos, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { add, angleBetween, dist, norm, qrot, RAD, scale, sub } from '../math.ts'
import { zeroQ } from '../skeleton.ts'
import { motionRecords, testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
const variants = motionRecords('row')
const baked = new Map(variants.map((v) => [v.slug, bake(getTemplate('row'), parseParams('row', v.params, v.laterality), skel)]))
const get = (id: number) => [...baked.entries()].find(([slug]) => slug.startsWith(`${id}-`))![1]
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const TOP = 0
const BOTTOM = 0.625
const CON = [2.45 / 3.7, 3.45 / 3.7]
const side = (b: Baked) => (b.params.laterality === 'unilateral' && b.params.side !== 'left' ? 'r' : 'l')
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name.replace('*', side(b))]]

/** upper arm angle from the trunk's long axis (towards the hips), deg */
function flare(b: Baked, i: number) {
  const f = fk(skel, frameQ(b, i))
  const s = side(b)
  const hum = norm(sub(segPos(skel, f, `forearm_${s}`), segPos(skel, f, `humerus_${s}`)))
  return angleBetween(hum, qrot(f.rot[skel.seg.thorax2], [0, -1, 0])) * RAD
}

/** hip joints to shoulder joints from vertical, deg */
function trunkAngle(b: Baked, i: number) {
  const f = fk(skel, frameQ(b, i))
  const hips = scale(add(segPos(skel, f, 'femur_l'), segPos(skel, f, 'femur_r')), 0.5)
  const sh = scale(add(segPos(skel, f, 'humerus_l'), segPos(skel, f, 'humerus_r')), 0.5)
  return angleBetween(sub(sh, hips), [0, 1, 0]) * RAD
}

function range(b: Baked, fn: (i: number) => number) {
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < b.frames; i++) {
    const v = fn(i)
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  return hi - lo
}

describe('row template', () => {
  it('covers every row record', () => {
    expect(variants.map((v) => v.id).sort()).toEqual([206, 304, 305, 306, 307, 312, 313, 315])
  })

  it.each([...baked.keys()])('%s: finite frames, hands on the load, planted feet still, loop closes', (slug) => {
    const b = baked.get(slug)!
    expect(b.q.every(Number.isFinite)).toBe(true)
    const first = fk(skel, frameQ(b, 0))
    for (let i = 0; i < b.frames; i++) {
      const f = fk(skel, frameQ(b, i))
      const impl = frameImplements(b, i)
      for (const c of b.contacts) {
        if (c.kind === 'planted') expect(dist(sitePos(skel, f, c.site), sitePos(skel, first, c.site))).toBeLessThan(0.002)
        if ((c.kind === 'grip' || c.kind === 'support') && 'implement' in c.target) {
          const { implement, grip } = c.target
          const k = b.implements.findIndex((s) => s.id === implement)
          expect(dist(sitePos(skel, f, c.site), siteWorld(b.implements[k], impl[k], grip).pos)).toBeLessThan(0.005)
        }
      }
    }
    // the cut sits mid top pause: last frame and first frame nearly coincide
    const step = (i: number, j: number) => Math.max(...frameQ(b, i).map((v, k) => Math.abs(v - frameQ(b, j)[k])))
    expect(step(b.frames - 1, 0)).toBeLessThan(0.5)
  })

  it.each([...baked.keys()])('%s: scapulae set back first, then the elbow drives (retraction leads)', (slug) => {
    const b = baked.get(slug)!
    const prot = (u: number) => dof(b, u, 'clavicle_*.prot')
    const elbow = (u: number) => dof(b, u, 'elbow_*.flex')
    // protracted at the stretch, retracted at the finish
    expect(prot(BOTTOM) - prot(TOP)).toBeGreaterThan(25)
    // 30 % into the concentric (tempo 2/0.2/1/0.5 s cut mid top pause: the concentric spans u 0.662..0.932)
    const u = CON[0] + 0.3 * (CON[1] - CON[0])
    const scap = (prot(BOTTOM) - prot(u)) / (prot(BOTTOM) - prot(TOP))
    const drive = (elbow(u) - elbow(BOTTOM)) / (elbow(TOP) - elbow(BOTTOM))
    expect(scap).toBeGreaterThan(drive + 0.1)
  })

  it.each([...baked.keys()])('%s: elbow ~0-15 at the stretch -> 85-150 at the finish', (slug) => {
    const b = baked.get(slug)!
    expect(dof(b, BOTTOM, 'elbow_*.flex')).toBeLessThan(15)
    // research: elbow 0 -> 90-110 rowing to the ribs; the face pull folds further (hands to the ears) and so does the
    // inverted row (the bar meets the chest, close to the shoulders)
    const [lo, hi] = b.params.finish === 'external_rotation' || b.params.posture === 'lying_supine' ? [110, 150] : [85, 130]
    const top = dof(b, TOP, 'elbow_*.flex')
    expect(top).toBeGreaterThan(lo)
    expect(top).toBeLessThan(hi)
  })

  it('neutral spine held: lumbar and thorax flexion move less than 5 deg in every row', () => {
    for (const b of baked.values()) {
      expect(range(b, (i) => frameQ(b, i)[skel.dof['lumbar.flex']] + frameQ(b, i)[skel.dof['thorax.flex']])).toBeLessThan(5)
    }
  })

  it('bent-over and one-arm rows keep the trunk at torsoAngle and the hips still (no yank)', () => {
    for (const id of [304, 307]) {
      const b = get(id)
      const torso = b.params.torsoAngle as number
      expect(Math.abs(trunkAngle(b, at(b, BOTTOM)) - torso)).toBeLessThan(6)
      expect(Math.abs(trunkAngle(b, at(b, TOP)) - torso)).toBeLessThan(6)
      expect(range(b, (i) => frameQ(b, i)[skel.dof['pelvis.tilt']])).toBeLessThan(0.5)
      expect(range(b, (i) => frameQ(b, i)[skel.dof['pelvis.ty']])).toBeLessThan(0.01)
    }
  })

  it('barbell row: the bar finishes on the lower stomach, as cue 3 says (not the ribs)', () => {
    const b = get(304)
    const i = at(b, TOP)
    const f = fk(skel, frameQ(b, i))
    const rest = fk(skel, zeroQ(skel))
    // the bar centre carried back into the standing pose through thorax1
    const r = f.rot[skel.seg.thorax1]
    const loc = qrot([-r[0], -r[1], -r[2], r[3]], sub(frameImplements(b, i)[0].pos, segPos(skel, f, 'thorax1')))
    const y = localToWorld(skel, rest, 'thorax1', loc)[1]
    // above the hip crease, below the costal margin (thorax1 origin)
    expect(y).toBeGreaterThan(sitePos(skel, rest, 'hip_crease')[1] + 0.1)
    expect(y).toBeLessThan(segPos(skel, rest, 'thorax1')[1])
    const record = JSON.parse(readFileSync(new URL('../../../data/exercises/304-barbell-row.json', import.meta.url), 'utf8'))
    expect(record.cues.some((c: string) => /stomach/.test(c))).toBe(true)
    expect(record.cues.some((c: string) => /ribs/.test(c))).toBe(false)
  })

  it('seated cable rows lean a little forward at the stretch and finish upright, the trunk settling early', () => {
    for (const id of [305, 312]) {
      const b = get(id)
      const lean = (u: number) => trunkAngle(b, at(b, u))
      expect(lean(TOP)).toBeLessThan(5)
      expect(lean(BOTTOM)).toBeGreaterThan(10)
      expect(lean(BOTTOM)).toBeLessThan(22)
      // half way through the concentric the trunk has done most of its travel
      const u = CON[0] + 0.5 * (CON[1] - CON[0])
      expect((lean(BOTTOM) - lean(u)) / (lean(BOTTOM) - lean(TOP))).toBeGreaterThan(0.6)
    }
  })

  it('elbow flare follows elbowFlare: lats rows tucked, upper-back rows wide', () => {
    expect(flare(get(305), at(get(305), TOP))).toBeLessThan(35)
    expect(flare(get(307), at(get(307), TOP))).toBeLessThan(40)
    // chest-supported: ~65 from the trunk (lead decision: 60-70)
    expect(flare(get(306), at(get(306), TOP))).toBeGreaterThan(55)
    expect(flare(get(306), at(get(306), TOP))).toBeLessThan(75)
    expect(flare(get(312), at(get(312), TOP))).toBeGreaterThan(65)
  })

  it('face pull finishes with the elbows high, upper arms externally rotated, hands beside the ears', () => {
    const b = get(206)
    const f = fk(skel, frameQ(b, at(b, TOP)))
    expect(dof(b, TOP, 'shoulder_*.elev')).toBeGreaterThan(80)
    expect(dof(b, TOP, 'shoulder_*.rot')).toBeLessThan(-45)
    const head = segPos(skel, f, 'head')
    for (const s of ['l', 'r'] as const) {
      const hand = sitePos(skel, f, `grip_${s}`)
      expect(Math.abs(hand[1] - head[1])).toBeLessThan(0.15)
      expect(Math.abs(hand[0])).toBeGreaterThan(0.2)
      expect(Math.abs(hand[0])).toBeLessThan(0.4)
    }
  })

  it('inverted row: body straight, pivoting about the heels, chest up to the bar', () => {
    const b = get(313)
    for (const u of [TOP, BOTTOM]) {
      expect(Math.abs(dof(b, u, 'hip_l.flex'))).toBeLessThan(8)
      expect(dof(b, u, 'knee_l.flex')).toBeLessThan(8)
    }
    // the body rises: trunk angle from vertical smaller at the top
    expect(trunkAngle(b, at(b, BOTTOM)) - trunkAngle(b, at(b, TOP))).toBeGreaterThan(10)
    const f = fk(skel, frameQ(b, at(b, TOP)))
    const bar = frameImplements(b, at(b, TOP))[0].pos
    expect(bar[1] - segPos(skel, f, 'thorax2')[1]).toBeLessThan(0.25)
  })

  it('unsupported variants throw', () => {
    const t = getTemplate('row')
    expect(() => t.setup(parseParams('row', { implement: 'machine', posture: 'seated' }), skel)).toThrow(/variant not implemented yet/)
    expect(() => t.setup(parseParams('row', { implement: 'dumbbell', posture: 'kneeling' }), skel)).toThrow(/variant not implemented yet/)
  })
})
