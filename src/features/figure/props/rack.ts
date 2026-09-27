import { Vector3 } from 'three'
import { finish, Kit, type PropBuild } from './kit'
import { foot, holeRow } from './parts'

// Half rack: front and rear uprights, J-hooks and spotter arms on the front uprights, the lifter works in front
// (+Z). Frame: X across, Y up, origin on the floor between the front uprights.

export type SquatRackParams = {
  /** bar axis height when the bar rests on the J-hooks (m) */
  hookHeight?: number
  /** bar axis height when the bar rests on the spotter arms (m) */
  safetyHeight?: number
}

export const squatRackDefaults = { hookHeight: 1.4, safetyHeight: 0.85 }

export const RACK = {
  /** upright centres (|x|): inside an Olympic bar's collars (0.64) with ~4 cm to spare */
  x: 0.56,
  post: 0.075,
  depth: 0.6,
  height: 2.28,
  armLength: 0.72,
}

export type SquatRackSockets = {
  /** bar centre when racked, bar along X */
  barRest: { position: Vector3; axis: Vector3 }
  /** bar centre resting on the spotter arms at their middle */
  safetyRest: { position: Vector3; axis: Vector3 }
  /** |x| of the hooks' cradles (a racked bar must be longer than this between collars) */
  hookX: number
}

const P = RACK.post

function jHook(kit: Kit, x: number, h: number) {
  const face = P / 2
  const bottom = h - 0.014
  // sleeve plate on the front face, side cheeks hugging the post
  kit.box([x, h + 0.02, face + 0.005], [P + 0.012, 0.17, 0.01], 'frame', undefined, 0.004)
  for (const s of [-1, 1]) kit.box([x + s * (face + 0.004), h + 0.02, face - 0.02], [0.008, 0.17, 0.05], 'frame', undefined, 0.003)
  // cradle arm with a black liner, lip at the front
  kit.box([x, bottom - 0.006 - 0.011, face + 0.01 + 0.045], [P - 0.006, 0.022, 0.09], 'frame', undefined, 0.005)
  kit.box([x, bottom - 0.003, face + 0.01 + 0.043], [P - 0.004, 0.008, 0.088], 'rubber', undefined, 0.003)
  kit.box([x, bottom + 0.012, face + 0.01 + 0.09 - 0.006], [P - 0.004, 0.058, 0.016], 'rubber', undefined, 0.006)
  kit.knob([x + Math.sign(x) * (face + 0.008), h + 0.07, face - 0.02], [Math.sign(x), 0, 0], 0.012)
  return face + 0.01 + 0.045
}

function spotterArm(kit: Kit, x: number, h: number) {
  const face = P / 2
  const top = h - 0.014
  const y = top - 0.008 - 0.0375
  kit.box([x, y, face + 0.006], [P + 0.012, 0.14, 0.012], 'frame', undefined, 0.004)
  kit.tube([x, y, face + 0.012], [x, y, RACK.armLength], 0.05, 0.075, 'frame', { side: [1, 0, 0], cap: 'b' })
  kit.box([x, top - 0.004, (face + RACK.armLength) / 2 + 0.01], [0.046, 0.008, RACK.armLength - face - 0.03], 'rubber', undefined, 0.002)
  kit.knob([x + Math.sign(x) * (face + 0.004), y - 0.045, face - 0.015], [Math.sign(x), 0, 0], 0.012)
}

export function buildSquatRack(p: SquatRackParams = {}): PropBuild<SquatRackSockets> {
  const o = { ...squatRackDefaults, ...p }
  const kit = new Kit()
  const { x, depth, height } = RACK
  const zr = -depth
  for (const s of [-1, 1]) {
    const xs = s * x
    // floor foot, uprights, top side member
    kit.tube([xs, 0.025, zr - 0.14], [xs, 0.025, 0.32], P, 0.05, 'frame', { side: [1, 0, 0], cap: 'both' })
    foot(kit, [xs, 0, zr - 0.1])
    foot(kit, [xs, 0, 0.28])
    for (const z of [0, zr]) {
      kit.tube([xs, 0.05, z], [xs, height, z], P, P, 'frame', { cap: 'b' })
      kit.bolt([xs + s * (P / 2), 0.09, z], [s, 0, 0])
      kit.bolt([xs - s * (P / 2), 0.09, z], [-s, 0, 0])
    }
    kit.tube([xs, height - P / 2, zr + P / 2], [xs, height - P / 2, -P / 2], P, P, 'frame')
    // adjustment holes: front face of the front upright, inner faces of both, rear face of the rear one
    holeRow(kit, xs, P / 2, [0, 0, 1], 0.25, 2.15, 0.05)
    holeRow(kit, xs, zr - P / 2, [0, 0, -1], 0.25, 2.15, 0.05)
    for (const z of [0, zr]) {
      for (let y = 0.25; y <= 2.15 + 1e-6; y += 0.05) kit.hole([xs - s * (P / 2), y, z], [-s, 0, 0])
    }
    // plate storage horn on the rear upright
    kit.box([xs, 0.42, zr - P / 2 - 0.006], [P, 0.1, 0.012], 'frame', undefined, 0.004)
    kit.rod([xs, 0.42, zr - P / 2 - 0.012], [xs, 0.42, zr - P / 2 - 0.25], 0.025, 'steel')
    kit.rod([xs, 0.42, zr - P / 2 - 0.25], [xs, 0.42, zr - P / 2 - 0.262], 0.032, 'steel')
  }
  // rear floor cross member, top cross members front and rear
  kit.tube([-x + P / 2, 0.025, zr], [x - P / 2, 0.025, zr], P, 0.05, 'frame', { side: [0, 0, 1] })
  kit.tube([-x + P / 2, height - P / 2, 0], [x - P / 2, height - P / 2, 0], P, P, 'frame', { side: [0, 0, 1] })
  kit.tube([-x + P / 2, height - P / 2, zr], [x - P / 2, height - P / 2, zr], P, P, 'frame', { side: [0, 0, 1] })
  let zRest = 0
  for (const s of [-1, 1]) {
    zRest = jHook(kit, s * x, o.hookHeight)
    spotterArm(kit, s * x, o.safetyHeight)
  }
  return finish(kit, {
    barRest: { position: new Vector3(0, o.hookHeight, zRest), axis: new Vector3(1, 0, 0) },
    safetyRest: { position: new Vector3(0, o.safetyHeight, (P / 2 + RACK.armLength) / 2), axis: new Vector3(1, 0, 0) },
    hookX: x,
  })
}
