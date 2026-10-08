import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Baked } from '../../../../../motion/bake.ts'
import type { Attachment, Part } from '../../../../../motion/implements.ts'
import { buildCableStack } from '../../cable.ts'
import type { MachineLayout, Poses } from '../../layout.ts'

// Low cable stack with a straight bar for templates whose params carry no attachment (the cable shrug): the template
// names its column `bar_stack` (the composer's generic `stack` would hang a D-handle), and this draws the stack and the
// bar from the template's own handle spec, as the composer's cable stack does.

type Cyl = Extract<Part, { shape: 'cylinder' }>

const V = (v: readonly number[]) => new Vector3(v[0], v[1], v[2])

function liftRange(b: Baked, id: string, from: Vector3) {
  const k = b.implements.findIndex((i) => i.id === id)
  let min = Infinity
  for (let i = 0; i < b.frames; i++) {
    const o = (i * b.implements.length + k) * 7
    min = Math.min(min, from.distanceTo(new Vector3(b.ip[o], b.ip[o + 1], b.ip[o + 2])))
  }
  return min
}

export function barStackLayouts(b: Baked): MachineLayout[] {
  const stack = b.implements.find((s) => s.id === 'bar_stack')
  const handle = b.implements.find((s) => s.kind === 'cable_handle')
  if (!stack || !handle || !b.cables?.length) return []
  const pulley = V(b.cables[0].pulley)
  const column = V((stack.parts[0] as Cyl).a).setY(0)
  const facing = pulley.clone().sub(column).setY(0).normalize()
  const placement = new Matrix4().makeRotationY(Math.atan2(facing.x, facing.z)).setPosition(column)
  const inv = placement.clone().invert()
  const min = liftRange(b, handle.id, pulley)
  const make = (attachment: Attachment | null) => (poses: Poses) => {
    const hp = poses.get(handle.id)!
    const local = new Matrix4().compose(V(hp.pos), new Quaternion(hp.rot[0], hp.rot[1], hp.rot[2], hp.rot[3]), new Vector3(1, 1, 1)).premultiply(inv)
    const pos = new Vector3(), rot = new Quaternion()
    local.decompose(pos, rot, new Vector3())
    const lift = Math.max(0, pulley.distanceTo(V(hp.pos)) - min)
    return { placement, pieces: buildCableStack({ pulley: pulley.y, attachment, attachmentSpec: handle, handle: { pos, rot }, stackLift: lift }).pieces }
  }
  return [{ key: 'bar-stack', holds: [handle.id], fixed: false, build: make('straight_bar'), solid: make(null) }]
}
