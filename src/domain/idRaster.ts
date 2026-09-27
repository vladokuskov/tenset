// Group-index raster used for body map tap hit-testing ({front,back}.ids.bin).
// Format (little-endian), documented in pipeline/anatomy/README.md:
//   "GBID" | u8 version=1 | u8 groupCount | u16 width | u16 height | u16 vbWidth | u16 vbHeight
//   groupCount x (u8 byteLength, ASCII group id)   -> group index 1..groupCount, 0 = no group
//   runs until width*height cells: byte b, value = b >> 3, n = b & 7;
//   n > 0: run of n cells; n = 0: run of 8 + LEB128 varint cells.

export type IdRaster = {
  width: number
  height: number
  vbWidth: number
  vbHeight: number
  groups: string[] // groups[i - 1] is the group for index i
  data: Uint8Array // row-major group index per cell
}

export type HitCandidate = { group: string; pixels: number; share: number }

const MAGIC = [0x47, 0x42, 0x49, 0x44] // GBID
const VERSION = 1
const MAX_GROUPS = 31

export function decodeIdRaster(bytes: Uint8Array): IdRaster {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 14 || MAGIC.some((m, i) => bytes[i] !== m)) throw new Error('idRaster: bad magic')
  if (bytes[4] !== VERSION) throw new Error(`idRaster: unsupported version ${bytes[4]}`)
  const groupCount = bytes[5]
  const width = view.getUint16(6, true)
  const height = view.getUint16(8, true)
  const vbWidth = view.getUint16(10, true)
  const vbHeight = view.getUint16(12, true)
  let p = 14
  const groups: string[] = []
  for (let g = 0; g < groupCount; g++) {
    const len = bytes[p++]
    let id = ''
    for (let k = 0; k < len; k++) id += String.fromCharCode(bytes[p++])
    groups.push(id)
  }
  const total = width * height
  const data = new Uint8Array(total)
  let at = 0
  while (at < total) {
    if (p >= bytes.length) throw new Error('idRaster: truncated runs')
    const b = bytes[p++]
    const value = b >> 3
    let n = b & 7
    if (n === 0) {
      let extra = 0, shift = 0, byte = 0
      do {
        if (p >= bytes.length) throw new Error('idRaster: truncated varint')
        byte = bytes[p++]
        extra |= (byte & 0x7f) << shift
        shift += 7
      } while (byte & 0x80)
      n = 8 + extra
    }
    if (value > groupCount) throw new Error(`idRaster: group index ${value} out of range`)
    if (at + n > total) throw new Error('idRaster: run overflows raster')
    data.fill(value, at, at + n)
    at += n
  }
  if (p !== bytes.length) throw new Error('idRaster: trailing bytes')
  return { width, height, vbWidth, vbHeight, groups, data }
}

export function encodeIdRaster(r: IdRaster): Uint8Array {
  if (r.groups.length > MAX_GROUPS) throw new Error(`idRaster: at most ${MAX_GROUPS} groups`)
  if (r.data.length !== r.width * r.height) throw new Error('idRaster: data size mismatch')
  const out: number[] = [...MAGIC, VERSION, r.groups.length]
  const u16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff)
  u16(r.width)
  u16(r.height)
  u16(r.vbWidth)
  u16(r.vbHeight)
  for (const g of r.groups) {
    if (!/^[\x20-\x7e]{1,255}$/.test(g)) throw new Error(`idRaster: bad group id ${g}`)
    out.push(g.length, ...Array.from(g, (ch) => ch.charCodeAt(0)))
  }
  for (let i = 0; i < r.data.length; ) {
    const value = r.data[i]
    if (value > r.groups.length) throw new Error(`idRaster: group index ${value} out of range`)
    let n = 1
    while (i + n < r.data.length && r.data[i + n] === value) n++
    i += n
    if (n < 8) {
      out.push((value << 3) | n)
    } else {
      out.push(value << 3)
      let extra = n - 8
      do {
        const byte = extra & 0x7f
        extra >>>= 7
        out.push(extra ? byte | 0x80 : byte)
      } while (extra)
    }
  }
  return new Uint8Array(out)
}

// Maps SVG viewBox coordinates to raster cell coordinates.
export function viewBoxToRaster(r: IdRaster, x: number, y: number): [number, number] {
  return [(x * r.width) / r.vbWidth, (y * r.height) / r.vbHeight]
}

// Groups under a disc of radiusPx cells around (x, y) in raster coordinates, ranked by cell count.
// share is relative to all group cells hit (empty cells don't count).
export function hitTest(r: IdRaster, x: number, y: number, radiusPx: number): HitCandidate[] {
  const counts = new Map<number, number>()
  let total = 0
  const r2 = radiusPx * radiusPx
  const y0 = Math.max(0, Math.floor(y - radiusPx)), y1 = Math.min(r.height - 1, Math.floor(y + radiusPx))
  const x0 = Math.max(0, Math.floor(x - radiusPx)), x1 = Math.min(r.width - 1, Math.floor(x + radiusPx))
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const dx = cx + 0.5 - x, dy = cy + 0.5 - y
      if (dx * dx + dy * dy > r2) continue
      const v = r.data[cy * r.width + cx]
      if (!v) continue
      counts.set(v, (counts.get(v) ?? 0) + 1)
      total++
    }
  }
  return [...counts.entries()]
    .map(([v, pixels]) => ({ group: r.groups[v - 1], pixels, share: pixels / total }))
    .sort((a, b) => b.pixels - a.pixels || a.group.localeCompare(b.group))
}

// The group a tap opens directly, or null when the UI should show a chooser.
export function pickGroup(candidates: HitCandidate[], threshold = 0.7): string | null {
  return candidates.length && candidates[0].share >= threshold ? candidates[0].group : null
}
