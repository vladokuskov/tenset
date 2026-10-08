import { Matrix4, Quaternion, Vector3 } from 'three'
import { ROPE } from '../../../../motion/implements/arms.ts'
import { Kit } from '../kit.ts'
import type { LayoutSource, MachineLayout, Poses } from '../layout.ts'
import { crossBenchLayouts } from './arms/bench.ts'

// F8 arms: prop builders (Kit pieces in the props materials) with their sockets, and the layouts that draw them
// around a baked motion. Layout pieces are also the QA penetration gate's collision primitives (collision.ts).

const V = (v: readonly number[]) => new Vector3(v[0], v[1], v[2])
const Q = (q: readonly number[]) => new Quaternion(q[0], q[1], q[2], q[3])

/**
 * spreading rope: free strands from the ferrule and the fist pieces, drawn like the rope attachment (cable.ts). A strand
 * is as long as its spec (the collision part plus the tucked end); where it meets its fist past the fist piece's end
 * (a template's longer exit), the rope bends on to it
 */
function drawRope(poses: Poses, strands: { id: string; free: number }[], ends: string[]) {
  const kit = new Kit()
  const tips: Vector3[] = []
  for (const { id, free } of strands) {
    const p = poses.get(id)
    if (!p) continue
    const a = V(p.pos)
    const tip = a.clone().add(new Vector3(0, -free, 0).applyQuaternion(Q(p.rot)))
    kit.rod(a, tip, ROPE.r, 'rope', 16)
    tips.push(tip)
  }
  ends.forEach((id, k) => {
    const p = poses.get(id)
    if (!p) return
    const at = (x: number) => new Vector3(x, 0, 0).applyQuaternion(Q(p.rot)).add(V(p.pos))
    kit.rod(at(ROPE.entry), at(-ROPE.exit), ROPE.r, 'rope', 16)
    kit.rod(at(-ROPE.stop.from), at(-ROPE.stop.to), ROPE.stop.r, 'rubber', 24)
    kit.sphere(at(-ROPE.stop.to), ROPE.stop.r, 'rubber')
    const tip = tips[k]
    if (tip && tip.distanceTo(at(ROPE.entry)) > 0.005) kit.rod(at(ROPE.entry), tip, ROPE.r, 'rope', 16)
  })
  return kit.pieces
}

export const layouts: LayoutSource = (b) => {
  const out: MachineLayout[] = []
  const strands = b.implements
    .filter((s) => s.kind === 'rope_strand')
    .map((s) => {
      const part = s.parts[0]
      const free = part?.shape === 'cylinder' ? Math.hypot(...part.b.map((v, i) => v - part.a[i])) + ROPE.tuck : ROPE.free
      return { id: s.id, free }
    })
  const ends = b.implements.filter((s) => s.kind === 'rope_end').map((s) => s.id)
  if (strands.length || ends.length) {
    const placement = new Matrix4()
    // the strands and fist pieces are the template's implements: the gates already collide those
    out.push({ key: 'rope', holds: ends, fixed: false, build: (poses) => ({ placement, pieces: drawRope(poses, strands, ends) }), solid: () => ({ placement, pieces: [] }) })
  }
  out.push(...crossBenchLayouts(b))
  return out
}
