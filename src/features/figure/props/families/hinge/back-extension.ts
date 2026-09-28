import { Quaternion, Vector3 } from 'three'
import type { ImplementSpec, Part } from '../../../../../motion/implements.ts'
import { BACK_EXTENSION } from '../../../../../motion/implements/hinge.ts'
import { Kit, type Piece } from '../../kit.ts'

type Box = Extract<Part, { shape: 'box' }>
type Cyl = Extract<Part, { shape: 'cylinder' }>

const V = (v: readonly number[]) => new Vector3(v[0], v[1], v[2])
const Q = (q: readonly number[]) => new Quaternion(q[0], q[1], q[2], q[3])

/**
 * 45-degree back extension bench drawn round the implement (implements/hinge.ts backExtensionBench, world space): pads,
 * roller and tread are its parts; the frame (inclined beam, supports, base rail, strut, stabilisers) follows from its
 * sites. Light frame, black pads, rubber tread, steel axle.
 */
export function buildBackExtension(spec: ImplementSpec): Piece[] {
  const [pad, plate, roller] = spec.parts as [Box, Box, Cyl]
  const { base } = BACK_EXTENSION
  const kit = new Kit()
  const n = V(spec.sites.pad.normal!).negate()
  const u = V(spec.sites.beam.axis!)

  kit.box(pad.center, pad.size, 'pad', Q(pad.rot!), 0.024)
  // backing board, kept clear of the pad's upper edge (the arms fold past it at the bottom)
  const board = V(pad.center).addScaledVector(n, pad.size[1] / 2 + 0.006).addScaledVector(u, -0.03)
  kit.box(board, [pad.size[0] - 0.06, 0.012, pad.size[2] - 0.1], 'frameDark', Q(pad.rot!), 0.003)

  const tread = 0.01
  kit.box(V(plate.center).addScaledVector(u, -tread / 2), [plate.size[0], plate.size[1] - tread, plate.size[2]], 'frame', Q(plate.rot!), 0.006)
  kit.box(V(plate.center).addScaledVector(u, plate.size[1] / 2 - tread / 2), [plate.size[0] - 0.004, tread, plate.size[2] - 0.004], 'rubber', Q(plate.rot!), 0.003)

  kit.rod(roller.a, roller.b, roller.r, 'pad', 32)
  const half = Math.abs(roller.a[0])
  const axle = V(roller.a).setX(0)
  kit.rod(axle.clone().setX(-half - 0.05), axle.clone().setX(half + 0.05), 0.012, 'steel', 16)

  // inclined beam in front of the legs, from the floor up to the pad
  const b0 = V(spec.sites.beam.pos)
  const along = (t: number) => b0.clone().addScaledVector(u, t)
  const t0 = (base.y + 0.03 - b0.y) / u.y
  const t1 = V(pad.center).sub(b0).dot(u)
  kit.tube(along(t0), along(t1 + 0.04), 0.08, 0.06, 'frame')
  kit.tube(along(t1), board, 0.06, 0.05, 'frame')
  // plate on a bracket from the beam; roller on side struts from the plate's rear corners
  const plateFront = V(plate.center).addScaledVector(n, plate.size[2] / 2 - 0.03)
  kit.tube(plateFront, along(plateFront.clone().sub(b0).dot(u)), 0.06, 0.05, 'frame')
  const plateRear = V(plate.center).addScaledVector(n, -plate.size[2] / 2 + 0.03)
  for (const s of [-1, 1]) kit.tube(plateRear.clone().setX(s * (half + 0.03)), axle.clone().setX(s * (half + 0.03)), 0.04, 0.04, 'frame')
  kit.tube(plateRear.clone().setX(-half - 0.03), plateRear.clone().setX(half + 0.03), 0.04, 0.04, 'frame')

  // base rail, strut up to the beam, stabilisers with rubber feet
  const rear = along(t0).z - base.rear, front = along(t1).z + base.front
  kit.tube([0, base.y, rear], [0, base.y, front], 0.08, 0.06, 'frame')
  const mid = along((t0 + t1) / 2)
  kit.tube([0, base.y, mid.z], mid, 0.07, 0.05, 'frame')
  for (const z of [rear, front]) {
    kit.tube([-0.3, base.y, z], [0.3, base.y, z], 0.07, 0.05, 'frame')
    for (const s of [-1, 1]) kit.box([s * 0.31, 0.017, z], [0.06, 0.035, 0.07], 'rubber', undefined, 0.012)
  }
  return kit.pieces
}
