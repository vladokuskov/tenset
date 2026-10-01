import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bake, decode, encode, staleReason } from '../../../motion/bake.ts'
import { getTemplate, isTemplateId, parseParams, TEMPLATES } from '../../../motion/templates/index.ts'
import { testSkeleton } from '../../../motion/testing.ts'
import type { MotionFile } from './library.ts'

// Stale-media guard for the shipped loops. Re-bake per exercise with node pipeline/motion/bake-motion.ts --only <ids>
// (or --family F1). BAKE_MOTION=1 pnpm vitest run src/features/figure/motion/bake.test.ts re-bakes every exercise
// whose template variant is implemented and deletes the rest of baked/, so never use it while families run in parallel.

const skel = testSkeleton()
const DATA = new URL('../../../../data/exercises/', import.meta.url)
const OUT = new URL('./baked/', import.meta.url)

type Rec = { id: number; slug: string; laterality: string; media: { template: string | null; params: Record<string, unknown> } }

function playable() {
  const out: { file: string; rec: Rec; params: Record<string, unknown> }[] = []
  for (const f of readdirSync(DATA).filter((x) => x.endsWith('.json')).sort()) {
    const rec = JSON.parse(readFileSync(new URL(f, DATA), 'utf8')) as Rec
    const t = rec.media.template
    if (!isTemplateId(t) || !TEMPLATES[t].implemented) continue
    const params = parseParams(t, rec.media.params, rec.laterality)
    try {
      TEMPLATES[t].setup(params, skel)
    } catch {
      continue
    }
    out.push({ file: `${rec.id}-${rec.slug}.json`, rec, params })
  }
  return out
}

const records = playable()

if (process.env.BAKE_MOTION) {
  for (const f of readdirSync(OUT).filter((x) => x.endsWith('.json'))) if (!records.some((r) => r.file === f)) unlinkSync(new URL(f, OUT))
  for (const { file, rec, params } of records) {
    const motion = encode(bake(getTemplate(rec.media.template!), params, skel), skel)
    const out: MotionFile = { id: rec.id, slug: `${rec.id}-${rec.slug}`, motion }
    writeFileSync(new URL(file, OUT), JSON.stringify(out) + '\n')
  }
}

describe('baked motion files', () => {
  const files = readdirSync(OUT).filter((x) => x.endsWith('.json')).sort()

  it('exist for exactly the exercises whose template variant is implemented', () => {
    expect(files).toEqual(records.map((r) => r.file).sort())
  })

  it('match their record and the current skeleton (re-bake with BAKE_MOTION=1)', () => {
    for (const { file, rec, params } of records) {
      const m = JSON.parse(readFileSync(new URL(file, OUT), 'utf8')) as MotionFile
      expect(m.id, file).toBe(rec.id)
      expect(m.motion.template, file).toBe(rec.media.template)
      expect(JSON.parse(JSON.stringify(m.motion.params)), file).toEqual(JSON.parse(JSON.stringify(params)))
      expect(staleReason(m.motion, skel), file).toBeNull()
      expect(decode(m.motion, skel).frames, file).toBeGreaterThan(30)
    }
  })

  it('match a fresh bake of the current templates (re-bake with BAKE_MOTION=1)', () => {
    for (const { file, rec, params } of records) {
      const m = JSON.parse(readFileSync(new URL(file, OUT), 'utf8')) as MotionFile
      const fresh = encode(bake(getTemplate(rec.media.template!), params, skel), skel)
      expect(JSON.stringify(m.motion) === JSON.stringify(fresh), `${file} is stale against its template`).toBe(true)
    }
  }, 180_000)
})
