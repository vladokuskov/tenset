// Verifies that each figure mesh's TEXCOORD_0 is non-overlapping and writes its UV layout for texture baking.
// node pipeline/body/uv-check.ts [public/models/body.glb] [--out qa/out/s1v2]
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { PNG } from 'pngjs'
import { ROOT } from '../lib/paths.ts'

const RES = 1024

async function main() {
  const args = process.argv.slice(2)
  const file = path.resolve(ROOT, args.find((a) => a.endsWith('.glb')) ?? 'public/models/body.glb')
  const out = args.includes('--out') ? path.resolve(ROOT, args[args.indexOf('--out') + 1]) : null
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  const doc = await io.read(file)
  let failed = false
  for (const node of doc.getRoot().listNodes()) {
    const prim = node.getMesh()?.listPrimitives()[0]
    const uv = prim?.getAttribute('TEXCOORD_0')
    if (!prim || !uv) continue
    const idx = prim.getIndices()!.getArray()!
    const cover = new Uint16Array(RES * RES)
    const a = [0, 0], b = [0, 0], c = [0, 0]
    const winding = [0, 0]
    for (let t = 0; t < idx.length; t += 3) {
      uv.getElement(idx[t], a)
      uv.getElement(idx[t + 1], b)
      uv.getElement(idx[t + 2], c)
      const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
      if (Math.abs(d) < 1e-14) continue
      winding[d > 0 ? 0 : 1]++
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]) * RES))
      const x1 = Math.min(RES - 1, Math.ceil(Math.max(a[0], b[0], c[0]) * RES))
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]) * RES))
      const y1 = Math.min(RES - 1, Math.ceil(Math.max(a[1], b[1], c[1]) * RES))
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = (x + 0.5) / RES, py = (y + 0.5) / RES
          const l0 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / d
          const l1 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / d
          if (l0 > 1e-6 && l1 > 1e-6 && 1 - l0 - l1 > 1e-6) cover[y * RES + x]++
        }
      }
    }
    let used = 0, overlap = 0
    for (const v of cover) {
      if (v) used++
      if (v > 1) overlap++
    }
    // the eyes use a planar projection per eyeball (both hemispheres share it by design); shells reuse proxy UVs
    const strict = node.getName() === 'body'
    const flipped = Math.min(...winding)
    const ok = !strict || (overlap === 0 && flipped === 0)
    failed ||= !ok
    console.log(JSON.stringify({ mesh: node.getName(), used: +(used / (RES * RES)).toFixed(3), overlapTexels: overlap, flipped, strict, ok }))
    if (out) {
      const png = new PNG({ width: RES, height: RES })
      for (let i = 0; i < RES * RES; i++) {
        const v = cover[(RES - 1 - Math.floor(i / RES)) * RES + (i % RES)]
        const [r, g, bl] = v === 0 ? [255, 255, 255] : v === 1 ? [150, 150, 150] : [220, 40, 20]
        png.data.set([r, g, bl, 255], i * 4)
      }
      mkdirSync(out, { recursive: true })
      writeFileSync(path.join(out, `uv-${node.getName()}.png`), PNG.sync.write(png))
    }
  }
  if (failed) throw new Error('body UVs overlap')
}

await main()
