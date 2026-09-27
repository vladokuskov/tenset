import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'

export const views = {
  front: 0,
  threequarter: -35,
  side: -90,
  back: 180,
  left: 90,
  hero: -38,
} as const

export type ViewName = keyof typeof views

/** camera elevation per view (vertical component of the view direction): QA views stay near level,
 * threequarter and hero are the elevated three-quarter views of exercise illustrations */
export const elevations: Record<ViewName, number> = {
  front: 0.08,
  threequarter: 0.36,
  side: 0.08,
  back: 0.08,
  left: 0.08,
  hero: 0.42,
}

export function isViewName(s: unknown): s is ViewName {
  return typeof s === 'string' && s in views
}

/** camera azimuth in radians, 0 = in front of the figure (+Z), negative = towards the figure's right */
export function azimuth(view: ViewName) {
  return (views[view] * Math.PI) / 180
}

/** Place a perspective camera so the box fills the frame with a margin. */
export function frameBox(camera: PerspectiveCamera, box: Box3, az: number, margin = 1.12, elevation = 0.08) {
  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3())
  const dir = new Vector3(Math.sin(az), elevation, Math.cos(az)).normalize()
  const right = new Vector3(Math.cos(az), 0, -Math.sin(az))
  const halfW = (Math.abs(right.x) * size.x + Math.abs(right.z) * size.z) / 2
  // vertical extent seen from above includes some of the box depth
  const halfH = (size.y * Math.hypot(dir.x, dir.z) + Math.abs(dir.y) * Math.max(size.x, size.z)) / 2
  const depth = (Math.abs(dir.x) * size.x + Math.abs(dir.z) * size.z) / 2
  const tanV = Math.tan((camera.fov * Math.PI) / 360)
  const dist = Math.max(halfH / tanV, halfW / (tanV * camera.aspect)) * margin + depth
  camera.position.copy(center).addScaledVector(dir, dist)
  camera.near = Math.max(0.05, dist - depth * 3)
  camera.far = dist + depth * 3 + 10
  camera.lookAt(center)
  camera.updateProjectionMatrix()
}

/** Place a perspective camera so the projected points fill the frame with a margin (tighter than frameBox,
 * which fits the bounding box). `points` is a flat xyz array in world space. */
export function frameFit(camera: PerspectiveCamera, points: ArrayLike<number>, az: number, margin = 1.06, elevation = 0.08) {
  const n = points.length / 3
  const dir = new Vector3(Math.sin(az), elevation, Math.cos(az)).normalize()
  const right = new Vector3(Math.cos(az), 0, -Math.sin(az))
  const up = new Vector3().crossVectors(dir, right).normalize()
  const center = new Vector3()
  const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity)
  const p = new Vector3()
  for (let i = 0; i < n; i++) {
    p.set(points[i * 3], points[i * 3 + 1], points[i * 3 + 2])
    lo.min(p)
    hi.max(p)
  }
  center.copy(lo).add(hi).multiplyScalar(0.5)
  const tanV = Math.tan((camera.fov * Math.PI) / 360)
  const tanH = tanV * camera.aspect
  let dist = 0
  for (let iter = 0; iter < 4; iter++) {
    // distance so every point fits, then re-centre on the projected extents
    let need = 0
    for (let i = 0; i < n; i++) {
      p.set(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]).sub(center)
      const x = p.dot(right), y = p.dot(up), z = p.dot(dir)
      need = Math.max(need, z + Math.abs(x) / tanH, z + Math.abs(y) / tanV)
    }
    dist = need * margin
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
    for (let i = 0; i < n; i++) {
      p.set(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]).sub(center)
      const z = dist - p.dot(dir)
      const u = p.dot(right) / z, v = p.dot(up) / z
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v)
    }
    center.addScaledVector(right, ((u0 + u1) / 2) * dist).addScaledVector(up, ((v0 + v1) / 2) * dist)
  }
  camera.position.copy(center).addScaledVector(dir, dist)
  camera.near = Math.max(0.05, dist * 0.3)
  camera.far = dist * 3 + 10
  camera.lookAt(center)
  camera.updateProjectionMatrix()
}

/** Orthographic framing (QA atlas views): R3F keeps a pixel-sized frustum, so the box is fitted through zoom. */
export function frameBoxOrtho(camera: OrthographicCamera, box: Box3, az: number, width: number, height: number, margin = 1.04, elevation = 0) {
  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3())
  const dir = new Vector3(Math.sin(az), elevation, Math.cos(az)).normalize()
  const right = new Vector3(Math.cos(az), 0, -Math.sin(az))
  const halfW = (Math.abs(right.x) * size.x + Math.abs(right.z) * size.z) / 2
  const halfH = (size.y * Math.hypot(dir.x, dir.z) + Math.abs(dir.y) * Math.max(size.x, size.z)) / 2
  const dist = size.length() + 1
  camera.position.copy(center).addScaledVector(dir, dist)
  camera.near = 0.01
  camera.far = dist * 2 + 10
  camera.zoom = Math.min(width / (2 * halfW * margin), height / (2 * halfH * margin))
  camera.lookAt(center)
  camera.updateProjectionMatrix()
}
