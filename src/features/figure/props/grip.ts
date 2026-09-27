import { Matrix4, Vector3 } from 'three'
import type { Rig } from '../rig'

export type Side = 'L' | 'R'

const v = () => new Vector3()

/** Grip socket of a closed hand, in world space: centre of a ~33 mm handle held in a power grip, `axis` along the
 * knuckle line (pinky -> index), `palmar` out of the palm, `distal` towards the fingers. */
export function gripFrame(rig: Rig, side: Side, { palm = 0.024, forward = 0.012 } = {}) {
  const p = (name: string) => rig.bone(`${name}_${side}`).getWorldPosition(v())
  const wrist = p('wrist')
  const index = p('finger2-1'), middle = p('finger3-1'), ring = p('finger4-1'), pinky = p('finger5-1')
  const knuckles = v().add(index).add(middle).add(ring).add(pinky).multiplyScalar(0.25)
  const distal = middle.clone().sub(wrist).normalize()
  const axis = index.clone().sub(pinky)
  axis.addScaledVector(distal, -axis.dot(distal)).normalize()
  const palmar = v().crossVectors(distal, axis).multiplyScalar(side === 'L' ? 1 : -1)
  const position = knuckles.addScaledVector(palmar, palm).addScaledVector(distal, forward)
  return { position, axis, palmar, distal }
}

/** World matrix that puts a prop's grip socket (handle along +X) into the hand. */
export function gripMatrix(rig: Rig, side: Side, out = new Matrix4()) {
  const g = gripFrame(rig, side)
  const y = g.palmar
  const z = v().crossVectors(g.axis, y)
  return out.makeBasis(g.axis, y, z).setPosition(g.position)
}
