import { Bone, Euler, Matrix4, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three'

export type Vec3 = readonly [number, number, number]

// Axes: X = figure's left, Y = up, Z = forward. Angles in degrees.
export type JointSpec = {
  /** rotation about body axes, applied on top of the motion inherited from the parent */
  rot?: Vec3
  /** absolute flexion in degrees about the rest hinge (plane of parent and bone); 0 = straight */
  flex?: number
  /** rotation about the bone's own axes (+x flexes knees and fingers) */
  local?: Vec3
  /** absolute body-space direction for the bone's long axis */
  aim?: Vec3
  /** rotation about the bone's long axis, after everything else */
  twist?: number
  /** fingers only: 0..1 of the way from the rest spread towards the middle finger */
  close?: number
}

export type Pose = {
  joints: Record<string, JointSpec>
  /** feet: keep the midpoint of both feet where it is at rest */
  anchor?: 'feet' | 'none'
  /** metres added to the root height after anchoring */
  lift?: number
}

const DEG = Math.PI / 180
const Y_AXIS = new Vector3(0, 1, 0)
const IDENTITY = new Quaternion()

function euler(v: Vec3) {
  return new Quaternion().setFromEuler(new Euler(v[0] * DEG, v[1] * DEG, v[2] * DEG, 'ZYX'))
}

/** Hinge axis in the bone's local frame: normal of the plane spanned by the parent's and the bone's long axes. */
function restHinge(restLocal: Quaternion) {
  const parentY = Y_AXIS.clone().applyQuaternion(restLocal.clone().invert())
  const axis = new Vector3().crossVectors(parentY, Y_AXIS)
  const rest = Math.acos(Math.min(1, Math.max(-1, parentY.dot(Y_AXIS)))) / DEG
  if (rest < 4) return { axis: new Vector3(1, 0, 0), rest: 0 }
  return { axis: axis.normalize(), rest }
}

export function mirrorSpec(s: JointSpec): JointSpec {
  const out: JointSpec = {}
  if (s.rot) out.rot = [s.rot[0], -s.rot[1], -s.rot[2]]
  if (s.flex !== undefined) out.flex = s.flex
  if (s.local) out.local = [s.local[0], -s.local[1], -s.local[2]]
  if (s.aim) out.aim = [-s.aim[0], s.aim[1], s.aim[2]]
  if (s.twist) out.twist = -s.twist
  if (s.close !== undefined) out.close = s.close
  return out
}

export class Rig {
  readonly mesh: SkinnedMesh
  readonly bones = new Map<string, Bone>()
  readonly root: Bone
  /** mesh-local transform baked into every bone matrix by position quantization (bone matrix at rest) */
  readonly dequant: Matrix4
  private readonly order: Bone[] = []
  private readonly restQuat = new Map<Bone, Quaternion>()
  private readonly restPos = new Map<Bone, Vector3>()
  private readonly restFeet: Vector3
  private readonly hinge = new Map<Bone, { axis: Vector3; rest: number }>()
  private readonly closeAxis = new Map<Bone, { axis: Vector3; angle: number }>()

  constructor(scene: Object3D) {
    let mesh: SkinnedMesh | undefined
    scene.traverse((o) => {
      const s = o as SkinnedMesh
      if (s.isSkinnedMesh && (!mesh || (s.name === 'body' && mesh.name !== 'body'))) mesh = s
    })
    if (!mesh) throw new Error('figure: no skinned mesh')
    this.mesh = mesh
    const all = new Set(mesh.skeleton.bones)
    const roots = mesh.skeleton.bones.filter((b) => !all.has(b.parent as Bone))
    if (roots.length !== 1) throw new Error('figure: expected one root bone')
    this.root = roots[0]
    const walk = (b: Bone) => {
      this.order.push(b)
      this.bones.set(b.name, b)
      this.restQuat.set(b, b.quaternion.clone())
      this.restPos.set(b, b.position.clone())
      this.hinge.set(b, restHinge(b.quaternion))
      for (const c of b.children) if (all.has(c as Bone)) walk(c as Bone)
    }
    walk(this.root)
    this.restFeet = this.feetMidpoint()
    mesh.updateMatrixWorld(true)
    const b0 = mesh.skeleton.bones[0]
    this.dequant = new Matrix4()
      .copy(mesh.matrixWorld).invert()
      .multiply(b0.matrixWorld)
      .multiply(mesh.skeleton.boneInverses[0])
      .multiply(mesh.bindMatrix)
    for (const side of ['L', 'R']) this.setupHand(side)
  }

  /** Finger hinges follow the knuckle line, not the bone roll (which is off by up to ~30 deg). */
  private setupHand(side: string) {
    const get = (n: string) => this.bones.get(`${n}_${side}`)
    const index = get('finger2-1')
    const pinky = get('finger5-1')
    const middle = get('finger3-1')
    if (!index || !pinky || !middle) return
    this.root.parent!.updateMatrixWorld(true)
    const pos = (b: Bone) => b.getWorldPosition(new Vector3())
    const quat = (b: Bone) => b.getWorldQuaternion(new Quaternion())
    const across = pos(pinky).sub(pos(index)).normalize()
    const middleDir = Y_AXIS.clone().applyQuaternion(quat(middle))
    const palm = new Vector3().crossVectors(middleDir, across).normalize()
    for (const f of [2, 3, 4, 5]) {
      for (const seg of [1, 2, 3]) {
        const b = get(`finger${f}-${seg}`)
        if (!b) continue
        const q = quat(b)
        const dir = Y_AXIS.clone().applyQuaternion(q)
        const axis = across.clone().addScaledVector(dir, -across.dot(dir)).normalize()
        if (axis.dot(new Vector3(1, 0, 0).applyQuaternion(q)) < 0) axis.negate()
        this.hinge.set(b, { axis: axis.applyQuaternion(q.clone().invert()), rest: 0 })
        if (seg === 1) {
          const inPlane = (v: Vector3) => v.clone().addScaledVector(palm, -v.dot(palm)).normalize()
          const a = inPlane(dir)
          const m = inPlane(middleDir)
          const angle = Math.atan2(new Vector3().crossVectors(a, m).dot(palm), a.dot(m)) / DEG
          this.closeAxis.set(b, { axis: palm.clone().applyQuaternion(q.clone().invert()), angle })
        }
      }
    }
  }

  bone(name: string) {
    const b = this.bones.get(name)
    if (!b) throw new Error(`figure: no bone ${name}`)
    return b
  }

  reset() {
    for (const b of this.order) {
      b.quaternion.copy(this.restQuat.get(b)!)
      b.position.copy(this.restPos.get(b)!)
    }
  }

  apply(pose: Pose) {
    this.reset()
    const world = new Map<Bone, Quaternion>()
    const tmp = new Vector3()
    for (const b of this.order) {
      const parentW = world.get(b.parent as Bone) ?? IDENTITY
      const w = parentW.clone().multiply(this.restQuat.get(b)!)
      const spec = pose.joints[b.name]
      if (spec) {
        if (spec.flex !== undefined) {
          const h = this.hinge.get(b)!
          w.multiply(new Quaternion().setFromAxisAngle(h.axis, (spec.flex - h.rest) * DEG))
        }
        if (spec.close) {
          const c = this.closeAxis.get(b)
          if (c) w.multiply(new Quaternion().setFromAxisAngle(c.axis, spec.close * c.angle * DEG))
        }
        if (spec.local) w.multiply(euler(spec.local))
        if (spec.rot) w.premultiply(euler(spec.rot))
        if (spec.aim) {
          const from = tmp.copy(Y_AXIS).applyQuaternion(w).normalize()
          const to = new Vector3(...spec.aim).normalize()
          w.premultiply(new Quaternion().setFromUnitVectors(from, to))
        }
        if (spec.twist) w.multiply(new Quaternion().setFromAxisAngle(Y_AXIS, spec.twist * DEG))
        b.quaternion.copy(parentW.clone().invert().multiply(w))
      }
      world.set(b, w)
    }
    if ((pose.anchor ?? 'feet') === 'feet') {
      const delta = this.restFeet.clone().sub(this.feetMidpoint())
      this.root.position.add(delta)
    }
    if (pose.lift) this.root.position.y += pose.lift
    this.root.parent?.updateMatrixWorld(true)
  }

  /** midpoint of the two ankle joints, in the armature's space */
  private feetMidpoint() {
    const armature = this.root.parent!
    armature.updateMatrixWorld(true)
    const inv = armature.matrixWorld.clone().invert()
    const p = new Vector3()
    const mid = new Vector3()
    for (const n of ['foot_L', 'foot_R']) {
      this.bone(n).getWorldPosition(p)
      mid.add(p.applyMatrix4(inv))
    }
    return mid.multiplyScalar(0.5)
  }
}
