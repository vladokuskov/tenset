// Loads the shipped body GLB with three.js in Node and poses it exactly like the runtime
// (Rig.apply, corrective morphs, blended DQS from dqs.ts) so atlas registration sees what the app renders.
import fs from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import type { Matrix4, Object3D, Quaternion, SkinnedMesh } from 'three'
import { ROOT } from '../lib/paths.ts'

// src/ uses extensionless relative imports (bundler resolution); let Node find the .ts files
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !/\.[a-z]+$/i.test(spec)) return next(`${spec}.ts`, ctx)
      throw e
    }
  },
})

type Pose = { joints: Record<string, unknown>; anchor?: 'feet' | 'none'; lift?: number }
type RigT = {
  mesh: SkinnedMesh
  dequant: Matrix4
  bones: Map<string, Object3D>
  apply(p: Pose): void
  reset(): void
  bone(n: string): Object3D
}
type CorrectivesT = { update(): void; weights: Record<string, number> }

const figureDir = path.join(ROOT, 'src/features/figure')
const load = (f: string) => import(path.join(figureDir, f))

export type FigureMesh = {
  /** rest (bind) positions in metres, figure axes (X left, Y up, Z forward) */
  rest: Float32Array
  uv: Float32Array
  indices: Uint32Array
  /** vertex -> welded vertex (UV seams split vertices that share a position) */
  weld: Uint32Array
  weldCount: number
  /** per vertex: name of the bone with the largest skin weight */
  bone: string[]
  rig: RigT
  poses: Record<string, Pose>
  /** skinned positions for a pose, figure axes, metres */
  pose(p: Pose | string): { positions: Float32Array; joints: Record<string, [number, number, number]> }
}

