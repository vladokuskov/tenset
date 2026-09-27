// Per-texel registration results, cached between register.ts and bake.ts.
import fs from 'node:fs'
import path from 'node:path'

export type Texels = {
  res: number
  /** body triangle covering the texel, -1 = outside every UV island */
  tri: Int32Array
  bary: Float32Array
  /** index into the region table (0 = none) */
  label: Uint8Array
  /** relief segment: one per BodyParts3D muscle, hand-polygon belly or occluder (0 = none) */
  segment: Uint16Array
  /** BodyParts3D skin point and normal (mm), NaN when the projection missed */
  skin: Float32Array
  skinN: Float32Array
  /** rest position on the figure (mm, figure axes) */
  rest: Float32Array
  /** skin to muscle distance (mm) */
  depth: Float32Array
}

const FIELDS = ['tri', 'bary', 'label', 'segment', 'skin', 'skinN', 'rest', 'depth'] as const
const CTORS = { tri: Int32Array, bary: Float32Array, label: Uint8Array, segment: Uint16Array, skin: Float32Array, skinN: Float32Array, rest: Float32Array, depth: Float32Array }

export function saveTexels(dir: string, t: Texels) {
  for (const f of FIELDS) fs.writeFileSync(path.join(dir, `${f}.bin`), new Uint8Array(t[f].buffer, t[f].byteOffset, t[f].byteLength))
  fs.writeFileSync(path.join(dir, 'texels.json'), JSON.stringify({ res: t.res }))
}

export function loadTexels(dir: string): Texels {
  const { res } = JSON.parse(fs.readFileSync(path.join(dir, 'texels.json'), 'utf8')) as { res: number }
  const out = { res } as Texels
  for (const f of FIELDS) {
    const b = fs.readFileSync(path.join(dir, `${f}.bin`))
    const C = CTORS[f]
    const copy = new Uint8Array(b.byteLength)
    copy.set(b)
    ;(out as Record<string, unknown>)[f] = new C(copy.buffer)
  }
  return out
}
