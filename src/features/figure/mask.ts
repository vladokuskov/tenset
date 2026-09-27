import { LinearFilter, LinearMipmapLinearFilter, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, WebGLRenderTarget, type Texture, type WebGLRenderer } from 'three'

// Highlight mask in the body UV layout, baked on the GPU whenever the highlight changes:
// r = primary, g = secondary (Gaussian over the region ids, so the skin shader can threshold a smooth contour),
// b = any highlight blurred wide, an inset distance used by the concentric pulse.
// The region texture is padded past its UV islands, so the blur never reads empty gutter.

const FRAG = /* glsl */ `
uniform sampler2D uRegions;
uniform sampler2D uLut;
uniform float uStep;
uniform float uWideStep;
varying vec2 vUv;
vec4 stateAt(vec2 p, ivec2 size) {
  int id = int(texelFetch(uRegions, clamp(ivec2(p), ivec2(0), size - 1), 0).r * 255.0 + 0.5);
  return texelFetch(uLut, ivec2(id, 0), 0);
}
void main() {
  ivec2 size = textureSize(uRegions, 0);
  vec2 p = vUv * vec2(size);
  vec2 acc = vec2(0.0);
  float wide = 0.0;
  float ws = 0.0;
  float wws = 0.0;
  for (int j = -4; j <= 4; j++) {
    for (int i = -4; i <= 4; i++) {
      vec2 o = vec2(float(i), float(j));
      float w = exp(-dot(o, o) / 8.0);
      acc += stateAt(p + o * uStep, size).rg * w;
      ws += w;
      vec4 s = stateAt(p + o * uWideStep, size);
      wide += max(s.r, s.g) * w;
    }
  }
  gl_FragColor = vec4(acc / ws, wide / ws, 1.0);
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
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly material: ShaderMaterial

  constructor(regions: Texture, lut: Texture, { size = 1024, sigma = 3.5, wideSigma = 16 }: MaskOptions = {}) {
    this.target = new WebGLRenderTarget(size, size, { depthBuffer: false, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter })
    // 9 x 9 taps with sigma 2 taps
    this.material = new ShaderMaterial({
      uniforms: { uRegions: { value: regions }, uLut: { value: lut }, uStep: { value: sigma / 2 }, uWideStep: { value: wideSigma / 2 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    })
    const quad = new Mesh(new PlaneGeometry(2, 2), this.material)
    quad.frustumCulled = false
    this.scene.add(quad)
  }

  get texture() {
    return this.target.texture
  }

  bake(gl: WebGLRenderer) {
    const prev = gl.getRenderTarget()
    const xr = gl.xr.enabled
    gl.xr.enabled = false
    gl.setRenderTarget(this.target)
    gl.render(this.scene, this.camera)
    gl.setRenderTarget(prev)
    gl.xr.enabled = xr
  }

  dispose() {
    this.target.dispose()
    this.material.dispose()
    for (const c of this.scene.children) (c as Mesh).geometry.dispose()
  }
}
