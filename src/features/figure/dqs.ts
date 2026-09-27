// Blended dual-quaternion skinning for three's standard skinning chunks.
// uDQS mixes linear blend (0) and dual-quaternion (1) results; DQS keeps volume at hips, knees and twists.
// The per-vertex amount is baked into COLOR_0.b by the body build (LBS around the shoulders, where DQS balloons
// the lats); meshes without it fall back to per-bone factors.

const PARS = /* glsl */ `
#ifdef USE_SKINNING
uniform float uDQS;
uniform float uDqsBone[DQS_BONES];
uniform mat4 uDequant;
uniform mat4 uDequantInv;
vec4 dqsQuat(mat3 m) {
  float t = m[0][0] + m[1][1] + m[2][2];
  if (t > 0.0) {
    float s = sqrt(t + 1.0) * 2.0;
    return vec4((m[1][2] - m[2][1]) / s, (m[2][0] - m[0][2]) / s, (m[0][1] - m[1][0]) / s, 0.25 * s);
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    float s = sqrt(1.0 + m[0][0] - m[1][1] - m[2][2]) * 2.0;
    return vec4(0.25 * s, (m[1][0] + m[0][1]) / s, (m[2][0] + m[0][2]) / s, (m[1][2] - m[2][1]) / s);
  } else if (m[1][1] > m[2][2]) {
    float s = sqrt(1.0 + m[1][1] - m[0][0] - m[2][2]) * 2.0;
    return vec4((m[1][0] + m[0][1]) / s, 0.25 * s, (m[2][1] + m[1][2]) / s, (m[2][0] - m[0][2]) / s);
  }
  float s = sqrt(1.0 + m[2][2] - m[0][0] - m[1][1]) * 2.0;
  return vec4((m[2][0] + m[0][2]) / s, (m[2][1] + m[1][2]) / s, 0.25 * s, (m[0][1] - m[1][0]) / s);
}
vec4 dqsDual(vec4 q, vec3 t) { return 0.5 * vec4(q.w * t + cross(t, q.xyz), -dot(t, q.xyz)); }
vec3 dqsRot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
#endif
`

// bone matrices carry the position dequantization (KHR_mesh_quantization); strip it so each is rigid
const BASE = /* glsl */ `
#ifdef USE_SKINNING
  mat4 dqK0 = bindMatrixInverse * boneMatX * bindMatrix * uDequantInv;
  mat4 dqK1 = bindMatrixInverse * boneMatY * bindMatrix * uDequantInv;
  mat4 dqK2 = bindMatrixInverse * boneMatZ * bindMatrix * uDequantInv;
  mat4 dqK3 = bindMatrixInverse * boneMatW * bindMatrix * uDequantInv;
  vec4 dq0 = dqsQuat(mat3(dqK0));
  vec4 dq1 = dqsQuat(mat3(dqK1));
  vec4 dq2 = dqsQuat(mat3(dqK2));
  vec4 dq3 = dqsQuat(mat3(dqK3));
  dq1 *= dot(dq0, dq1) < 0.0 ? -1.0 : 1.0;
  dq2 *= dot(dq0, dq2) < 0.0 ? -1.0 : 1.0;
  dq3 *= dot(dq0, dq3) < 0.0 ? -1.0 : 1.0;
  vec4 dqR = skinWeight.x * dq0 + skinWeight.y * dq1 + skinWeight.z * dq2 + skinWeight.w * dq3;
  vec4 dqD = skinWeight.x * dqsDual(dq0, dqK0[3].xyz) + skinWeight.y * dqsDual(dq1, dqK1[3].xyz)
    + skinWeight.z * dqsDual(dq2, dqK2[3].xyz) + skinWeight.w * dqsDual(dq3, dqK3[3].xyz);
  float dqLen = length(dqR);
  dqR /= dqLen;
  dqD /= dqLen;
  vec3 dqT = 2.0 * (dqR.w * dqD.xyz - dqD.w * dqR.xyz + cross(dqR.xyz, dqD.xyz));
#ifdef DQS_VERTEX_MIX
  float dqMix = uDQS * color.b;
#else
  float dqMix = uDQS * dot(skinWeight, vec4(
    uDqsBone[int(skinIndex.x)], uDqsBone[int(skinIndex.y)], uDqsBone[int(skinIndex.z)], uDqsBone[int(skinIndex.w)]));
#endif
#endif
`

const NORMAL = /* glsl */ `
#ifdef USE_SKINNING
  vec3 dqN = dqsRot(dqR, dqsN0);
  objectNormal = normalize(mix(objectNormal, dqN, dqMix));
#endif
`

const POSITION = /* glsl */ `
#ifdef USE_SKINNING
  vec3 dqP = dqsRot(dqR, (uDequant * vec4(dqsP0, 1.0)).xyz) + dqT;
  transformed = mix(transformed, dqP, dqMix);
#endif
`

/** per-bone DQS weight, used only for meshes without a baked COLOR_0.b mix */
export function dqsBoneFactors(boneNames: string[]) {
  return boneNames.map((n) => {
    if (/^(clavicle|shoulder01|upperarm01)_/.test(n)) return 0.15
    if (/^(spine01|neck01)$/.test(n)) return 0.5
    return 1
  })
}

/** `vertexMix` reads the DQS amount from the vertex color's blue channel (the material needs vertexColors) */
export function patchDqs(vertexShader: string, boneCount: number, vertexMix = false) {
  const defines = `#define DQS_BONES ${boneCount}\n${vertexMix ? '#define DQS_VERTEX_MIX\n' : ''}`
  return vertexShader
    .replace('#include <skinning_pars_vertex>', `#include <skinning_pars_vertex>\n${defines}${PARS}`)
    .replace('#include <skinbase_vertex>', `#include <skinbase_vertex>\n${BASE}`)
    .replace('#include <skinnormal_vertex>', `vec3 dqsN0 = objectNormal;\n#include <skinnormal_vertex>\n${NORMAL}`)
    .replace('#include <skinning_vertex>', `vec3 dqsP0 = transformed;\n#include <skinning_vertex>\n${POSITION}`)
}
