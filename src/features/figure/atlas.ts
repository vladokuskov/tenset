import { useLoader, useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import {
  DataTexture,
  FileLoader,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NearestFilter,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  TextureLoader,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three'
import type { ResolvedHighlight } from './highlight'

// Head-level muscle atlas baked by pipeline/atlas (BodyParts3D, CC BY 4.0, modified): a region-index texture,
// a relief height map and a fibre striation map in the body's UV layout, plus the region table in atlas.json.
// At load the three maps are repacked on the GPU into two RGBA textures holding everything the skin shader used to
// gather from 14 taps (height, slopes, wide Laplacian, fibre) plus the region index, so it reads each once.

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
  /** the packed surface texture: its alpha is the region index / 255 (read with texelFetch at level 0) */
  regions: Texture
  /** packed surface: r = relief height, g = wide Laplacian of the height, b = fibre, a = region index (see ATLAS_CODEC) */
  relief: Texture
  /** packed slopes: rg = relief height difference over 3 texels (u, v), ba = fibre difference over 2 texels */
  fibre: Texture
  /** relief height range in metres */
  reliefRange: [number, number]
  /** fibre amplitude in metres */
  fibreAmp: number
}

const base = () => `${import.meta.env.BASE_URL}models/`
export const ATLAS_URL = `${base()}atlas.json`

export function useFigureAtlas(): FigureAtlas {
  const gl = useThree((s) => s.gl)
  const json = useLoader(FileLoader, ATLAS_URL) as string
  const meta = useMemo(() => JSON.parse(json) as AtlasMeta, [json])
  const t = meta.textures
  const [regions, relief, fibre] = useLoader(TextureLoader, [t.regions.file, t.relief.file, t.fibre.file].map((f) => base() + f))
  return useMemo(() => prepare(gl, meta, regions, relief, fibre), [gl, meta, regions, relief, fibre])
}

/** Signed values stored as 0.5 + 0.5 * sign * sqrt(|x| / scale): fine steps near zero, where gentle slopes live. */
export const ATLAS_CODEC = /* glsl */ `
const float ATLAS_SLOPE = 1.0;
const float ATLAS_LAP = 2.0;
const float ATLAS_FIBRE = 1.8;
float atlasEnc( float x, float s ) { return 0.5 + 0.5 * sign( x ) * sqrt( min( abs( x ) / s, 1.0 ) ); }
float atlasDec( float e, float s ) { float t = e * 2.0 - 1.0; return s * t * abs( t ); }`

const PACK_FRAG = /* glsl */ `
uniform sampler2D uRelief;
uniform sampler2D uFibre;
uniform sampler2D uRegions;
uniform int uPass;
${ATLAS_CODEC}
float h( vec2 uv ) { return textureLod( uRelief, uv, 0.0 ).r; }
float f( vec2 uv ) { return ( textureLod( uFibre, uv, 0.0 ).r - 0.502 ) * ( 255.0 / 127.0 ); }
void main() {
  vec2 t = 1.0 / vec2( textureSize( uRelief, 0 ) );
  vec2 uv = gl_FragCoord.xy * t;
  vec2 dx = vec2( t.x, 0.0 ), dy = vec2( 0.0, t.y );
  if ( uPass == 0 ) {
    float c = h( uv );
    float lap = h( uv - 4.0 * dx ) + h( uv + 4.0 * dx ) + h( uv - 4.0 * dy ) + h( uv + 4.0 * dy ) - 4.0 * c;
    float id = texelFetch( uRegions, ivec2( uv * vec2( textureSize( uRegions, 0 ) ) ), 0 ).r;
    gl_FragColor = vec4( c, atlasEnc( lap, ATLAS_LAP ), textureLod( uFibre, uv, 0.0 ).r, id );
  } else {
    gl_FragColor = vec4(
      atlasEnc( h( uv + 1.5 * dx ) - h( uv - 1.5 * dx ), ATLAS_SLOPE ), atlasEnc( h( uv + 1.5 * dy ) - h( uv - 1.5 * dy ), ATLAS_SLOPE ),
      atlasEnc( f( uv + dx ) - f( uv - dx ), ATLAS_FIBRE ), atlasEnc( f( uv + dy ) - f( uv - dy ), ATLAS_FIBRE ) );
  }
}`

type Packed = { surface: WebGLRenderTarget; slope: WebGLRenderTarget }
// render targets belong to one renderer; kept for the lifetime of the loaded textures (useLoader caches them too)
const packedCache = new WeakMap<WebGLRenderer, WeakMap<Texture, Packed>>()

function pack(gl: WebGLRenderer, regions: Texture, relief: Texture, fibre: Texture): Packed {
  let perGl = packedCache.get(gl)
  if (!perGl) packedCache.set(gl, (perGl = new WeakMap()))
  const hit = perGl.get(relief)
  if (hit) return hit
  const size = (relief.image as { width: number }).width
  const target = () => new WebGLRenderTarget(size, size, {
    depthBuffer: false, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, anisotropy: 4,
  })
  const out = { surface: target(), slope: target() }
  const mat = new ShaderMaterial({
    uniforms: { uRelief: { value: relief }, uFibre: { value: fibre }, uRegions: { value: regions }, uPass: { value: 0 } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: PACK_FRAG,
    depthTest: false,
    depthWrite: false,
  })
  const quad = new Mesh(new PlaneGeometry(2, 2), mat)
  quad.frustumCulled = false
  const scene = new Scene().add(quad)
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const prev = gl.getRenderTarget()
  for (const [i, rt] of [out.surface, out.slope].entries()) {
    mat.uniforms.uPass.value = i
    gl.setRenderTarget(rt)
    gl.render(scene, cam)
  }
  gl.setRenderTarget(prev)
  mat.dispose()
  quad.geometry.dispose()
  // the sources are only needed for packing; three uploads them again if anything samples them later
  for (const t of [regions, relief, fibre]) t.dispose()
  perGl.set(relief, out)
  return out
}

function prepare(gl: WebGLRenderer, meta: AtlasMeta, regions: Texture, relief: Texture, fibre: Texture): FigureAtlas {
  for (const t of [regions, relief, fibre]) {
    t.flipY = false
    t.colorSpace = NoColorSpace
    t.magFilter = NearestFilter
    t.minFilter = NearestFilter
    t.generateMipmaps = false
    t.needsUpdate = true
  }
  // packing reads relief and fibre bilinearly at level 0
  relief.magFilter = LinearFilter
  fibre.magFilter = LinearFilter
  const packed = pack(gl, regions, relief, fibre)
  const r = meta.textures.relief
  return {
    meta,
    regions: packed.surface.texture,
    relief: packed.surface.texture,
    fibre: packed.slope.texture,
    reliefRange: [r.minMm / 1000, r.maxMm / 1000],
    fibreAmp: meta.textures.fibre.amplitudeMm / 1000,
  }
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

/** groups whose highlight also tints the shorts over them (glutes hide under the shorts) */
export const SHORTS_TINT_GROUPS = new Set(['glute_max', 'glute_med'])

/** Region states for the mask bake (b marks highlighted regions the shorts tint over); returns whether anything is highlighted. */
export function fillHighlightLut(lut: DataTexture, meta: AtlasMeta, h: ResolvedHighlight) {
  const data = lut.image.data as Uint8Array
  data.fill(0)
  let any = false
  for (const r of meta.regions) {
    if (!r.head || (h.side && r.side !== h.side)) continue
    const p = h.primary.has(r.head)
    const s = !p && h.secondary.has(r.head)
    if (!p && !s) continue
    data.set([p ? 255 : 0, s ? 255 : 0, r.group && SHORTS_TINT_GROUPS.has(r.group) ? 255 : 0, 255], r.index * 4)
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
