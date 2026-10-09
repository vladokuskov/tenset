import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FAMILIES, FAMILY_NAMES, familyExercises, familyOf, S1_TEMPLATES } from './families.ts'
import { TEMPLATE_IDS, TEMPLATES } from './templates/index.ts'

const dir = new URL('../../data/exercises/', import.meta.url)
const records = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as { id: number; media: { template: string | null } })

describe('template families', () => {
  it('put every template in exactly one family, or in the approved S1 set', () => {
    const owned = FAMILY_NAMES.flatMap((n) => Object.keys(FAMILIES[n].templates))
    expect(new Set(owned).size).toBe(owned.length)
    expect([...owned, ...S1_TEMPLATES].sort()).toEqual([...TEMPLATE_IDS].sort())
    for (const t of S1_TEMPLATES) expect(familyOf(t)).toBeNull()
    expect(familyOf('row')).toBe('back')
  })

  it("list each exercise under its record's template, and every record of a family template", () => {
    const byId = new Map(records.map((r) => [r.id, r.media.template]))
    const mismatches: string[] = []
    for (const n of FAMILY_NAMES) {
      for (const [template, ids] of Object.entries(FAMILIES[n].templates)) {
        for (const id of ids!) if (byId.get(id) !== template) mismatches.push(`${id}: record ${byId.get(id)}, family ${n} says ${template}`)
      }
    }
    expect(mismatches).toEqual([])
    const listed = new Set(FAMILY_NAMES.flatMap((n) => Object.values(FAMILIES[n].templates).flat()))
    const unlisted = records.filter((r) => r.media.template && familyOf(r.media.template) && !listed.has(r.id)).map((r) => r.id)
    expect(unlisted).toEqual([])
  })

  it('resolve a family by code or name', () => {
    expect(familyExercises('F1')).toEqual([101, 102, 103, 107, 108, 109, 116, 117, 118, 119, 120, 121, 122, 123, 124, 128, 135, 136, 707])
    expect(familyExercises('press-horizontal')).toEqual(familyExercises('f1'))
    expect(() => familyExercises('F10')).toThrow(/unknown family/)
  })

  it('keep the S1 templates implemented', () => {
    for (const t of S1_TEMPLATES) expect(TEMPLATES[t].implemented).toBe(true)
  })
})
