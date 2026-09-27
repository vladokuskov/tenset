import { Matrix4, Quaternion, Vector3 } from 'three'
import { finish, Kit, vec, type PropBuild } from './kit.ts'
import { foot } from './parts.ts'
import type { GripSocket, SurfaceSocket } from './sockets.ts'

// 45-degree leg press. Frame as the squat template's leg press: X across, Y up, the lifter faces +Z; the sled rides up
// the rails along d = (0, sin a, cos a) from the hip point. Seat, back pad and side handles default to where the
// template (src/motion/templates/squat.ts) puts its drawn seat, pad and hand holds at a 45-degree sled.

type V3 = [number, number, number]

export type LegPressParams = {
  /** rail angle above horizontal (deg) */
  sledAngle?: number
  /** footplate surface centre-line position: distance from the hip point along the rails (m) */
  sled?: number
  /** hip point (the template's PRESS_HIP) */
  hip?: V3
  /** back pad angle above horizontal (deg) */
  backAngle?: number
  /** seat pan tilt, front edge up (deg) */
  seatTilt?: number
  /** 20 kg plates on each loading horn */
  plates?: number
  /** side hand-hold centres and axes; default: the template's */
  handles?: Record<'l' | 'r', { pos: V3; axis: V3 }>
}

export const legPressDefaults = { sledAngle: 45, sled: 0.87, hip: [0, 0.62, 0] as V3, backAngle: 43, seatTilt: 25, plates: 2 }

const HANDLES: Record<'l' | 'r', { pos: V3; axis: V3 }> = {
  l: { pos: [0.346, 0.959, 0.221], axis: [-0.382, 0.911, -0.154] },
  r: { pos: [-0.346, 0.959, 0.221], axis: [0.382, 0.911, -0.154] },
}

export const LEG_PRESS = { railX: 0.3, railDrop: 0.3, railFrom: 0.3, railTo: 1.62, sledMin: 0.5, sledMax: 1.35 }

export type LegPressSockets = {
  hip: Vector3
  seat: SurfaceSocket
  back: SurfaceSocket
  /** footplate: origin on the plate surface (the template's sled origin), normal towards the lifter, `up` along the plate */
  footplate: SurfaceSocket & { up: Vector3 }
  /** sled pose as the template's (X across, Y = plate normal towards the lifter, Z up the plate) */
  sled: { position: Vector3; quaternion: Quaternion }
  rail: { direction: Vector3; min: number; max: number }
  grips: Record<'l' | 'r', GripSocket>
}

const X = new Vector3(1, 0, 0)

