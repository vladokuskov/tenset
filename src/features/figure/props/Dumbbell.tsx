import { useEffect, useMemo } from 'react'
import { CylinderGeometry, LatheGeometry, Vector2 } from 'three'
import { propMaterials } from './materials'
import { DUMBBELL_COLLAR, dumbbellDefaults, type DumbbellParams } from './sockets'

/** round head with chamfered rims and a recessed face, revolved about +Y (turned onto X by the caller) */
function headProfile(r: number, w: number) {
  const c = Math.min(0.008, r * 0.12)
  const pts = [
    [0, 0], [r * 0.42, 0], [r * 0.46, 0.003], [r - c, 0.003], [r, c + 0.003], [r, w - c - 0.003], [r - c, w - 0.003],
    [r * 0.46, w - 0.003], [r * 0.42, w], [0, w],
  ]
  return pts.map(([x, y]) => new Vector2(x, y))
}

/** A generic round-head dumbbell, centred on its grip with the handle along X. */
export function Dumbbell(props: DumbbellParams) {
  const o = { ...dumbbellDefaults, ...props }
  const mats = propMaterials()
  const geo = useMemo(() => {
    const collarW = DUMBBELL_COLLAR
    return {
      handle: new CylinderGeometry(o.handleRadius, o.handleRadius, o.handle, 28, 1),
      collar: new CylinderGeometry(o.handleRadius * 1.55, o.handleRadius * 1.55, collarW, 28, 1),
      head: new LatheGeometry(headProfile(o.headRadius, o.headWidth), 56),
      collarW,
    }
  }, [o.handle, o.handleRadius, o.headRadius, o.headWidth])
  useEffect(() => () => {
    geo.handle.dispose()
    geo.collar.dispose()
    geo.head.dispose()
  }, [geo])
  const half = o.handle / 2
  return (
    <group rotation-z={-Math.PI / 2}>
      <mesh geometry={geo.handle} material={mats.handle} />
      {[1, -1].map((s) => (
        <group key={s}>
          <mesh geometry={geo.collar} material={mats.frameDark} position-y={s * (half + geo.collarW / 2)} />
          <mesh
            geometry={geo.head}
            material={mats.plate}
            position-y={s * (half + geo.collarW)}
            rotation-x={s > 0 ? 0 : Math.PI}
          />
        </group>
      ))}
    </group>
  )
}
