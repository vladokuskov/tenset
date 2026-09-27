import { DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshPhysicalMaterial, NoColorSpace, RedFormat, RepeatWrapping } from 'three'

// Equipment look: clean white / light-gray powder-coated frames, black pads and grips, gray plates.

let knurl: DataTexture | null = null

/** Diamond knurl height pattern, generated (one tile). */
export function knurlTexture() {
  if (knurl) return knurl
  const n = 64
  const data = new Uint8Array(n * n)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n, v = y / n
      const a = Math.abs(((u + v) * 4) % 1 - 0.5), b = Math.abs(((u - v + 1) * 4) % 1 - 0.5)
      data[y * n + x] = Math.round(255 * Math.min(a, b) * 2)
    }
  }
  knurl = new DataTexture(data, n, n, RedFormat)
  knurl.colorSpace = NoColorSpace
  knurl.wrapS = knurl.wrapT = RepeatWrapping
  knurl.magFilter = LinearFilter
  knurl.minFilter = LinearMipmapLinearFilter
  knurl.generateMipmaps = true
  knurl.needsUpdate = true
  return knurl
}

export function createPropMaterials() {
  const frame = new MeshPhysicalMaterial({ color: '#e6e8eb', roughness: 0.34, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.3 })
  const frameDark = new MeshPhysicalMaterial({ color: '#b9bdc3', roughness: 0.4, metalness: 0.35 })
  const pad = new MeshPhysicalMaterial({ color: '#1d1e21', roughness: 0.58, sheen: 0.4, sheenColor: '#6e7380', sheenRoughness: 0.5 })
  const rubber = new MeshPhysicalMaterial({ color: '#26272a', roughness: 0.85 })
  const handle = new MeshPhysicalMaterial({ color: '#2a2b2f', roughness: 0.42, metalness: 0.55, bumpMap: knurlTexture(), bumpScale: 0.6 })
  handle.bumpMap!.repeat.set(10, 3)
  const plate = new MeshPhysicalMaterial({ color: '#8d9197', roughness: 0.36, metalness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.35 })
  const plateFace = new MeshPhysicalMaterial({ color: '#a4a8ae', roughness: 0.3, metalness: 0.5 })
  return { frame, frameDark, pad, rubber, handle, plate, plateFace }
}

export type PropMaterials = ReturnType<typeof createPropMaterials>
