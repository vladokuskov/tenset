/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import taxonomy from '../../data/taxonomy.json'
import { decodeIdRaster, encodeIdRaster, hitTest, pickGroup, viewBoxToRaster, type IdRaster } from './idRaster.ts'

// 6x2 raster: row 0 = none none A A A B, row 1 = B x6
const SYNTHETIC = new Uint8Array([
  0x47, 0x42, 0x49, 0x44, 1, 2, 6, 0, 2, 0, 60, 0, 20, 0,
  1, 0x41, 1, 0x42,
  (0 << 3) | 2, (1 << 3) | 3, (2 << 3) | 7,
])

describe('decodeIdRaster', () => {
  it('decodes a hand-built raster', () => {
    const r = decodeIdRaster(SYNTHETIC)
    expect(r).toMatchObject({ width: 6, height: 2, vbWidth: 60, vbHeight: 20, groups: ['A', 'B'] })
    expect(Array.from(r.data)).toEqual([0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2])
  })

  it('round-trips through the encoder, including long runs', () => {
    const data = new Uint8Array(300 * 7)
    data.fill(3, 17, 1900)
    data.fill(1, 1900, 1905)
    const r: IdRaster = { width: 300, height: 7, vbWidth: 816, vbHeight: 2048, groups: ['a', 'b', 'c'], data }
    const bytes = encodeIdRaster(r)
    expect(bytes.length).toBeLessThan(40)
    expect(decodeIdRaster(bytes)).toEqual(r)
  })

  it('rejects malformed input', () => {
    expect(() => decodeIdRaster(new Uint8Array(20))).toThrow(/magic/)
    expect(() => decodeIdRaster(SYNTHETIC.slice(0, -1))).toThrow(/truncated/)
    const bad = SYNTHETIC.slice()
    bad[bad.length - 1] = (3 << 3) | 7
    expect(() => decodeIdRaster(bad)).toThrow(/out of range/)
  })
})

describe('hitTest', () => {
  const r = decodeIdRaster(SYNTHETIC)

  it('ranks groups by covered cells and ignores empty cells', () => {
    const hits = hitTest(r, 3.4, 1.2, 1.2)
    expect(hits.map((h) => [h.group, h.pixels])).toEqual([['B', 3], ['A', 2]])
    expect(hits[0].share + hits[1].share).toBeCloseTo(1)
    expect(hitTest(r, 0.5, 0.5, 0.4)).toEqual([])
  })

  it('opens a group only with a clear majority', () => {
    expect(pickGroup(hitTest(r, 3, 0.5, 0.6))).toBe('A')
    expect(pickGroup([{ group: 'A', pixels: 6, share: 0.6 }, { group: 'B', pixels: 4, share: 0.4 }])).toBeNull()
    expect(pickGroup([])).toBeNull()
    const split = [{ group: 'A', pixels: 6, share: 0.6 }, { group: 'B', pixels: 4, share: 0.4 }]
    expect(pickGroup(split, 'B')).toBe('B')
    expect(pickGroup([{ group: 'A', pixels: 7, share: 0.7 }, { group: 'B', pixels: 3, share: 0.3 }], 'B')).toBe('A')
    expect(pickGroup([{ group: 'A', pixels: 5, share: 0.5 }, { group: 'B', pixels: 2, share: 0.2 }, { group: 'C', pixels: 3, share: 0.3 }], 'C')).toBeNull()
  })

  it('maps viewBox coordinates to cells', () => {
    expect(viewBoxToRaster(r, 30, 10)).toEqual([3, 1])
  })
})

// The shipped rasters: every banded group with a head drawn in a view must be tappable there.
// 1x: the UI samples a 12 px radius on a map drawn at about raster size; a group is reachable when
// it opens directly or shows up in the chooser (max 4 rows). 2x zoom: it must open directly.
describe.each([
  ['front', 'F'],
  ['back', 'B'],
])('public/anatomy/%s.ids.bin', (name, view) => {
  const raster = decodeIdRaster(new Uint8Array(readFileSync(new URL(`../../public/anatomy/${name}.ids.bin`, import.meta.url))))
  const banded = new Set(taxonomy.groups.filter((g) => g.banded).map((g) => g.id))
  const expected = [...new Set(taxonomy.heads.filter((h) => h.view.includes(view)).map((h) => h.group))].filter((g) => banded.has(g))

  const scan = (radius: number, reach: (hits: ReturnType<typeof hitTest>) => string[]) => {
    const reached = new Set<string>()
    for (let y = 0.5; y < raster.height; y += 1) {
      for (let x = 0.5; x < raster.width; x += 1) for (const g of reach(hitTest(raster, x, y, radius))) reached.add(g)
    }
    return reached
  }

  it('has the expected shape and groups', () => {
    expect(raster.vbHeight).toBe(2048)
    expect(raster.width * raster.height).toBeGreaterThan(80_000)
    for (const g of expected) expect(raster.groups).toContain(g)
    for (const g of raster.groups) expect(taxonomy.groups.some((t) => t.id === g)).toBe(true)
  })

  it('reaches every banded group at 1x', () => {
    const reached = scan(12, (hits) => {
      const pick = pickGroup(hits)
      return pick ? [pick] : hits.slice(0, 4).map((h) => h.group)
    })
    expect(expected.filter((g) => !reached.has(g))).toEqual([])
  })

  it('opens every banded group directly at 2x zoom', () => {
    const reached = scan(6, (hits) => {
      const pick = pickGroup(hits)
      return pick ? [pick] : []
    })
    expect(expected.filter((g) => !reached.has(g))).toEqual([])
  })
})
