import { Vector3 } from 'three'
import type { Baked } from '../../../../../motion/bake.ts'
import type { Attachment, ImplementSpec } from '../../../../../motion/implements.ts'
import type { RowStationGeometry } from '../../../../../motion/implements/back.ts'
import { firstPose, poseMatrix4, type MachineLayout, type Poses } from '../../layout.ts'
import { buildRowStation } from './row-station.ts'

// Layouts for the back family's props, drawn by the composer and collided by the motion QA gate.

type Box = Extract<ImplementSpec['parts'][number], { shape: 'box' }>

const V = (v: readonly number[]) => new Vector3(v[0], v[1], v[2])

/** closest approach of an implement's origin to a point over the loop (the cable's shortest length) */
function nearest(b: Baked, id: string, from: Vector3) {
  const k = b.implements.findIndex((i) => i.id === id)
  let min = Infinity
  for (let i = 0; i < b.frames; i++) {
    const o = (i * b.implements.length + k) * 7
    min = Math.min(min, from.distanceTo(new Vector3(b.ip[o], b.ip[o + 1], b.ip[o + 2])))
  }
  return min
}

export function rowStationGeometry(spec: ImplementSpec): RowStationGeometry {
  const seat = spec.parts[0] as Box
  const n = spec.sites.plate_l.normal!
  return {
    seatTop: spec.sites.seat.pos[1],
    seatZ: [seat.center[2] - seat.size[2] / 2, seat.center[2] + seat.size[2] / 2],
    plates: [spec.sites.plate_l.pos, spec.sites.plate_r.pos],
    plateAngle: (Math.asin(Math.max(-1, Math.min(1, -n[2]))) * 180) / Math.PI,
    pulley: spec.sites.pulley.pos,
  }
}

export function rowStationLayouts(b: Baked): MachineLayout[] {
  const spec = b.implements.find((s) => s.kind === 'row_station')
  const handle = b.implements.find((s) => s.kind === 'cable_handle')
  if (!spec || !handle) return []
  const placement = poseMatrix4(firstPose(b, spec.id)!)
  const geo = rowStationGeometry(spec)
  const pulley = V(geo.pulley)
  const min = nearest(b, handle.id, pulley)
  const kind = (b.params.attachment as Attachment | undefined) ?? 'v_bar'
  const make = (attachment: Attachment | null) => (poses: Poses) => {
    const hp = poses.get(handle.id)!
    const lift = Math.max(0, pulley.distanceTo(V(hp.pos)) - min)
    return { placement, pieces: buildRowStation({ geo, attachment, attachmentSpec: handle, handle: { pos: hp.pos, rot: hp.rot }, stackLift: lift }).pieces }
  }
  return [{ key: 'row-station', holds: [handle.id], fixed: false, build: make(kind), solid: make(null), whole: true }]
}