export function buildLegPress(p: LegPressParams = {}): PropBuild<LegPressSockets> {
  const o = { ...legPressDefaults, ...p }
  const kit = new Kit()
  const H = vec(o.hip)
  const shift = H.clone().sub(vec(legPressDefaults.hip))
  const a = (o.sledAngle * Math.PI) / 180
  const d = new Vector3(0, Math.sin(a), Math.cos(a))
  const u = new Vector3(0, Math.cos(a), -Math.sin(a))
  const t = (o.seatTilt * Math.PI) / 180
  const f = new Vector3(0, Math.sin(t), Math.cos(t))
  const ns = new Vector3(0, Math.cos(t), -Math.sin(t))
  const b = (o.backAngle * Math.PI) / 180
  const bb = new Vector3(0, Math.sin(b), -Math.cos(b))
  const nb = new Vector3(0, Math.cos(b), Math.sin(b))
  const at = (base: Vector3, ...terms: [Vector3, number][]) => terms.reduce((acc, [v, s]) => acc.addScaledVector(v, s), base.clone())

  // seat and back pads with their backing boards
  const seatC = at(H, [f, 0.114], [ns, -0.087])
  kit.boxBasis(seatC, [0.42, 0.065, 0.42], 'pad', X, ns, 0.024)
  kit.boxBasis(at(seatC, [ns, -0.038]), [0.38, 0.012, 0.38], 'frameDark', X, ns, 0.004)
  const backC = at(H, [bb, 0.28], [nb, -0.19])
  kit.boxBasis(backC, [0.4, 0.065, 0.78], 'pad', X, nb, 0.024)
  kit.boxBasis(at(backC, [nb, -0.038]), [0.36, 0.012, 0.74], 'frameDark', X, nb, 0.004)

  // rails: steel rods on white beams, posts at both ends
  const { railX, railDrop, railFrom, railTo } = LEG_PRESS
  const rail = (s: number, x: number, drop = 0) => at(H, [d, s], [u, -railDrop - drop]).setX(x)
  const low = rail(railFrom, 0, 0.065), high = rail(railTo, 0, 0.065)
  for (const sx of [-1, 1]) {
    const x = sx * railX
    kit.rod(rail(railFrom, x), rail(railTo, x), 0.02, 'steel')
    kit.tube(rail(railFrom - 0.04, x, 0.065), rail(railTo + 0.04, x, 0.065), 0.07, 0.09, 'frame', { side: X, cap: 'both' })
    kit.tube([x, 0.05, low.z], [x, low.y - 0.03, low.z], 0.07, 0.07, 'frame')
    kit.tube([x, 0.05, high.z], [x, high.y - 0.03, high.z], 0.07, 0.07, 'frame')
    kit.tube([x, 0.025, -0.66], [x, 0.025, high.z + 0.16], 0.07, 0.05, 'frame', { side: X, cap: 'both' })
    foot(kit, [x, 0, -0.62])
    foot(kit, [x, 0, high.z + 0.12])
    // rubber stop at the bottom of the travel
    kit.rod(rail(LEG_PRESS.sledMin + 0.05, x), rail(LEG_PRESS.sledMin + 0.07, x), 0.034, 'rubber', 24)
  }
  for (const z of [-0.6, seatC.z, low.z, high.z]) kit.tube([-railX + 0.035, 0.025, z], [railX - 0.035, 0.025, z], 0.07, 0.05, 'frame', { side: [0, 0, 1] })
  kit.tube([-railX + 0.035, high.y - 0.065, high.z], [railX - 0.035, high.y - 0.065, high.z], 0.07, 0.07, 'frame', { side: [0, 0, 1] })

  // seat pedestal and back strut
  const seatUnder = at(seatC, [ns, -0.05])
  kit.tube([0, 0.05, seatC.z], [0, seatUnder.y, seatC.z], 0.08, 0.08, 'frame')
  const backUnder = at(H, [bb, 0.36], [nb, -0.24])
  kit.tube([0, 0.05, -0.6], backUnder, 0.07, 0.07, 'frame')
  kit.tube([0, seatUnder.y - 0.04, seatC.z], at(H, [bb, 0.02], [nb, -0.24]), 0.06, 0.06, 'frame')

  // side hand holds on stays from the seat frame
  const handles = p.handles ?? HANDLES
  const grips = {} as Record<'l' | 'r', GripSocket>
  for (const side of ['l', 'r'] as const) {
    const hpos = vec(handles[side].pos).add(p.handles ? new Vector3() : shift)
    const ax = vec(handles[side].axis).normalize()
    const lo = hpos.clone().addScaledVector(ax, -0.1), hi = hpos.clone().addScaledVector(ax, 0.1)
    kit.rod(lo, hi, 0.016, 'rubber', 24)
    kit.sphere(hi, 0.019, 'rubber')
    // round stay: out from under the seat, then up to the grip
    const root = at(seatC, [ns, -0.05]).setX(Math.sign(hpos.x) * 0.18)
    const bottom = lo.clone().addScaledVector(ax, -0.05)
    const knee = new Vector3(bottom.x, root.y, bottom.z)
    kit.rod(lo.clone().addScaledVector(ax, 0.01), bottom, 0.019, 'steel', 20)
    kit.rod(bottom, knee, 0.018, 'frame', 20)
    kit.rod(knee, root, 0.018, 'frame', 20)
    kit.sphere(knee, 0.018, 'frame')
    grips[side] = { position: hpos, axis: ax }
  }

  // sled: rubber-faced footplate on a tube carriage, bearing blocks on the rails, loading horns with plates
  const s = Math.min(Math.max(o.sled, LEG_PRESS.sledMin), LEG_PRESS.sledMax)
  const O = at(H, [d, s])
  const back = d.clone().negate()
  const S = (dd: number, uu: number, x = 0) => at(O, [d, dd], [u, uu]).setX(x)
  kit.boxBasis(S(0.006, 0.05), [0.72, 0.012, 0.66], 'rubber', X, back, 0.004)
  kit.boxBasis(S(0.025, 0.05), [0.76, 0.026, 0.72], 'frameDark', X, back, 0.008)
  kit.boxBasis(S(-0.012, -0.285), [0.72, 0.024, 0.02], 'frameDark', X, back, 0.005)
  const cx = 0.35
  for (const sx of [-1, 1]) {
    const x = sx * cx
    kit.tube(S(0.038, -0.24, x), S(0.3, -0.24, x), 0.05, 0.05, 'frame', { side: X, cap: 'b' })
    kit.tube(S(0.038, 0.3, x), S(0.3, -0.2, x), 0.05, 0.05, 'frame', { side: X })
    kit.tube(S(0.038, 0.33, x), S(0.038, -0.26, x), 0.05, 0.04, 'frame', { side: X })
    kit.boxBasis(S(0.17, -railDrop, sx * railX), [0.075, 0.2, 0.075], 'frameDark', X, back, 0.01)
    kit.boxBasis(S(0.17, -0.262, sx * (railX + cx) / 2), [cx - railX + 0.02, 0.16, 0.012], 'frameDark', X, back, 0.004)
    const horn = S(0.22, -0.04)
    kit.rod(horn.clone().setX(sx * (cx + 0.025)), horn.clone().setX(sx * 0.66), 0.025, 'steel')
    kit.rod(horn.clone().setX(sx * 0.66), horn.clone().setX(sx * 0.672), 0.032, 'steel')
    kit.rod(horn.clone().setX(sx * (cx + 0.025)), horn.clone().setX(sx * (cx + 0.035)), 0.05, 'frameDark', 32)
    for (let i = 0; i < o.plates; i++) kit.plate(horn.clone().setX(sx * (0.4 + i * 0.053)), [sx, 0, 0], 0.225, 0.05)
  }
  kit.tube(S(0.3, -0.24, -cx), S(0.3, -0.24, cx), 0.05, 0.05, 'frame', { side: back })
  kit.tube(S(0.17, -railDrop + 0.055, -railX), S(0.17, -railDrop + 0.055, railX), 0.05, 0.05, 'frame', { side: back })

  const sledQ = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(X, back, new Vector3().crossVectors(X, back)))
  return finish(kit, {
    hip: H,
    seat: { position: at(seatC, [ns, 0.0325]), normal: ns, along: f, size: [0.42, 0.42] },
    back: { position: at(backC, [nb, 0.0325]), normal: nb, along: bb, size: [0.78, 0.4] },
    footplate: { position: O, normal: back.clone(), up: u, along: u, size: [0.66, 0.72] },
    sled: { position: O, quaternion: sledQ },
    rail: { direction: d, min: LEG_PRESS.sledMin, max: LEG_PRESS.sledMax },
    grips,
  })
}

