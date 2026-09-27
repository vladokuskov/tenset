import fs from 'node:fs'

export type Mesh = { positions: Float32Array; indices: Uint32Array }

// Minimal Wavefront OBJ reader: positions and triangulated faces only.
export function parseObj(text: string): Mesh {
  const pos: number[] = []
  const idx: number[] = []
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/)
      pos.push(+p[1], +p[2], +p[3])
    } else if (line.startsWith('f ')) {
      const p = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t, 10))
      const n = pos.length / 3
      const v = p.map((i) => (i < 0 ? n + i : i - 1))
      for (let k = 1; k + 1 < v.length; k++) idx.push(v[0], v[k], v[k + 1])
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) }
}

export function loadObj(file: string): Mesh {
  return parseObj(fs.readFileSync(file, 'utf8'))
}

export function bounds(m: Mesh) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < m.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = m.positions[i + k]
      if (v < min[k]) min[k] = v
      if (v > max[k]) max[k] = v
    }
  }
  return { min, max }
}
