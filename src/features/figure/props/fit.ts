import { Vector3, type SkinnedMesh } from 'three'
import type { FigureHandle } from '../Figure'
import { benchSockets, type BenchParams } from './sockets'

/** Skinned body positions in world space (linear blend with morphs; the runtime's DQS differs by millimetres). */
export function skinnedPositions(mesh: SkinnedMesh) {
  mesh.updateMatrixWorld(true)
  mesh.skeleton.update()
  const n = mesh.geometry.getAttribute('position').count
  const out = new Float32Array(n * 3)
  const v = new Vector3()
  for (let i = 0; i < n; i++) {
    mesh.getVertexPosition(i, v)
    v.applyMatrix4(mesh.matrixWorld)
    out[i * 3] = v.x
    out[i * 3 + 1] = v.y
    out[i * 3 + 2] = v.z
  }
  return out
}

/** Places an inclined bench under a seated figure: seat height from the buttocks, fore-aft from the back
 * touching the pad. `press` is how far the pads give (m). Returns the bench origin and its params. */
export function fitSeatedBench(figure: FigureHandle, params: BenchParams, press = 0.012) {
  const P = skinnedPositions(figure.rig.mesh)
  const hip = figure.rig.bone('upperleg01_L').getWorldPosition(new Vector3())
    .add(figure.rig.bone('upperleg01_R').getWorldPosition(new Vector3())).multiplyScalar(0.5)
  const shoulder = figure.rig.bone('upperarm01_L').getWorldPosition(new Vector3()).y
  let seatY = Infinity
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2]
    if (Math.abs(x - hip.x) < 0.2 && z > hip.z - 0.14 && z < hip.z + 0.1 && y < hip.y) seatY = Math.min(seatY, y)
  }
  const height = seatY + press
  const s = benchSockets({ ...params, height })
  const n = s.back.normal
  let minDot = Infinity
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2]
    if (Math.abs(x - hip.x) < 0.16 && y > seatY + 0.12 && y < shoulder) minDot = Math.min(minDot, n.y * y + n.z * z)
  }
  minDot += press
  const b = ((params.back ?? 0) * Math.PI) / 180
  const z = Math.abs(Math.sin(b)) > 0.2 ? (minDot - n.y * s.back.position.y) / n.z - s.back.position.z : hip.z
  return { position: new Vector3(hip.x, 0, z), params: { ...params, height } }
}
