import { Color, DoubleSide, Matrix4, MeshPhysicalMaterial, ShaderChunk, Vector2, type Texture } from 'three'
import { patchDqs } from './dqs'
import { highlightColors } from './highlight'

// Figure materials. COLOR_0 carries baked data, never albedo: r = ambient occlusion, g = hair tint (brows,
// hairline fade) on the skin and hairline fade on the hair shell, b = DQS mix (see dqs.ts).

export type FigureMaterialName = 'skin' | 'hair' | 'shorts' | 'eyes'

export type MaterialOptions = {
  color?: string
  roughness?: number
  /** dielectric specular strength (1 = F0 of 0.04) */
  specular?: number
  sheen?: number
  sheenColor?: string
  /** strength of the baked vertex AO (COLOR_0.r) */
  ao?: number
  rimColor?: string
  rim?: number
  /** wrap lighting: how far light bleeds past the terminator (0 = Lambert) */
  wrap?: number
  /** multiplier applied around the terminator, a cheap subsurface cue */
  wrapTint?: string
  /** 0 = linear blend skinning, 1 = dual-quaternion skinning (amount per vertex from COLOR_0.b) */
  dqs?: number
  /** colour mixed in by COLOR_0.g (brows, hairline) */
  hairColor?: string
  hairTint?: number
  /** atlas relief height multiplier (1 = baked millimetres) */
  relief?: number
  /** fibre relief multiplier on plain skin and on highlighted muscles */
  fiber?: number
  fiberHighlight?: number
  /** fibre striation in the albedo of highlighted muscles */
  fiberTint?: number
  /** darkening in the grooves between muscle bellies */
  cavity?: number
  /** albedo contrast from the relief: bellies lighter, valleys darker */
  definition?: number
  /** half-width of the smoothed highlight edge (mask units, 0..0.5) */
  edge?: number
  primary?: string
  secondary?: string
}

/** atlas textures for the skin (atlas.ts) and the baked highlight mask (mask.ts) */
export type FigureAtlasInput = {
  regions: Texture
  relief: Texture
  fibre: Texture
  lut: Texture
  mask: Texture
  reliefRange: [number, number]
  fibreAmp: number
  flat?: boolean
}

/** Neutral light-gray skin for the exercise-illustration look. */
export const skinDefaults: Required<MaterialOptions> = {
  color: '#c4c4c2',
  roughness: 0.62,
  specular: 0.5,
  sheen: 0.1,
  sheenColor: '#ffffff',
  ao: 0.9,
  rimColor: '#ffffff',
  rim: 0.05,
  wrap: 0.3,
  wrapTint: '#f3efed',
  dqs: 1,
  hairColor: '#2c2724',
  hairTint: 0.85,
  relief: 1.8,
  fiber: 0.35,
  fiberHighlight: 1.6,
  fiberTint: 0.14,
  cavity: 0.5,
  definition: 0.32,
  edge: 0.2,
  primary: highlightColors.primary,
  secondary: highlightColors.secondary,
}

export const figureMaterialDefaults: Record<FigureMaterialName, Required<MaterialOptions>> = {
  skin: skinDefaults,
  hair: { ...skinDefaults, color: '#2e2824', roughness: 0.66, specular: 0.6, sheen: 0.5, sheenColor: '#857a70', ao: 0.6, rim: 0.04, rimColor: '#8a8580', wrap: 0.15, wrapTint: '#ffffff', hairTint: 0 },
  shorts: { ...skinDefaults, color: '#34363b', roughness: 0.8, specular: 0.4, sheen: 0.5, sheenColor: '#8c919c', ao: 0.9, rim: 0.03, rimColor: '#9aa0aa', wrap: 0.2, wrapTint: '#ffffff', hairTint: 0 },
  eyes: { ...skinDefaults, color: '#e4e2de', roughness: 0.25, specular: 1, sheen: 0, ao: 0, rim: 0, wrap: 0.2, wrapTint: '#ffffff', hairTint: 0 },
}

const LAMBERT = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );'
const WRAPPED = `float figNL = dot( geometryNormal, directLight.direction );
	float figWrap = saturate( ( figNL + uWrap ) / ( 1.0 + uWrap ) );
	vec3 figTint = mix( uWrapTint, vec3( 1.0 ), smoothstep( 0.0, 0.6, figNL ) );
	reflectedLight.directDiffuse += figWrap * figTint * directLight.color * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );`

