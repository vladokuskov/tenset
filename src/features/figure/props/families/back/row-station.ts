import { Quaternion, Vector3 } from 'three'
import type { Attachment, ImplementSpec } from '../../../../../motion/implements.ts'
import { plateNormal, plateRotation, ROW_STATION, type RowStationGeometry } from '../../../../../motion/implements/back.ts'
import { hangAttachment, type HandlePose } from '../../cable.ts'
import { finish, Kit, type PropBuild } from '../../kit.ts'
import { cableRun, foot, pulley, WHEEL_R, weightStack } from '../../parts.ts'
import type { GripSocket, SurfaceSocket } from '../../sockets.ts'

// Seated cable row station: long padded seat on a floor rail, two angled foot plates either side of the low pulley,
// a cable guard along the floor and a compact weight-stack tower in front. Contact surfaces (seat top, plate faces,
// pulley) come from the motion implement (implements/back.ts rowStation), so the drawing and the gates agree.
// Frame: world (X across, Y up, the lifter faces +Z).

export type RowStationParams = {
  geo: RowStationGeometry
  attachment: Attachment | null
  attachmentSpec?: ImplementSpec
  /** attachment origin pose (carabiner), world */
  handle?: HandlePose
  stackLift?: number
}

export type RowStationSockets = { seat: SurfaceSocket; plates: SurfaceSocket[]; grips: Record<string, GripSocket> }

