import { Bone, BufferGeometry, Float32BufferAttribute, Group, MeshBasicMaterial, Quaternion, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { mirrorSpec, Rig } from './rig'

// root -> hip -> foot_L / foot_R, root -> upperarm01_L (down-left) -> lowerarm01_L (bent 40 deg forward)
function makeFigure() {
  const bone = (name: string, pos: [number, number, number], parent?: Bone) => {
    const b = new Bone()
    b.name = name
    b.position.set(...pos)
    parent?.add(b)
    return b
  }
  const root = bone('root', [0, 1, 0])
  const footL = bone('foot_L', [0.1, -0.9, 0], root)
  const footR = bone('foot_R', [-0.1, -0.9, 0], root)
  const arm = bone('upperarm01_L', [0.2, 0.4, 0], root)
  // arm hangs down-left: rotate its +Y towards (0.6, -0.8, 0)
  arm.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(0.6, -0.8, 0))
  const fore = bone('lowerarm01_L', [0, 0.3, 0], arm)
  fore.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), (40 * Math.PI) / 180)
  const bones = [root, footL, footR, arm, fore]
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3))
  geo.setAttribute('skinIndex', new Uint16BufferAttribute([0, 0, 0, 0], 4))
  geo.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0], 4))
  const mesh = new SkinnedMesh(geo, new MeshBasicMaterial())
  const armature = new Group()
  armature.add(root)
  armature.add(mesh)
  armature.updateMatrixWorld(true)
  mesh.bind(new Skeleton(bones))
  return { armature, rig: new Rig(armature) }
}

const worldY = (b: Bone) => new Vector3(0, 1, 0).applyQuaternion(b.getWorldQuaternion(new Quaternion()))

describe('Rig', () => {
  it('aims a bone along an absolute body-space direction', () => {
    const { rig } = makeFigure()
    rig.apply({ joints: { upperarm01_L: { aim: [1, 0, 0] } } })
    expect(worldY(rig.bone('upperarm01_L')).distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-6)
  })

  it('flex is absolute about the rest hinge: 0 straightens, 90 is a right angle', () => {
    const { rig } = makeFigure()
    const angle = () => worldY(rig.bone('upperarm01_L')).angleTo(worldY(rig.bone('lowerarm01_L'))) * (180 / Math.PI)
    expect(angle()).toBeCloseTo(40, 4)
    rig.apply({ joints: { lowerarm01_L: { flex: 0 } } })
    expect(angle()).toBeCloseTo(0, 4)
    rig.apply({ joints: { lowerarm01_L: { flex: 90 } } })
    expect(angle()).toBeCloseTo(90, 4)
  })

  it('keeps the feet planted when the root rotates, and reset restores rest', () => {
    const { rig } = makeFigure()
    const feet = () => rig.bone('foot_L').getWorldPosition(new Vector3()).add(rig.bone('foot_R').getWorldPosition(new Vector3())).multiplyScalar(0.5)
    const rest = feet()
    rig.apply({ joints: { root: { rot: [30, 0, 0] } } })
    expect(feet().distanceTo(rest)).toBeLessThan(1e-6)
    rig.apply({ joints: {}, lift: 0.1 })
    expect(feet().y - rest.y).toBeCloseTo(0.1, 6)
    rig.reset()
    rig.root.parent!.updateMatrixWorld(true)
    expect(feet().distanceTo(rest)).toBeLessThan(1e-6)
  })

  it('mirrors specs across the sagittal plane', () => {
    expect(mirrorSpec({ rot: [10, 20, 30], local: [1, 2, 3], aim: [0.5, -1, 0.2], twist: 15, flex: 40, close: 0.5 })).toEqual({
      rot: [10, -20, -30],
      local: [1, -2, -3],
      aim: [-0.5, -1, 0.2],
      twist: -15,
      flex: 40,
      close: 0.5,
    })
  })
})
