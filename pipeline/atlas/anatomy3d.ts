// The BodyParts3D scene the atlas projects onto: region parts and occluders from pipeline/anatomy/fma-map.json
// (the same superficial-muscle decisions as the 2D map), merged into one BVH with a per-triangle element tag.
import fs from 'node:fs'
import path from 'node:path'
import { DATA, ROOT } from '../lib/paths.ts'
import { bpMesh, conceptFiles, type Side } from './bp3d.ts'
import { Bvh, mergeMeshes } from './bvh.ts'

type Line = [[number, number], [number, number]]
export type Clip = { zMin?: number; zMax?: number; above?: Line; below?: Line }
type ViewClip = Partial<Record<'F' | 'B', Clip>>
type SideRef = { name: string; fma: string; files: string[] }
type Part = { deep?: string; clip?: ViewClip; maxThicknessMm?: number; overrides?: string[]; l: SideRef; r: SideRef }
type Region = { id: string; kind: 'head' | 'untracked'; group: string | null; views: ('F' | 'B')[]; clip?: ViewClip; source: string; parts: Part[] }
type FmaMap = { skin: SideRef; regions: Region[]; occluders: { files: string[] } }
export type HandRegion = {
  view: 'F' | 'B'
  override?: string[]
  polygon: [number, number][]
  gaps?: { line: [number, number][]; widthMm: number }[]
}

export const fmaMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline/anatomy/fma-map.json'), 'utf8')) as FmaMap
export const handRegions = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline/anatomy/hand-regions.json'), 'utf8')) as Record<string, HandRegion>
export const taxonomy = JSON.parse(fs.readFileSync(path.join(DATA, 'taxonomy.json'), 'utf8')) as {
  groups: { id: string }[]
  heads: { id: string; group: string; view: string }[]
  untracked: { id: string; view: string }[]
}

/** One row of the region table: index = position + 1 (0 = no region). */
export type RegionEntry = { id: string; group: string | null; side: Side; views: ('F' | 'B')[]; untracked: boolean }

export type Alt = { label: number; clip: Clip[]; maxThickness?: number; segment: number }
export type Element = { file: string; side: Side | null; alts: Alt[]; overrides: number[] }
export type Segment = { key: string; concept: string; label: number; side: Side | null; files: string[] }

export function buildTables() {
  const regions: RegionEntry[] = []
  const labelOf = new Map<string, number>()
  for (const r of fmaMap.regions) {
    for (const side of ['l', 'r'] as Side[]) {
      regions.push({ id: r.id, group: r.group, side, views: r.views, untracked: r.kind === 'untracked' })
      labelOf.set(`${r.id}:${side}`, regions.length)
    }
  }
  const segments: Segment[] = []
  const segmentOf = new Map<string, number>()
  const segment = (key: string, concept: string, label: number, side: Side | null, files: string[]) => {
    let s = segmentOf.get(key)
    if (s === undefined) {
      segments.push({ key, concept, label, side, files })
      s = segments.length
      segmentOf.set(key, s)
    }
    return s
  }
  const elements = new Map<string, Element>()
  const elementFor = (file: string, side: Side | null) => {
    const k = `${file}:${side}`
    let e = elements.get(k)
    if (!e) {
      e = { file, side, alts: [], overrides: [] }
      elements.set(k, e)
    }
    return e
  }
  for (const r of fmaMap.regions) {
    for (const part of r.parts) {
      for (const side of ['l', 'r'] as Side[]) {
        const label = labelOf.get(`${r.id}:${side}`)!
        const clips = [r.clip?.F ?? r.clip?.B, part.clip?.F ?? part.clip?.B].filter((c): c is Clip => !!c)
        const ref = part[side]
        const seg = segment(`${r.id}:${ref.name}`, ref.name, label, side, ref.files)
        for (const f of ref.files) {
          const e = elementFor(f, side)
          e.alts.push({ label, clip: clips, maxThickness: part.maxThicknessMm, segment: seg })
          for (const o of part.overrides ?? []) e.overrides.push(labelOf.get(`${o}:${side}`)!)
        }
      }
    }
  }
  for (const f of fmaMap.occluders.files) {
    const e = elementFor(f, null)
    e.alts.push({ label: 0, clip: [], segment: segment(`occ:${f}`, f, 0, null, [f]) })
  }
  return { regions, labelOf, segments, elements: [...elements.values()] }
}

export type Tables = ReturnType<typeof buildTables>

/** Muscles and bones as one BVH; tag = index into tables.elements. Mirrored ("M") files are the left side. */
export function buildScene(tables: Tables) {
  const parts = tables.elements.map((e, tag) => {
    const m = bpMesh(e.file)
    if (!e.side) return { positions: m.positions, indices: m.indices, tag }
    // drop stray triangles across the midline, as the 2D bake does
    const sign = e.side === 'l' ? 1 : -1
    const keep: number[] = []
    for (let t = 0; t < m.indices.length; t += 3) {
      const cx = (m.positions[m.indices[t] * 3] + m.positions[m.indices[t + 1] * 3] + m.positions[m.indices[t + 2] * 3]) / 3
      if (cx * sign > -15) keep.push(m.indices[t], m.indices[t + 1], m.indices[t + 2])
    }
    return { positions: m.positions, indices: Uint32Array.from(keep), tag }
  })
  const merged = mergeMeshes(parts)
  return { ...merged, bvh: new Bvh(merged.positions, merged.indices) }
}

export function skinScene() {
  const m = bpMesh(conceptFiles('skin')[0])
  const normals = vertexNormals(m.positions, m.indices)
  return { positions: m.positions, indices: m.indices, normals, bvh: new Bvh(m.positions, m.indices) }
}

export function vertexNormals(P: Float32Array, I: Uint32Array) {
  const N = new Float32Array(P.length)
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2]
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    for (const i of [a, b, c]) {
      N[i] += nx
      N[i + 1] += ny
      N[i + 2] += nz
    }
  }
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1
    N[i] /= l
    N[i + 1] /= l
    N[i + 2] /= l
  }
  return N
}

export function lineZ(line: Line | [number, number][], lat: number) {
  const [[l0, z0], [l1, z1]] = line
  return z0 + ((lat - l0) * (z1 - z0)) / (l1 - l0)
}

/** Clips use body millimetres: lateral distance from the midline (toward `side`) and height. */
export function passesClips(clips: Clip[], lat: number, z: number) {
  for (const c of clips) {
    if (c.zMin !== undefined && z < c.zMin) return false
    if (c.zMax !== undefined && z > c.zMax) return false
    if (c.above && z < lineZ(c.above, lat)) return false
    if (c.below && z > lineZ(c.below, lat)) return false
  }
  return true
}
