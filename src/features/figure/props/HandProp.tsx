import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Matrix4, type Group } from 'three'
import type { FigureHandle } from '../Figure'
import { gripMatrix, type Side } from './grip'

const m = new Matrix4()

/** Keeps its children (a prop centred on its grip socket, handle along +X) in the figure's hand. */
export function HandProp({ figure, side, children }: { figure: FigureHandle; side: Side; children: ReactNode }) {
  const ref = useRef<Group>(null)
  const place = () => {
    const g = ref.current
    if (!g) return
    figure.scene.updateMatrixWorld(true)
    gripMatrix(figure.rig, side, m)
    if (g.parent) m.premultiply(g.parent.matrixWorld.clone().invert())
    m.decompose(g.position, g.quaternion, g.scale)
  }
  useLayoutEffect(place)
  useFrame(place)
  return <group ref={ref}>{children}</group>
}
