import { useEffect, useMemo } from 'react'
import { InstancedMesh } from 'three'
import { geometry, type Piece } from './kit'
import { propMaterials } from './materials'

/** Draws a prop's pieces: one instanced mesh per (geometry, material) pair, shared geometry and materials. */
export function PropModel({ pieces }: { pieces: Piece[] }) {
  const meshes = useMemo(() => {
    const mats = propMaterials()
    const groups = new Map<string, Piece[]>()
    for (const p of pieces) {
      const k = `${p.geo}|${p.mat}`
      const list = groups.get(k)
      if (list) list.push(p)
      else groups.set(k, [p])
    }
    return [...groups.values()].map((list) => {
      const mesh = new InstancedMesh(geometry(list[0].geo), mats[list[0].mat], list.length)
      list.forEach((p, i) => mesh.setMatrixAt(i, p.matrix))
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      mesh.computeBoundingBox()
      return mesh
    })
  }, [pieces])
  useEffect(() => () => meshes.forEach((m) => m.dispose()), [meshes])
  return (
    <>
      {meshes.map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </>
  )
}
