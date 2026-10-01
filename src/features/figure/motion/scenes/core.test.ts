import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createRegionLut, fillHighlightLut, type AtlasMeta } from '../../atlas'
import { resolveHighlight } from '../../highlight'
import { motionHighlight, type MotionExercise } from '../compose'

// F9 core scenes: the highlight each loop draws.

const meta = JSON.parse(readFileSync(new URL('../../../../../public/models/atlas.json', import.meta.url), 'utf8')) as AtlasMeta
const DATA = new URL('../../../../../data/exercises/', import.meta.url)
const record = (id: number) => JSON.parse(readFileSync(new URL(readdirSync(DATA).find((f) => f.startsWith(`${id}-`))!, DATA), 'utf8'))

describe('F9 core scenes', () => {
  it.each([802, 806, 807])('%s: the hip_flexors primary shows, tinting the shorts over the iliopsoas it sits under', (id) => {
    const ex = record(id) as MotionExercise & { media: { template: string; params: Record<string, unknown> } }
    expect(ex.groups.hip_flexors).toBe('primary')
    const lut = createRegionLut()
    fillHighlightLut(lut, meta, resolveHighlight(motionHighlight(ex, ex.media.params, ex.media.template)))
    const data = lut.image.data as Uint8Array
    for (const side of ['l', 'r']) {
      const r = meta.regions.find((q) => q.head === 'iliopsoas' && q.side === side)!
      // red = primary, blue = the shorts tint over it
      expect(Array.from(data.subarray(r.index * 4, r.index * 4 + 4))).toEqual([255, 0, 255, 255])
    }
  })
})
