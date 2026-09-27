import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createRegionLut, fillDebugLut, fillHighlightLut, type AtlasMeta } from './atlas'
import { parseHighlight, resolveHighlight } from './highlight'

const meta = JSON.parse(readFileSync(new URL('../../../public/models/atlas.json', import.meta.url), 'utf8')) as AtlasMeta
const taxonomy = JSON.parse(readFileSync(new URL('../../../data/taxonomy.json', import.meta.url), 'utf8')) as {
  heads: { id: string; group: string }[]
}

const entry = (data: Uint8Array, i: number) => Array.from(data.subarray(i * 4, i * 4 + 4))
const indexOf = (head: string, side: 'l' | 'r') => meta.regions.find((r) => r.head === head && r.side === side)!.index

describe('muscle atlas', () => {
  it('has every taxonomy head on both sides, in its group, and present in the texture', () => {
    for (const h of taxonomy.heads) {
      for (const side of ['l', 'r'] as const) {
        const r = meta.regions.find((q) => q.head === h.id && q.side === side)
        expect(r, `${h.id}:${side}`).toBeDefined()
        expect(r!.group).toBe(h.group)
        expect((r as { present?: boolean }).present).toBe(true)
      }
    }
    expect(meta.regions.length).toBeLessThan(255)
  })

  it('expands groups to heads, lets primary win and keeps to one side', () => {
    const h = resolveHighlight(parseHighlight('biceps:p,forearms:s,brachialis:s,triceps_medial:s'))
    expect([...h.primary].sort()).toEqual(['biceps_brachii', 'brachialis'])
    expect(h.secondary.has('brachioradialis')).toBe(true)
    expect(h.secondary.has('brachialis')).toBe(false)
    // deep heads draw on their visible parent
    expect(h.secondary.has('triceps_lateral')).toBe(true)
  })

  it('writes region states: r = primary, g = secondary', () => {
    const lut = createRegionLut()
    const data = lut.image.data as Uint8Array
    expect(fillHighlightLut(lut, meta, resolveHighlight(parseHighlight('chest:p,triceps:s,head.pec_clavicular:s')))).toBe(true)
    expect(entry(data, indexOf('pec_sternal', 'l'))).toEqual([255, 0, 0, 255])
    expect(entry(data, indexOf('pec_clavicular', 'r'))).toEqual([255, 0, 0, 255])
    expect(entry(data, indexOf('triceps_long', 'r'))).toEqual([0, 255, 0, 255])
    expect(entry(data, indexOf('biceps_brachii', 'l'))[3]).toBe(0)
    expect(entry(data, 0)[3]).toBe(0)

    fillHighlightLut(lut, meta, resolveHighlight({ secondary: ['pec_clavicular'] }))
    expect(entry(data, indexOf('pec_clavicular', 'l'))).toEqual([0, 255, 0, 255])

    fillHighlightLut(lut, meta, resolveHighlight(parseHighlight('quads:p,side=r')))
    expect(entry(data, indexOf('rectus_femoris', 'r'))[3]).toBe(255)
    expect(entry(data, indexOf('rectus_femoris', 'l'))[3]).toBe(0)
    expect(fillHighlightLut(lut, meta, resolveHighlight(undefined))).toBe(false)
  })

  it('gives every region an opaque debug colour', () => {
    const lut = createRegionLut()
    fillDebugLut(lut, meta)
    const data = lut.image.data as Uint8Array
    for (const r of meta.regions) expect(entry(data, r.index)[3]).toBe(255)
  })
})