// iris and pupil from the planar eye UVs (pupil centre at 0.5, 0.5; eyeball radius 0.5)
const EYE = `
  float eyeR = length( vUv - 0.5 );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.30, 0.27, 0.24 ), smoothstep( 0.232, 0.212, eyeR ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.06, 0.055, 0.05 ), smoothstep( 0.1, 0.085, eyeR ) );`

// short-hair grain: anisotropic value noise in rest space (quantized units, ~1.8 m per 2 units), so it never swims
const HAIR_PARS = `
varying vec3 vRestPos;
float hairHash( vec3 p ) { return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
float hairNoise( vec3 p ) {
  vec3 i = floor( p ); vec3 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( hairHash( i ), hairHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( hairHash( i + vec3( 0, 1, 0 ) ), hairHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( hairHash( i + vec3( 0, 0, 1 ) ), hairHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( hairHash( i + vec3( 0, 1, 1 ) ), hairHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}`
const HAIR_GRAIN = `
  float hairG = hairNoise( vRestPos * vec3( 1400.0, 700.0, 260.0 ) ) * 0.6 + hairNoise( vRestPos * vec3( 3200.0, 1600.0, 600.0 ) ) * 0.4;
  diffuseColor.rgb *= 0.62 + 0.72 * hairG;
  // sparse, lighter hair towards the shell edge (COLOR_0.g), so the hairline is not a hard line
  float hairEdge = vColor.g + ( hairG - 0.5 ) * 0.5;
  diffuseColor.rgb = mix( diffuseColor.rgb, uHairEdgeColor, smoothstep( 0.35, 1.0, hairEdge ) * 0.7 );
  diffuseColor.a *= 1.0 - smoothstep( 0.55, 1.05, hairEdge );`

const ATLAS_PARS = `
uniform sampler2D uRegions;
uniform sampler2D uRelief;
uniform sampler2D uFibre;
uniform sampler2D uLut;
uniform sampler2D uMask;
uniform vec2 uReliefRange;
uniform float uFibreAmp;
uniform float uReliefStrength;
uniform float uFiber;
uniform float uFiberHl;
uniform float uFiberTint;
uniform float uCavity;
uniform float uDefinition;
uniform float uEdge;
uniform float uHighlight;
uniform vec3 uPrimary;
uniform vec3 uSecondary;
uniform float uPulse;
uniform float uAtlasFlat;`

// relief: belly height over a 3-texel stencil (smooth against 8-bit steps), fibres from their own map;
// highlight: the baked mask thresholded at 0.5, so region borders come out as smooth contours
const ATLAS_COLOR = `
  vec2 atlasTexel = 1.0 / vec2( textureSize( uRelief, 0 ) );
  float hRange = uReliefRange.y - uReliefRange.x;
  float atlasC = texture2D( uRelief, vUv ).r;
  vec4 atlasH = vec4(
    texture2D( uRelief, vUv - vec2( atlasTexel.x * 1.5, 0.0 ) ).r, texture2D( uRelief, vUv + vec2( atlasTexel.x * 1.5, 0.0 ) ).r,
    texture2D( uRelief, vUv - vec2( 0.0, atlasTexel.y * 1.5 ) ).r, texture2D( uRelief, vUv + vec2( 0.0, atlasTexel.y * 1.5 ) ).r );
  // wide Laplacian (4-texel stencil) for the belly / valley contrast; stays inside the map's 12-texel padding at seams
  float atlasLap = texture2D( uRelief, vUv - vec2( atlasTexel.x * 4.0, 0.0 ) ).r + texture2D( uRelief, vUv + vec2( atlasTexel.x * 4.0, 0.0 ) ).r
    + texture2D( uRelief, vUv - vec2( 0.0, atlasTexel.y * 4.0 ) ).r + texture2D( uRelief, vUv + vec2( 0.0, atlasTexel.y * 4.0 ) ).r - 4.0 * atlasC;
  vec2 fibTexel = 1.0 / vec2( textureSize( uFibre, 0 ) );
  const float FIB = 255.0 / 127.0;
  float fibC = ( texture2D( uFibre, vUv ).r - 0.502 ) * FIB;
  vec4 fibH = ( vec4(
    texture2D( uFibre, vUv - vec2( fibTexel.x, 0.0 ) ).r, texture2D( uFibre, vUv + vec2( fibTexel.x, 0.0 ) ).r,
    texture2D( uFibre, vUv - vec2( 0.0, fibTexel.y ) ).r, texture2D( uFibre, vUv + vec2( 0.0, fibTexel.y ) ).r ) - 0.502 ) * FIB;
  vec4 hlMask = uHighlight > 0.5 ? texture2D( uMask, vUv ) : vec4( 0.0 );
  vec2 hlAA = max( vec2( uEdge ), fwidth( hlMask.rg ) );
  float hlP = smoothstep( 0.5 - hlAA.x, 0.5 + hlAA.x, hlMask.r );
  float hlS = smoothstep( 0.5 - hlAA.y, 0.5 + hlAA.y, hlMask.g ) * ( 1.0 - hlP );
  float hlA = hlP + hlS;
  vec3 skinC = diffuseColor.rgb;
  diffuseColor.rgb = mix( mix( skinC, uSecondary, hlS ), uPrimary, hlP );
  float hMm = ( uReliefRange.x + atlasC * hRange ) * 1000.0 * uReliefStrength;
  float dMm = - atlasLap * 0.25 * hRange * 1000.0 * uReliefStrength;
  diffuseColor.rgb *= 1.0 - uCavity * smoothstep( 0.0, -0.8, hMm );
  diffuseColor.rgb *= 1.0 + uDefinition * ( 1.0 + 0.8 * hlA ) * clamp( dMm * 0.5, -1.0, 0.5 );
  diffuseColor.rgb *= 1.0 + uFiberTint * hlA * clamp( fibC, -1.0, 1.0 );
  if ( uPulse >= 0.0 ) {
    float ring = exp( - pow( ( hlMask.b - mix( 0.95, 0.35, uPulse ) ) / 0.06, 2.0 ) ) * ( 1.0 - uPulse );
    diffuseColor.rgb = mix( diffuseColor.rgb, min( diffuseColor.rgb * 1.4 + 0.06, vec3( 1.0 ) ), ring * hlA );
  }
`

