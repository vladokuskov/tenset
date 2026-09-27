import { Bone, BufferGeometry, Float32BufferAttribute, Group, MeshBasicMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { Correctives, type CorrectiveSpec } from './correctives'
import { Rig } from './rig'

// minimal skeleton: root points forward (+Z) like the MakeHuman root, spine up, legs and arms down
function makeFigure() {
  const bone = (name: string, pos: [number, number, number], parent?: Bone, dir?: Vector3) => {
    const b = new Bone()
    b.name = name
    b.position.set(...pos)
    if (dir) b.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir)
    parent?.add(b)
    return b
  }
  const root = bone('root', [0, 1, 0], undefined, new Vector3(0, 0, 1))
  const bones = [root]
  const spine = bone('spine01', [0, 0, 0], root)
  spine.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(0, 1, 0))
  bones.push(spine)
  for (const [s, x] of [['L', 0.1], ['R', -0.1]] as const) {
    const hip = bone(`upperleg01_${s}`, [x, 0, 0], root)
    hip.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(0, -1, 0))
    const knee = bone(`lowerleg01_${s}`, [0, 0.45, 0], hip)
    const foot = bone(`foot_${s}`, [0, 0.45, 0], knee)
    const arm = bone(`upperarm01_${s}`, [x * 1.8, 0.5, 0], spine, new Vector3(0, -1, 0))
    const elbow = bone(`lowerarm01_${s}`, [0, 0.3, 0], arm)
    bones.push(hip, knee, foot, arm, elbow)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3))
  geo.setAttribute('skinIndex', new Uint16BufferAttribute([0, 0, 0, 0], 4))
  geo.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0], 4))
  const mesh = new SkinnedMesh(geo, new MeshBasicMaterial())
  const armature = new Group()
  armature.add(root, mesh)
  armature.updateMatrixWorld(true)
  mesh.bind(new Skeleton(bones))
  return { armature, rig: new Rig(armature) }
}

const specs: CorrectiveSpec[] = [
  { name: 'cor_knee_L', kind: 'knee', side: 'L', start: 75, end: 145 },
  { name: 'cor_hip_L', kind: 'hip', side: 'L', start: 40, end: 85 },
  { name: 'cor_shoulder_up_L', kind: 'shoulder', side: 'L', start: 95, end: 163, plane: 'side' },
  { name: 'cor_shoulder_fwd_L', kind: 'shoulder', side: 'L', start: 95, end: 156, plane: 'front' },
]

describe('Correctives', () => {
  it('measures joint angles from bone positions', () => {
    const { armature, rig } = makeFigure()
    const c = new Correctives(rig, armature, specs)
    expect(c.angle('knee', 'L')).toBeCloseTo(0, 4)
    expect(c.angle('hip', 'L')).toBeCloseTo(0, 4)
    rig.apply({ joints: { lowerleg01_L: { local: [120, 0, 0] } }, anchor: 'none' })
    expect(c.angle('knee', 'L')).toBeCloseTo(120, 3)
    rig.apply({ joints: { upperleg01_L: { aim: [0, 0, 1] } }, anchor: 'none' })
    expect(c.angle('hip', 'L')).toBeCloseTo(90, 3)
    // tilting the pelvis with the thigh keeps hip flexion unchanged
    rig.apply({ joints: { root: { rot: [30, 0, 0] } }, anchor: 'none' })
    expect(c.angle('hip', 'L')).toBeCloseTo(0, 3)
  })

  it('ramps weights and splits raised arms by plane of elevation', () => {
    const { armature, rig } = makeFigure()
    const c = new Correctives(rig, armature, specs)
    rig.apply({ joints: { lowerleg01_L: { local: [110, 0, 0] } }, anchor: 'none' })
    c.update()
    expect(c.weights.cor_knee_L).toBeCloseTo(0.5, 3)
    rig.apply({ joints: { upperarm01_L: { aim: [0.3, 0.95, 0] } }, anchor: 'none' })
    c.update()
    expect(c.weights.cor_shoulder_up_L).toBeCloseTo(1, 3)
    expect(c.weights.cor_shoulder_fwd_L).toBe(0)
    rig.apply({ joints: { upperarm01_L: { aim: [0, 0.9135, 0.4067] } }, anchor: 'none' })
    c.update()
    expect(c.weights.cor_shoulder_fwd_L).toBeCloseTo(1, 2)
    expect(c.weights.cor_shoulder_up_L).toBeCloseTo(0, 2)
  })
})
