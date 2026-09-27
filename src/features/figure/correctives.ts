import { Quaternion, Vector3, type Mesh, type Object3D } from 'three'
import type { Rig } from './rig'

// Angle-keyed corrective morphs, generated in pipeline/body/correctives.py and listed in the body node's extras.
// Angles use bone positions and long axes only, exactly as skinning.py's Angles, so both sides agree.

export type CorrectiveKind = 'shoulder' | 'hip' | 'knee'

export type CorrectiveSpec = {
  name: string
  kind: CorrectiveKind
  side: 'L' | 'R'
  /** joint angle (deg) where the morph starts */
  start: number
  /** joint angle (deg) of the key pose, where the morph is fully on */
  end: number
  /** past `end`, the morph fades out again towards this angle (where the next key of its pair is full) */
  fade?: number | null
  /** shoulder keys only: which plane of elevation the key was made in */
  plane?: 'side' | 'front' | null
}

const Y = new Vector3(0, 1, 0)
const X = new Vector3(1, 0, 0)
const DEG = 180 / Math.PI

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export class Correctives {
  readonly specs: CorrectiveSpec[]
  readonly weights: Record<string, number> = {}
  private readonly rig: Rig
  private readonly meshes: Mesh[]
  /** rest thigh direction in the root bone's frame, per side */
  private readonly down = new Map<string, Vector3>()
  private readonly v = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()]
  private readonly q = new Quaternion()

  constructor(rig: Rig, scene: Object3D, specs: CorrectiveSpec[]) {
    this.rig = rig
    this.specs = specs
    const meshes: Mesh[] = []
    scene.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh && m.morphTargetDictionary && specs.some((s) => s.name in m.morphTargetDictionary!)) meshes.push(m)
    })
    this.meshes = meshes
    const pose = new Map([...rig.bones.values()].map((b) => [b, b.quaternion.clone()]))
    const pos = new Map([...rig.bones.values()].map((b) => [b, b.position.clone()]))
    rig.reset()
    rig.root.parent?.updateMatrixWorld(true)
    const rootRest = rig.root.getWorldQuaternion(new Quaternion()).invert()
    for (const s of ['L', 'R']) {
      const thigh = this.head(`lowerleg01_${s}`, new Vector3()).sub(this.head(`upperleg01_${s}`, new Vector3())).normalize()
      this.down.set(s, thigh.applyQuaternion(rootRest))
    }
    for (const [b, q] of pose) b.quaternion.copy(q)
    for (const [b, p] of pos) b.position.copy(p)
    rig.root.parent?.updateMatrixWorld(true)
  }

  /** reads the specs from the body node's extras; `enabled = false` zeroes every corrective morph */
  static fromScene(rig: Rig, scene: Object3D, enabled = true) {
    let specs: CorrectiveSpec[] = []
    scene.traverse((o) => {
      const c = (o.userData as { correctives?: CorrectiveSpec[] }).correctives
      if (c && !specs.length) specs = c
      const m = o as Mesh
      if (!enabled && m.isMesh && m.morphTargetInfluences) m.morphTargetInfluences.fill(0)
    })
    return new Correctives(rig, scene, enabled ? specs : [])
  }

  private head(name: string, out: Vector3) {
    return this.rig.bone(name).getWorldPosition(out)
  }

  private axis(name: string, out: Vector3) {
    return out.copy(Y).applyQuaternion(this.rig.bone(name).getWorldQuaternion(this.q))
  }

  angle(kind: CorrectiveKind, side: string): number {
    const [a, b, c, d, e] = this.v
    if (kind === 'shoulder') {
      const arm = this.head(`lowerarm01_${side}`, a).sub(this.head(`upperarm01_${side}`, b))
      return arm.angleTo(this.axis('spine01', c).negate()) * DEG
    }
    const thigh = this.head(`lowerleg01_${side}`, a).sub(this.head(`upperleg01_${side}`, b))
    if (kind === 'knee') {
      const shin = this.head(`foot_${side}`, c).sub(this.head(`lowerleg01_${side}`, d))
      return thigh.angleTo(shin) * DEG
    }
    const fwd = this.axis('root', c)
    const down = d.copy(this.down.get(side)!).applyQuaternion(this.rig.root.getWorldQuaternion(this.q))
    const lat = e.crossVectors(fwd, down).normalize()
    thigh.addScaledVector(lat, -thigh.dot(lat))
    const fo = fwd.addScaledVector(down, -fwd.dot(down)).normalize()
    return Math.atan2(thigh.dot(fo), thigh.dot(down)) * DEG
  }

  /** Plane of shoulder elevation in the chest frame: 0 = to the side, 90 = straight forward. */
  shoulderPlane(side: string): number {
    const [a, b, up, lat, fwd] = this.v
    const arm = this.head(`lowerarm01_${side}`, a).sub(this.head(`upperarm01_${side}`, b))
    const q = this.rig.bone('spine01').getWorldQuaternion(this.q)
    up.copy(Y).applyQuaternion(q)
    lat.copy(X).applyQuaternion(q)
    lat.addScaledVector(up, -lat.dot(up)).normalize()
    fwd.crossVectors(lat, up)
    return Math.atan2(arm.dot(fwd), Math.abs(arm.dot(lat))) * DEG
  }

  /** keep in sync with weight() in pipeline/body/correctives.py */
  weight(s: CorrectiveSpec): number {
    const a = this.angle(s.kind, s.side)
    let w = smoothstep(s.start, s.end, a)
    if (s.fade) w *= 1 - smoothstep(s.end, s.fade, a)
    if (s.plane) {
      // near vertical the plane is undefined and the side key takes over
      const t = smoothstep(30, 70, this.shoulderPlane(s.side)) * smoothstep(178, 165, a)
      w *= s.plane === 'front' ? t : 1 - t
    }
    return w
  }

  /** Recompute every morph weight from the current pose (call after posing, before rendering). */
  update() {
    if (!this.specs.length) return
    this.rig.root.parent?.updateMatrixWorld(true)
    for (const s of this.specs) this.weights[s.name] = this.weight(s)
    for (const m of this.meshes) {
      const dict = m.morphTargetDictionary!
      const inf = m.morphTargetInfluences!
      for (const s of this.specs) {
        const i = dict[s.name]
        if (i !== undefined) inf[i] = this.weights[s.name]
      }
    }
  }
}
