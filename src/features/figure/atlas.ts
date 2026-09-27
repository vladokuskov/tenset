import { useLoader } from '@react-three/fiber'
import { useMemo } from 'react'
import { DataTexture, FileLoader, LinearFilter, LinearMipmapLinearFilter, NearestFilter, NoColorSpace, RGBAFormat, TextureLoader, type Texture } from 'three'
import type { ResolvedHighlight } from './highlight'

// Head-level muscle atlas baked by pipeline/atlas (BodyParts3D, CC BY 4.0, modified): a region-index texture,
// a relief height map and a fibre striation map in the body's UV layout, plus the region table in atlas.json.

export type AtlasRegion = {
  index: number
  head: string | null
  untracked?: string
  group: string | null
  side: 'l' | 'r'
  views: string
}

export type AtlasMeta = {
  textures: {
    regions: { file: string; size: number }
    relief: { file: string; size: number; minMm: number; maxMm: number }
    fibre: { file: string; size: number; amplitudeMm: number }
  }
  regions: AtlasRegion[]
}

export type FigureAtlas = {
  meta: AtlasMeta
  regions: Texture
  relief: Texture
  fibre: Texture
  /** relief height range in metres */
  reliefRange: [number, number]
  /** fibre amplitude in metres */
  fibreAmp: number
}

const base = () => `${import.meta.env.BASE_URL}models/`
export const ATLAS_URL = `${base()}atlas.json`

export function useFigureAtlas(): FigureAtlas {
  const json = useLoader(FileLoader, ATLAS_URL) as string
  const meta = useMemo(() => JSON.parse(json) as AtlasMeta, [json])
  const t = meta.textures
  const [regions, relief, fibre] = useLoader(TextureLoader, [t.regions.file, t.relief.file, t.fibre.file].map((f) => base() + f))
  return useMemo(() => prepare(meta, regions, relief, fibre), [meta, regions, relief, fibre])
}

function prepare(meta: AtlasMeta, regions: Texture, relief: Texture, fibre: Texture): FigureAtlas {
  for (const t of [regions, relief, fibre]) {
    t.flipY = false
    t.colorSpace = NoColorSpace
    t.needsUpdate = true
  }
  regions.magFilter = NearestFilter
  regions.minFilter = NearestFilter
  regions.generateMipmaps = false
  for (const t of [relief, fibre]) {
    t.magFilter = LinearFilter
    t.minFilter = LinearMipmapLinearFilter
    t.generateMipmaps = true
    t.anisotropy = 4
  }
  const r = meta.textures.relief
  return { meta, regions, relief, fibre, reliefRange: [r.minMm / 1000, r.maxMm / 1000], fibreAmp: meta.textures.fibre.amplitudeMm / 1000 }
}

/** 256 x 1 RGBA lookup indexed by region: highlight state (r = primary, g = secondary) or, in QA, a flat colour. */
export function createRegionLut() {
  const t = new DataTexture(new Uint8Array(256 * 4), 256, 1, RGBAFormat)
  t.colorSpace = NoColorSpace
  t.magFilter = NearestFilter
  t.minFilter = NearestFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Region states for the mask bake; returns whether anything is highlighted. */
export function fillHighlightLut(lut: DataTexture, meta: AtlasMeta, h: ResolvedHighlight) {
  const data = lut.image.data as Uint8Array
  data.fill(0)
  let any = false
  for (const r of meta.regions) {
    if (!r.head || (h.side && r.side !== h.side)) continue
    const p = h.primary.has(r.head)
    const s = !p && h.secondary.has(r.head)
    if (!p && !s) continue
    data.set([p ? 255 : 0, s ? 255 : 0, 0, 255], r.index * 4)
    any = true
  }
  lut.needsUpdate = true
  return any
}

// same palette as the 2D map QA (pipeline/anatomy/qa-map.ts), so flat renders compare side by side
function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}

export function regionDebugColor(r: AtlasRegion | null): [number, number, number] {
  if (!r) return hex('#d9d6d0')
  if (!r.head) return hex('#b9b4ab')
  let h = 2166136261
  for (const c of r.head) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  h = h >>> 0
  return hsl(h % 360, 55 + ((h >> 9) % 30), 48 + ((h >> 17) % 18))
}

export function fillDebugLut(lut: DataTexture, meta: AtlasMeta) {
  const data = lut.image.data as Uint8Array
  data.set([...regionDebugColor(null), 255], 0)
  for (const r of meta.regions) data.set([...regionDebugColor(r), 255], r.index * 4)
  lut.needsUpdate = true
}