// QA: unlit region colours from the debug lookup
const ATLAS_FLAT = `
  if ( uAtlasFlat > 0.5 ) {
    ivec2 regSize = textureSize( uRegions, 0 );
    int atlasId = int( texelFetch( uRegions, clamp( ivec2( vUv * vec2( regSize ) ), ivec2( 0 ), regSize - 1 ), 0 ).r * 255.0 + 0.5 );
    gl_FragColor = vec4( texelFetch( uLut, ivec2( atlasId, 0 ), 0 ).rgb, 1.0 );
  }`

// bump from the height gradient in UV space, via the surface gradient (Mikkelsen 2010); height in metres
const ATLAS_NORMAL = `
  {
    float fibK = uFibreAmp * mix( uFiber, uFiberHl, hlA );
    float dhdu = ( atlasH.y - atlasH.x ) / ( 3.0 * atlasTexel.x ) * hRange * uReliefStrength + ( fibH.y - fibH.x ) / ( 2.0 * fibTexel.x ) * fibK;
    float dhdv = ( atlasH.w - atlasH.z ) / ( 3.0 * atlasTexel.y ) * hRange * uReliefStrength + ( fibH.w - fibH.z ) / ( 2.0 * fibTexel.y ) * fibK;
    vec3 sigX = dFdx( - vViewPosition );
    vec3 sigY = dFdy( - vViewPosition );
    vec2 uvX = dFdx( vUv );
    vec2 uvY = dFdy( vUv );
    float dBs = dhdu * uvX.x + dhdv * uvX.y;
    float dBt = dhdu * uvY.x + dhdv * uvY.y;
    vec3 R1 = cross( sigY, normal );
    vec3 R2 = cross( normal, sigX );
    float fDet = dot( sigX, R1 ) * faceDirection;
    vec3 surfGrad = sign( fDet ) * ( dBs * R1 + dBt * R2 );
    normal = normalize( abs( fDet ) * normal - surfGrad );
  }`

export type FigureUniforms = ReturnType<typeof createFigureMaterial>['uniforms']

export function setHighlightEnabled(u: FigureUniforms, on: boolean) {
  u.uHighlight.value = on ? 1 : 0
}

/** concentric pulse phase 0..1 inside highlighted muscles; null turns it off */
export function setPulsePhase(u: FigureUniforms, phase: number | null) {
  u.uPulse.value = phase === null ? -1 : Math.min(1, Math.max(0, phase))
}