export async function loadFigure(): Promise<FigureMesh> {
  const THREE = await import('three')
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const { MeshoptDecoder } = await import('meshoptimizer')
  const { Rig } = await load('rig.ts')
  const { poses } = (await load('poses.ts')) as { poses: Record<string, Pose> }
  const { Correctives } = await load('correctives.ts')
  await MeshoptDecoder.ready
  // ATLAS_BODY: another GLB (e.g. the committed one) for before/after checks
  const buf = fs.readFileSync(path.resolve(ROOT, process.env.ATLAS_BODY ?? 'public/models/body.glb'))
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '')
  const scene = gltf.scene
  const rig = new Rig(scene) as RigT
  const correctives = Correctives.fromScene(rig, scene, true) as CorrectivesT
  const mesh = rig.mesh
  const geo = mesh.geometry
  const pos = geo.attributes.position
  const n = pos.count
  const uvAttr = geo.attributes.uv
  const col = geo.attributes.color
  const si = geo.attributes.skinIndex
  const sw = geo.attributes.skinWeight
  const uv = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    uv[i * 2] = uvAttr.getX(i)
    uv[i * 2 + 1] = uvAttr.getY(i)
  }
  const indices = new Uint32Array(geo.index!.array)
  const morphs = geo.morphAttributes.position ?? []
  const dict = mesh.morphTargetDictionary ?? {}
  const dq = rig.dequant
  const dqInv = dq.clone().invert()

  const skin = () => {
    scene.updateMatrixWorld(true)
    mesh.skeleton.update()
    const bones = mesh.skeleton.bones
    // K_j = bindInv * boneMatrix_j * bind * dequantInv (rigid), as in dqs.ts
    const K = bones.map((_, j) => new THREE.Matrix4().fromArray(mesh.skeleton.boneMatrices!, j * 16))
    const L = K.map((m) => mesh.bindMatrixInverse.clone().multiply(m).multiply(mesh.bindMatrix))
    const R = L.map((m) => m.clone().multiply(dqInv))
    const quats = R.map((m) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(m)))
    const trans = R.map((m) => new THREE.Vector3().setFromMatrixPosition(m))
    const inf = mesh.morphTargetInfluences ?? []
    const out = new Float32Array(n * 3)
    const p0 = new THREE.Vector3(), lbs = new THREE.Vector3(), tmp = new THREE.Vector3(), dqP = new THREE.Vector3()
    const q = [0, 0, 0, 0], d = [0, 0, 0, 0]
    for (let i = 0; i < n; i++) {
      p0.fromBufferAttribute(pos, i)
      for (const k of Object.values(dict)) {
        const w = inf[k]
        if (w) p0.addScaledVector(tmp.fromBufferAttribute(morphs[k], i), w)
      }
      lbs.set(0, 0, 0)
      q.fill(0)
      d.fill(0)
      let q0: Quaternion | null = null
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k)
        if (!w) continue
        const j = si.getComponent(i, k)
        lbs.addScaledVector(tmp.copy(p0).applyMatrix4(L[j]), w)
        const qj = quats[j]
        const s = q0 && q0.dot(qj) < 0 ? -w : w
        if (!q0) q0 = qj
        const t = trans[j]
        // dual part: 0.5 * (t, 0) * q
        const dx = 0.5 * (qj.w * t.x + (t.y * qj.z - t.z * qj.y))
        const dy = 0.5 * (qj.w * t.y + (t.z * qj.x - t.x * qj.z))
        const dz = 0.5 * (qj.w * t.z + (t.x * qj.y - t.y * qj.x))
        const dw = -0.5 * (t.x * qj.x + t.y * qj.y + t.z * qj.z)
        q[0] += s * qj.x; q[1] += s * qj.y; q[2] += s * qj.z; q[3] += s * qj.w
        d[0] += s * dx; d[1] += s * dy; d[2] += s * dz; d[3] += s * dw
      }
      const len = Math.hypot(q[0], q[1], q[2], q[3])
      for (let k = 0; k < 4; k++) {
        q[k] /= len
        d[k] /= len
      }
      const tx = 2 * (q[3] * d[0] - d[3] * q[0] + (q[1] * d[2] - q[2] * d[1]))
      const ty = 2 * (q[3] * d[1] - d[3] * q[1] + (q[2] * d[0] - q[0] * d[2]))
      const tz = 2 * (q[3] * d[2] - d[3] * q[2] + (q[0] * d[1] - q[1] * d[0]))
      dqP.copy(p0).applyMatrix4(dq).applyQuaternion(new THREE.Quaternion(q[0], q[1], q[2], q[3]))
      dqP.x += tx
      dqP.y += ty
      dqP.z += tz
      const mix = col ? col.getZ(i) : 1
      lbs.lerp(dqP, mix).applyMatrix4(mesh.matrixWorld)
      out[i * 3] = lbs.x
      out[i * 3 + 1] = lbs.y
      out[i * 3 + 2] = lbs.z
    }
    return out
  }

  const jointsNow = () => {
    const j: Record<string, [number, number, number]> = {}
    const v = new THREE.Vector3()
    for (const [name, b] of rig.bones) {
      b.getWorldPosition(v)
      j[name] = [v.x, v.y, v.z]
    }
    return j
  }

  rig.reset()
  correctives.update()
  const rest = skin()
  const weld = new Uint32Array(n)
  const keyOf = new Map<string, number>()
  let weldCount = 0
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(rest[i * 3] * 1e4)},${Math.round(rest[i * 3 + 1] * 1e4)},${Math.round(rest[i * 3 + 2] * 1e4)}`
    let w = keyOf.get(k)
    if (w === undefined) {
      w = weldCount++
      keyOf.set(k, w)
    }
    weld[i] = w
  }

  const boneNames = mesh.skeleton.bones.map((b) => b.name)
  const bone = Array.from({ length: n }, (_, i) => {
    let best = 0
    for (let k = 1; k < 4; k++) if (sw.getComponent(i, k) > sw.getComponent(i, best)) best = k
    return boneNames[si.getComponent(i, best)]
  })

  return {
    rest,
    uv,
    indices,
    weld,
    weldCount,
    bone,
    rig,
    poses,
    pose(p) {
      const resolved = typeof p === 'string' ? poses[p] : p
      if (!resolved) throw new Error(`unknown pose ${String(p)}`)
      rig.apply(resolved)
      correctives.update()
      const positions = skin()
      const joints = jointsNow()
      rig.reset()
      correctives.update()
      return { positions, joints }
    },
  }
}
