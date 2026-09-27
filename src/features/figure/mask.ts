import { LinearFilter, LinearMipmapLinearFilter, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, WebGLRenderTarget, type Texture, type WebGLRenderer } from 'three'

// Highlight mask in the body UV layout, baked on the GPU whenever the highlight changes:
// r = primary, g = secondary (Gaussian over the region states, so the skin shader can threshold a smooth contour),
// b = any highlight blurred wide, an inset distance used by the concentric pulse.
// Region states are looked up once per 2 x 2 region texels, then blurred separably (edge at 1024 px, wide at 256 px):
// about 29M texture reads per change instead of 340M for the old 9 x 9 x 2 gather.
// Region indices come from the alpha of the packed atlas surface (atlas.ts), padded past the UV islands, so the blur
// never reads empty gutter.

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'

// region states averaged over the 2 x 2 region texels under each output texel
const STATE = /* glsl */ `
uniform sampler2D uRegions;
uniform sampler2D uLut;
void main() {
  ivec2 size = textureSize(uRegions, 0);
  ivec2 p = ivec2(gl_FragCoord.xy) * 2;
  vec2 acc = vec2(0.0);
  float any = 0.0;
  for (int i = 0; i < 4; i++) {
    ivec2 q = min(p + ivec2(i & 1, i >> 1), size - 1);
    vec2 s = texelFetch(uLut, ivec2(int(texelFetch(uRegions, q, 0).a * 255.0 + 0.5), 0), 0).rg;
    acc += s;
    any += max(s.r, s.g);
  }
  gl_FragColor = vec4(acc * 0.25, any * 0.25, 1.0);
}`

// one Gaussian pass; uLod picks the source mip (the wide blur reads the 256 px level of the state texture)
const BLUR = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uDir;
uniform float uSigma;
uniform float uLod;
uniform int uTaps;
varying vec2 vUv;
void main() {
  vec4 acc = vec4(0.0);
  float ws = 0.0;
  for (int i = -8; i <= 8; i++) {
    if (abs(i) > uTaps) continue;
    float w = exp(-float(i * i) / (2.0 * uSigma * uSigma));
    acc += textureLod(uSrc, vUv + uDir * float(i), uLod) * w;
    ws += w;
  }
  gl_FragColor = acc / ws;
}`

// vertical edge pass, joined with the wide blur
const FINAL = /* glsl */ `
uniform sampler2D uSrc;
uniform sampler2D uWide;
uniform vec2 uDir;
uniform float uSigma;
varying vec2 vUv;
void main() {
  vec2 acc = vec2(0.0);
  float ws = 0.0;
  for (int i = -4; i <= 4; i++) {
    float w = exp(-float(i * i) / (2.0 * uSigma * uSigma));
    acc += texture2D(uSrc, vUv + uDir * float(i)).rg * w;
    ws += w;
  }
  gl_FragColor = vec4(acc / ws, texture2D(uWide, vUv).b, 1.0);
}`

export type MaskOptions = {
  /** output resolution */
  size?: number
  /** Gaussian sigma of the edge blur, in region texels (2048 texels ~ 0.85 mm each on the body) */
  sigma?: number
  /** sigma of the wide inset blur, in region texels */
  wideSigma?: number
}

export class HighlightMask {
  readonly target: WebGLRenderTarget
  private readonly state: WebGLRenderTarget
  private readonly edgeH: WebGLRenderTarget
  private readonly wideH: WebGLRenderTarget
  private readonly wideV: WebGLRenderTarget
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly quad: Mesh
  private readonly passes: { mat: ShaderMaterial; out: WebGLRenderTarget }[]

  constructor(regions: Texture, lut: Texture, { size = 1024, sigma = 3.5, wideSigma = 16 }: MaskOptions = {}) {
    const rt = (s: number, mips = false) =>
      new WebGLRenderTarget(s, s, { depthBuffer: false, generateMipmaps: mips, minFilter: mips ? LinearMipmapLinearFilter : LinearFilter, magFilter: LinearFilter })
    const regionSize = (regions.image as { width?: number } | undefined)?.width ?? size * 2
    const scale = regionSize / size
    const wide = size / 4
    this.target = rt(size, true)
    this.state = rt(size, true)
    this.edgeH = rt(size)
    this.wideH = rt(wide)
    this.wideV = rt(wide)
    const mat = (fragmentShader: string, uniforms: Record<string, { value: unknown }>) =>
      new ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader, depthTest: false, depthWrite: false })
    const edge = sigma / scale
    const wideS = wideSigma / scale / 4
    this.passes = [
      { mat: mat(STATE, { uRegions: { value: regions }, uLut: { value: lut } }), out: this.state },
      { mat: mat(BLUR, { uSrc: { value: this.state.texture }, uDir: { value: [1 / size, 0] }, uSigma: { value: edge }, uLod: { value: 0 }, uTaps: { value: 4 } }), out: this.edgeH },
      { mat: mat(BLUR, { uSrc: { value: this.state.texture }, uDir: { value: [1 / wide, 0] }, uSigma: { value: wideS }, uLod: { value: 2 }, uTaps: { value: 6 } }), out: this.wideH },
      { mat: mat(BLUR, { uSrc: { value: this.wideH.texture }, uDir: { value: [0, 1 / wide] }, uSigma: { value: wideS }, uLod: { value: 0 }, uTaps: { value: 6 } }), out: this.wideV },
      { mat: mat(FINAL, { uSrc: { value: this.edgeH.texture }, uWide: { value: this.wideV.texture }, uDir: { value: [0, 1 / size] }, uSigma: { value: edge } }), out: this.target },
    ]
    this.quad = new Mesh(new PlaneGeometry(2, 2))
    this.quad.frustumCulled = false
    this.scene.add(this.quad)
  }

  get texture() {
    return this.target.texture
  }

  bake(gl: WebGLRenderer) {
    const prev = gl.getRenderTarget()
    const xr = gl.xr.enabled
    gl.xr.enabled = false
    for (const p of this.passes) {
      this.quad.material = p.mat
      gl.setRenderTarget(p.out)
      gl.render(this.scene, this.camera)
    }
    gl.setRenderTarget(prev)
    gl.xr.enabled = xr
  }

  dispose() {
    for (const t of [this.target, this.state, this.edgeH, this.wideH, this.wideV]) t.dispose()
    for (const p of this.passes) p.mat.dispose()
    this.quad.geometry.dispose()
  }
}
