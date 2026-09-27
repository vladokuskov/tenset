import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isTemplateId, parseParams, SCHEMAS } from './templates/index.ts'

type ExerciseRecord = { id: number; slug: string; laterality: string; media: { template: string | null; params: Record<string, unknown> } }

const dir = new URL('../../data/exercises/', import.meta.url)
const records = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as ExerciseRecord)
const animated = records.filter((r) => r.media.template !== null)

describe('exercise media.params', () => {
  it('loads the catalog', () => {
    expect(animated.length).toBeGreaterThanOrEqual(100)
  })

  it.each(animated.map((r) => [`${r.id} ${r.slug}`, r] as const))('%s parses with its template schema', (_, r) => {
    const t = r.media.template!
    expect(isTemplateId(t)).toBe(true)
    // laterality lives on the record, never in media.params
    expect(r.media.params).not.toHaveProperty('laterality')
    const strict = SCHEMAS[t as keyof typeof SCHEMAS].safeParse(r.media.params)
    expect(strict.success ? [] : strict.error.issues).toEqual([])
    expect(parseParams(t, r.media.params, r.laterality).laterality).toBe(r.laterality)
  })
})