export function buildRowStation(p: RowStationParams): PropBuild<RowStationSockets> {
  const kit = new Kit()
  const g = p.geo
  const { seat, plate, towerZ, towerHeight, railY } = ROW_STATION
  const [z0, z1] = g.seatZ
  const zc = (z0 + z1) / 2
  const n = plateNormal(g.plateAngle)
  const N = new Vector3(...n)
  const rot = new Quaternion(...plateRotation(g.plateAngle))
  const P1 = new Vector3(...g.pulley)
  const plateZ = (g.plates[0][2] + g.plates[1][2]) / 2
  const plateY = (g.plates[0][1] + g.plates[1][1]) / 2
  const mountZ = plateZ + 0.08
  const zt = plateZ + towerZ

  // floor rail from behind the seat to the foot plate frame, then the cable guard on to the tower
  kit.tube([0, railY, z0 - 0.08], [0, railY, mountZ], 0.09, 0.05, 'frame', { side: [1, 0, 0], cap: 'a' })
  for (const z of [z0 - 0.02]) {
    kit.tube([-0.26, railY, z], [0.26, railY, z], 0.06, 0.05, 'frame', { side: [0, 0, 1], cap: 'both' })
    foot(kit, [-0.23, 0, z])
    foot(kit, [0.23, 0, z])
  }

  // seat: pad on a board, two posts down to the rail
  kit.box([0, g.seatTop - seat.thick / 2, zc], [seat.width, seat.thick, z1 - z0], 'pad', undefined, 0.026)
  kit.box([0, g.seatTop - seat.thick - 0.006, zc], [seat.width - 0.04, 0.012, z1 - z0 - 0.04], 'frameDark', undefined, 0.004)
  for (const z of [z0 + 0.15, z1 - 0.15]) kit.tube([0, railY + 0.025, z], [0, g.seatTop - seat.thick - 0.012, z], 0.06, 0.06, 'frame')

  // foot plate frame: an upright off the rail and a cross tube behind the plates
  const crossY = plateY - 0.02
  kit.tube([0, railY + 0.025, mountZ], [0, crossY + 0.03, mountZ], 0.07, 0.07, 'frame', { cap: 'b' })
  const xs = Math.abs(g.plates[0][0]) + plate.width / 2 - 0.02
  kit.tube([-xs, crossY, mountZ], [xs, crossY, mountZ], 0.05, 0.05, 'frame', { side: [0, 0, 1], cap: 'both' })
  for (const c of g.plates) {
    const C = new Vector3(...c)
    const face = C.clone().addScaledVector(N, -plate.face / 2)
    const back = C.clone().addScaledVector(N, -(plate.face + plate.back / 2))
    kit.box(face, [plate.width, plate.face, plate.height], 'pad', rot, 0.006)
    kit.box(back, [plate.width, plate.back, plate.height], 'frame', rot, 0.004)
    // bracket from the plate back to the cross tube
    const b = back.clone().addScaledVector(N, -plate.back / 2 - 0.01)
    kit.tube(b, new Vector3(c[0], crossY, mountZ - 0.025), 0.04, 0.03, 'frameDark', { side: [1, 0, 0] })
  }

  // low pulley between the plates, cheek plates down to the frame
  pulley(kit, P1, [1, 0, 0])
  for (const s of [-1, 1]) kit.box([s * 0.022, (P1.y + crossY) / 2, P1.z + 0.02], [0.006, crossY - P1.y + 0.1, 0.07], 'frameDark', undefined, 0.002)

  // cable guard from the plate frame to the tower, at the height of the run under the low pulley
  const R = WHEEL_R
  const guardY = P1.y - R
  const frontZ = zt + 0.12
  kit.tube([0, guardY, mountZ + 0.03], [0, guardY, frontZ + R + 0.035], 0.07, 0.06, 'frame', { side: [1, 0, 0], cap: 'both' })
  kit.tube([0, railY, frontZ + R], [0, guardY - 0.03, frontZ + R], 0.05, 0.05, 'frame')

  // tower: base, two posts, top cross member with the head pulleys, weight stack between the posts
  for (const s of [-1, 1]) {
    kit.tube([s * 0.26, railY, zt - 0.3], [s * 0.26, railY, zt + 0.3], 0.06, 0.05, 'frame', { side: [1, 0, 0], cap: 'both' })
    foot(kit, [s * 0.26, 0, zt - 0.26])
    foot(kit, [s * 0.26, 0, zt + 0.26])
    kit.tube([s * 0.2, 0.05, zt], [s * 0.2, towerHeight, zt], 0.06, 0.06, 'frame', { cap: 'b' })
  }
  kit.tube([-0.23, railY, zt], [0.23, railY, zt], 0.06, 0.05, 'frame', { side: [0, 0, 1] })
  kit.tube([-0.25, towerHeight + 0.03, zt], [0.25, towerHeight + 0.03, zt], 0.07, 0.07, 'frame', { side: [0, 0, 1], cap: 'both' })
  kit.tube([0, towerHeight + 0.03, zt - 0.06], [0, towerHeight + 0.03, zt + 0.2], 0.07, 0.06, 'frame', { side: [1, 0, 0], cap: 'both' })
  const headY = towerHeight - 0.05
  const front = new Vector3(0, headY, frontZ)
  const over = new Vector3(0, headY, zt + R)
  pulley(kit, front, [1, 0, 0])
  pulley(kit, over, [1, 0, 0])
  const stackTop = weightStack(kit, [0, 0, zt], { top: towerHeight - 0.2, lift: p.stackLift, plates: 12 })

  // cable: stack -> over the head -> down the tower front -> along the guard -> round the low pulley -> attachment
  cableRun(kit, [stackTop, new Vector3(0, headY, zt)])
  cableRun(kit, [new Vector3(0, headY + R, over.z), new Vector3(0, headY + R, front.z)])
  cableRun(kit, [new Vector3(0, headY, front.z + R), new Vector3(0, guardY + 0.03, front.z + R)])
  cableRun(kit, [new Vector3(0, guardY, mountZ - 0.01), new Vector3(0, guardY, P1.z)])
  const handle = p.handle ?? { pos: [0, P1.y + 0.2, P1.z - 0.5] }
  const hung = hangAttachment(kit, P1, handle, { attachment: p.attachment, spec: p.attachmentSpec, plane: () => new Vector3(0, 0, -1), wrap: 'ccw' })

  return finish(kit, {
    seat: { position: new Vector3(0, g.seatTop, zc), normal: new Vector3(0, 1, 0), along: new Vector3(0, 0, 1), size: [z1 - z0, seat.width] },
    plates: g.plates.map((c) => ({ position: new Vector3(...c), normal: N.clone() })),
    grips: hung.grips,
  })
}
