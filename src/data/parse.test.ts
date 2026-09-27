import { describe, expect, it } from 'vitest'
import { Exercise } from '../domain/schema.ts'
import { BENCH, OLD_INCLINE, ROW } from '../domain/test-fixtures.ts'
import { parseRecords, replacementMap } from './parse.ts'

describe('parseRecords', () => {
  it('keeps valid records and reports invalid ones', () => {
    const warnings: string[] = []
    const out = parseRecords(
      { 'b/2.json': ROW, 'a/1.json': BENCH, 'c/bad.json': { ...BENCH, id: 0, cues: [] } },
      Exercise,
      (m) => warnings.push(m),
    )
    expect(out.map((e) => e.id)).toEqual([BENCH.id, ROW.id])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/^Skipping c\/bad\.json: /)
  })
})

describe('replacementMap', () => {
  it('maps retired ids to their replacements', () => {
    expect(replacementMap([BENCH, OLD_INCLINE])).toEqual(new Map([[OLD_INCLINE.id, 2]]))
  })
})
