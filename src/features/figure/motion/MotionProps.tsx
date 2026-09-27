import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react'
import { Group, InstancedMesh, Quaternion, Vector3 } from 'three'
import type { ImplementPose } from '../../../motion/skeleton.ts'
import { Bench } from '../props/Bench'
import { Dumbbell } from '../props/Dumbbell'
import { geometry, type Piece } from '../props/kit'
import { propMaterials } from '../props/materials'
import { PropModel } from '../props/PropModel'
import type { Poses, PropSpec } from './compose'

export type MotionPropsHandle = { update: (poses: Poses) => void }

const p = new Vector3()
const q = new Quaternion()
const ONE = new Vector3(1, 1, 1)

function place(g: Group, pose: ImplementPose | undefined) {
  if (!pose) return
  g.matrix.compose(p.set(pose.pos[0], pose.pos[1], pose.pos[2]), q.set(pose.rot[0], pose.rot[1], pose.rot[2], pose.rot[3]), ONE)
  g.matrixWorldNeedsUpdate = true
}

/**
 * A prop rebuilt from its builder every frame. Instanced meshes are kept while the piece layout (geometry and
 * material per slot) stays the same, and only their matrices are rewritten.
 */
class LiveProp {
  readonly group = new Group()
  private layout = ''
  private meshes: { mesh: InstancedMesh; slots: number[] }[] = []

  update(pieces: Piece[]) {
    const order = new Map<string, number[]>()
    pieces.forEach((pc, i) => {
      const k = `${pc.geo}|${pc.mat}`
      const list = order.get(k)
      if (list) list.push(i)
      else order.set(k, [i])
    })
    const layout = [...order].map(([k, l]) => `${k}#${l.length}`).join(',')
    if (layout !== this.layout) {
      this.dispose()
      const mats = propMaterials()
      for (const slots of order.values()) {
        const first = pieces[slots[0]]
        const mesh = new InstancedMesh(geometry(first.geo), mats[first.mat], slots.length)
        mesh.frustumCulled = false
        this.group.add(mesh)
        this.meshes.push({ mesh, slots })
      }
      this.layout = layout
    }
    for (const { mesh, slots } of this.meshes) {
      slots.forEach((s, i) => mesh.setMatrixAt(i, pieces[s].matrix))
      mesh.instanceMatrix.needsUpdate = true
    }
  }

  dispose() {
    for (const { mesh } of this.meshes) {
      this.group.remove(mesh)
      mesh.dispose()
    }
    this.meshes = []
    this.layout = ''
  }
}

/** The composed scene's props: held implements follow their poses, machines rebuild their moving parts. */
export function MotionProps({ props, ref }: { props: PropSpec[]; ref?: Ref<MotionPropsHandle> }) {
  const attached = useRef(new Map<string, { group: Group; attach: string }>())
  const live = useMemo(() => props.filter((s) => s.type === 'dynamic').map((s) => ({ spec: s, prop: new LiveProp() })), [props])
  useEffect(() => () => live.forEach((l) => l.prop.dispose()), [live])

  useImperativeHandle(ref, () => ({
    update: (poses) => {
      for (const { group, attach } of attached.current.values()) place(group, poses.get(attach))
      for (const { spec, prop } of live) prop.update(spec.build(poses))
    },
  }), [live])

  const hold = (key: string, attach: string) => (g: Group | null) => {
    if (g) attached.current.set(key, { group: g, attach })
    else attached.current.delete(key)
  }

  return (
    <>
      {props.map((s) => {
        switch (s.type) {
          case 'rigid':
            return s.attach ? (
              <group key={s.key} ref={hold(s.key, s.attach)} matrixAutoUpdate={false}>
                <PropModel pieces={s.pieces} />
              </group>
            ) : (
              <PropModel key={s.key} pieces={s.pieces} />
            )
          case 'dumbbell':
            return (
              <group key={s.key} ref={hold(s.key, s.attach)} matrixAutoUpdate={false}>
                <Dumbbell {...s.params} />
              </group>
            )
          case 'bench':
            return (
              <group key={s.key} position={s.position}>
                <Bench {...s.params} />
              </group>
            )
          case 'dynamic':
            return null
        }
        return null
      })}
      {live.map(({ spec, prop }) => (
        <primitive key={spec.key} object={prop.group} />
      ))}
    </>
  )
}
