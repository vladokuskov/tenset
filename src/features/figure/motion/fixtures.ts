import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Part } from '../../../motion/implements.ts'
import { Kit, type Piece } from '../props/kit'

// Simple supports a template draws as bare cylinders and boxes (an upright to hold, a chest pad on a post), dressed
// in the props library's materials at exactly the template's geometry, so contacts and clearances still hold.

const Y = new Vector3(0, 1, 0)

export function fixtureParts(parts: Part[], m: Matrix4): Piece[] {
  const kit = new Kit()
  const rot = new Quaternion().setFromRotationMatrix(m)
  for (const part of parts) {
    if (part.shape === 'box') {
      const q = rot.clone().multiply(part.rot ? new Quaternion(...part.rot) : new Quaternion())
      const c = new Vector3(...part.center).applyMatrix4(m)
      const size = new Vector3(...part.size)
      if (part.pad) {
        kit.box(c, size, 'pad', q, 0.024)
        const down = Y.clone().applyQuaternion(q).multiplyScalar(-(size.y / 2 + 0.006))
        kit.box(c.clone().add(down), [size.x - 0.04, 0.012, size.z - 0.04], 'frameDark', q, 0.004)
      } else kit.box(c, size, 'frame', q)
      continue
    }
    const a = new Vector3(...part.a).applyMatrix4(m), b = new Vector3(...part.b).applyMatrix4(m)
    const lo = a.y < b.y ? a : b, hi = a.y < b.y ? b : a
    const vertical = Math.abs(hi.y - lo.y) > 0.9 * a.distanceTo(b)
    kit.rod(a, b, part.r, 'frame', 32)
    if (vertical) {
      // floor plate under an upright, rubber cap on top
      if (lo.y < 0.02) {
        kit.box([lo.x, 0.01, lo.z], [0.3, 0.02, 0.3], 'frame', undefined, 0.006)
        kit.box([lo.x, 0.003, lo.z], [0.28, 0.006, 0.28], 'rubber', undefined, 0.002)
      }
      kit.rod(hi, hi.clone().add(new Vector3(0, 0.012, 0)), part.r + 0.003, 'rubber', 24)
    } else {
      // a floor rail: rubber feet at both ends
      for (const e of [a, b]) kit.rod(e.clone().setY(Math.max(0, e.y - part.r)), e.clone().setY(Math.max(0, e.y - part.r) + 0.012), part.r + 0.012, 'rubber', 24)
    }
  }
  return kit.pieces
}