/** One of the figure's materials: PBR base, blended DQS skinning, wrap diffuse, baked AO, soft fresnel rim. */
export function createFigureMaterial(name: FigureMaterialName, opts: MaterialOptions = {}, dqsBones: number[] = [1], vertexMix = true, atlas?: FigureAtlasInput) {
  const o = { ...figureMaterialDefaults[name], ...opts }
  const useAtlas = name === 'skin' && !!atlas
  const uniforms = {
    uRegions: { value: atlas?.regions ?? null },
    uRelief: { value: atlas?.relief ?? null },
    uFibre: { value: atlas?.fibre ?? null },
    uLut: { value: atlas?.lut ?? null },
    uMask: { value: atlas?.mask ?? null },
    uReliefRange: { value: new Vector2(...(atlas?.reliefRange ?? [0, 0])) },
    uFibreAmp: { value: atlas?.fibreAmp ?? 0 },
    uReliefStrength: { value: o.relief },
    uFiber: { value: o.fiber },
    uFiberHl: { value: o.fiberHighlight },
    uFiberTint: { value: o.fiberTint },
    uCavity: { value: o.cavity },
    uDefinition: { value: o.definition },
    uEdge: { value: o.edge },
    uHighlight: { value: 0 },
    uPrimary: { value: new Color(o.primary) },
    uSecondary: { value: new Color(o.secondary) },
    /** concentric pulse phase 0..1 inside highlighted muscles; negative = off */
    uPulse: { value: -1 },
    uAtlasFlat: { value: atlas?.flat ? 1 : 0 },
    uAO: { value: o.ao },
    uRim: { value: o.rim },
    uRimColor: { value: new Color(o.rimColor) },
    uWrap: { value: o.wrap },
    uWrapTint: { value: new Color(o.wrapTint) },
    uHairColor: { value: new Color(o.hairColor) },
    uHairTint: { value: o.hairTint },
    uHairEdgeColor: { value: new Color('#5a524b') },
    uDQS: { value: o.dqs },
    /** position dequantization folded into the bone matrices, see Rig.dequant */
    uDequant: { value: new Matrix4() },
    uDequantInv: { value: new Matrix4() },
    uDqsBone: { value: dqsBones },
  }
  const mat = new MeshPhysicalMaterial({
    color: o.color,
    roughness: o.roughness,
    metalness: 0,
    specularIntensity: o.specular,
    sheen: o.sheen,
    sheenColor: new Color(o.sheenColor),
    sheenRoughness: 0.6,
    vertexColors: true,
    side: name === 'shorts' ? DoubleSide : undefined,
    transparent: name === 'hair',
  })
  mat.name = name
  if (name === 'eyes' || useAtlas) mat.defines = { USE_UV: '' }
  if (name === 'hair' || name === 'shorts') {
    // shells sit a few millimetres above the skin
    mat.polygonOffset = true
    mat.polygonOffsetFactor = -1
    mat.polygonOffsetUnits = -1
  }
  const lights = ShaderChunk.lights_physical_pars_fragment
  const wrapped = lights.includes(LAMBERT) ? lights.replace(LAMBERT, WRAPPED) : lights
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = patchDqs(shader.vertexShader, dqsBones.length, vertexMix)
    if (name === 'hair') {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRestPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRestPos = position;')
    }
    const pars = name === 'hair' ? HAIR_PARS : useAtlas ? ATLAS_PARS : ''
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uAO;
uniform float uRim;
uniform vec3 uRimColor;
uniform float uWrap;
uniform vec3 uWrapTint;
uniform vec3 uHairColor;
uniform float uHairTint;
uniform vec3 uHairEdgeColor;
${pars}`,
      )
      .replace('#include <lights_physical_pars_fragment>', wrapped)
      .replace(
        '#include <color_fragment>',
        name === 'eyes' ? EYE : name === 'hair' ? HAIR_GRAIN : `diffuseColor.rgb = mix( diffuseColor.rgb, uHairColor, vColor.g * uHairTint );${useAtlas ? ATLAS_COLOR : ''}`,
      )
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>${useAtlas ? ATLAS_NORMAL : ''}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>${useAtlas ? ATLAS_FLAT : ''}`)
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        float figAO = mix( 1.0, vColor.r, uAO );
        reflectedLight.indirectDiffuse *= figAO;
        reflectedLight.indirectSpecular *= figAO * figAO;
        reflectedLight.directDiffuse *= mix( 1.0, figAO, 0.4 );
        reflectedLight.directSpecular *= figAO;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rimF = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 3.0 );
        totalEmissiveRadiance += uRimColor * rimF * uRim * mix( 1.0, vColor.r, 0.8 );`,
      )
  }
  mat.customProgramCacheKey = () => `figure-v9-${name}-${dqsBones.length}-${vertexMix ? 'v' : 'b'}-${useAtlas ? 'a' : ''}`
  return { material: mat, uniforms }
}
