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
  // knurled bars: the kit's knurl geometry scales v by length, so one tile is about 2.5 cm long
  const gripTex = knurlTexture().clone()
  gripTex.repeat.set(12, 1)
  gripTex.needsUpdate = true
  const grip = new MeshPhysicalMaterial({ color: '#2a2b2f', roughness: 0.42, metalness: 0.55, bumpMap: gripTex, bumpScale: 0.6 })
  const steel = new MeshPhysicalMaterial({ color: '#d3d6db', roughness: 0.26, metalness: 0.62, clearcoat: 0.2, clearcoatRoughness: 0.2 })
  const steelDark = new MeshPhysicalMaterial({ color: '#34363b', roughness: 0.35, metalness: 0.6 })
  const cable = new MeshPhysicalMaterial({ color: '#3a3c41', roughness: 0.45, metalness: 0.5 })
  const rope = new MeshPhysicalMaterial({ color: '#232427', roughness: 0.78, sheen: 0.3, sheenColor: '#5a5e68' })
  const hole = new MeshPhysicalMaterial({ color: '#5d6168', roughness: 0.9 })
  const stack = new MeshPhysicalMaterial({ color: '#8f9399', roughness: 0.34, metalness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.3 })
  const pulley = new MeshPhysicalMaterial({ color: '#2b2c30', roughness: 0.5, metalness: 0.1 })
  // exercise mat: dark gray foam, a step lighter than the pads
  const mat = new MeshPhysicalMaterial({ color: '#3c3e43', roughness: 0.92, sheen: 0.25, sheenColor: '#6e7380', sheenRoughness: 0.6 })
  return { frame, frameDark, pad, rubber, handle, plate, plateFace, grip, steel, steelDark, cable, rope, hole, stack, pulley, mat }
}

export type PropMaterials = ReturnType<typeof createPropMaterials>
export type MatKey = keyof PropMaterials

let shared: PropMaterials | null = null

/** One material set shared by every prop (never disposed; a few small materials for the app's lifetime). */
export function propMaterials(): PropMaterials {
  shared ??= createPropMaterials()
  return shared
}
