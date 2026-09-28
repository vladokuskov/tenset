import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Baked } from '../../../../../motion/bake.ts'
import type { ImplementSpec } from '../../../../../motion/implements.ts'
import { ROPE_END } from '../../../../../motion/templates/row/cable.ts'
import { Kit } from '../../kit.ts'
import type { MachineLayout, Poses } from '../../layout.ts'

// Split rope for the face pull: the cable stack draws the knot (a rope attachment without strands); this draws each
// strand from the ferrule to the fist that holds it, the rope through the fist and the rubber stopper under the little
// finger. The strands and rope ends are the template's implements, so the gates collide those, not these pieces.

const V = (v: readonly number[]) => new Vector3(v[0], v[1], v[2])
const Q = (q: readonly number[]) => new Quaternion(q[0], q[1], q[2], q[3])

export function ropeLayouts(b: Baked): MachineLayout[] {
  const ends = b.implements.filter((s) => s.kind === 'row_rope_end')
  if (!ends.length) return []
  const build = (poses: Poses) => {
    const kit = new Kit()
    for (const spec of ends as ImplementSpec[]) {
      const p = poses.get(spec.id)!
      const from = V(poses.get(spec.id.replace('rope_', 'strand_'))!.pos)
      const at = (x: number) => new Vector3(x, 0, 0).applyQuaternion(Q(p.rot)).add(V(p.pos))
      const inFist = at(ROPE_END.grip)
      kit.rod(from, inFist, ROPE_END.r, 'rope', 16)
      kit.rod(inFist, at(-ROPE_END.grip), ROPE_END.r, 'rope', 16)
      kit.rod(at(-ROPE_END.grip - 0.004), at(-ROPE_END.grip - ROPE_END.stopper), ROPE_END.stopperR, 'rubber', 24)
      kit.sphere(at(-ROPE_END.grip - ROPE_END.stopper), ROPE_END.stopperR, 'rubber')
    }
    return { placement: new Matrix4(), pieces: kit.pieces }
  }
  const placement = new Matrix4()
  return [{ key: 'row-rope', holds: ends.map((s) => s.id), fixed: false, build, solid: () => ({ placement, pieces: [] }) }]
}
