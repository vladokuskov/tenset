import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bake, frameImplements, frameQ, type Baked } from '../bake.ts'
import { fk, sitePos } from '../fk.ts'
import { siteWorld } from '../implements.ts'
import { dist } from '../math.ts'
import { testSkeleton } from '../testing.ts'
import { getTemplate, parseParams } from './index.ts'

const skel = testSkeleton()
type Variant = { slug: string; template: string; laterality: string; params: Record<string, unknown> }
const variants = (JSON.parse(readFileSync(new URL('../../../data/motion-templates/variants.json', import.meta.url), 'utf8')) as Variant[]).filter((v) => v.template === 'vertical-pull')
const baked = new Map(variants.map((v) => [v.slug, bake(getTemplate('vertical-pull'), parseParams('vertical-pull', v.params, v.laterality), skel)]))
const get = (slug: string) => baked.get(slug)!
const at = (b: Baked, u: number) => Math.round(u * b.frames) % b.frames
const dof = (b: Baked, u: number, name: string) => frameQ(b, at(b, u))[skel.dof[name]]

function gripError(b: Baked) {
  let worst = 0
  for (let i = 0; i < b.frames; i++) {
    const f = fk(skel, frameQ(b, i))
    const impl = frameImplements(b, i)
    for (const c of b.contacts) {
      if (c.kind !== 'grip' || !('implement' in c.target)) continue
      const { implement, grip } = c.target
      const k = b.implements.findIndex((s) => s.id === implement)
      worst = Math.max(worst, dist(sitePos(skel, f, c.site), siteWorld(b.implements[k], impl[k], grip).pos))
    }
  }
  return worst
}

describe('vertical-pull template', () => {
  it.each([...baked.keys()])('%s: hands stay on the bar', (slug) => {
    expect(gripError(get(slug))).toBeLessThan(0.005)
  })

  it('pull-up: dead hang with elevated shoulders to chin over the bar with the scapulae down', () => {
    const b = get('301-pull-up')
    expect(dof(b, 0.625, 'elbow_l.flex')).toBeLessThan(8)
    expect(dof(b, 0.625, 'shoulder_l.elev')).toBeGreaterThan(155)
    expect(dof(b, 0, 'elbow_l.flex')).toBeGreaterThan(110)
    expect(dof(b, 0, 'shoulder_l.elev')).toBeLessThan(75)
    expect(dof(b, 0.625, 'clavicle_l.elev')).toBeGreaterThan(dof(b, 0, 'clavicle_l.elev') + 15)
    const top = fk(skel, frameQ(b, 0))
    expect(sitePos(skel, top, 'chin')[1]).toBeGreaterThan(frameImplements(b, 0)[0].pos[1])
  })

  it('pulldowns fix the pelvis to the seat and bring the bar past the face to the chest', () => {
    for (const slug of ['303-lat-pulldown', '311-close-grip-pulldown']) {
      const b = get(slug)
      const hip0 = sitePos(skel, fk(skel, frameQ(b, 0)), 'hip_crease')
      let minAhead = Infinity
      for (let i = 0; i < b.frames; i += 2) {
        const f = fk(skel, frameQ(b, i))
        expect(dist(sitePos(skel, f, 'hip_crease'), hip0)).toBeLessThan(0.03)
        const bar = frameImplements(b, i)[0].pos
        const chin = sitePos(skel, f, 'chin')
        if (Math.abs(bar[1] - chin[1]) < 0.1) minAhead = Math.min(minAhead, bar[2] - chin[2])
      }
      expect(minAhead).toBeGreaterThan(0.03)
      expect(dof(b, 0.625, 'elbow_l.flex')).toBeLessThan(20)
      expect(dof(b, 0, 'elbow_l.flex')).toBeGreaterThan(100)
    }
  })

  it('assisted pull-up kneels on a pad that rides with the knees', () => {
    const b = get('302-assisted-pull-up')
    expect(dof(b, 0.3, 'knee_l.flex')).toBeCloseTo(90, 0)
    const pad = (i: number) => frameImplements(b, i)[1].pos[1]
    expect(pad(at(b, 0)) - pad(at(b, 0.625))).toBeGreaterThan(0.3)
  })
})
