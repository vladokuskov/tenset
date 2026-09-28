import { Vector3 } from 'three'
import { BENCH_RACK } from '../../../../../motion/implements/press-horizontal.ts'
import { finish, Kit, type PropBuild } from '../../kit.ts'
import { foot, holeRow } from '../../parts.ts'
import type { GripSocket } from '../../sockets.ts'

// Bench-press uprights: two posts on floor rails joined by a rear floor member, J-cups on the posts' front faces
// (+Z, towards the lifter). Frame: origin on the floor between the posts, X across, Y up. The posts stand inside an
// Olympic bar's collars, so a racked bar rests on the cups between the plates.

export type UprightsParams = {
  /** bar axis height when racked on the cups (m) */
  hookHeight?: number
}

export const uprightsDefaults = { hookHeight: 1.15 }

export type UprightsSockets = { barRest: GripSocket; top: number }

const P = BENCH_RACK.post
/** floor rails: from behind the posts to in front of them, m */
const RAIL = { back: -0.3, front: 0.2 }

function cup(kit: Kit, x: number, h: number) {
  const face = P / 2
  const depth = BENCH_RACK.cup - face + 0.035
  // sleeve plate on the front face and side cheeks round the post
  kit.box([x, h + 0.03, face + 0.005], [P + 0.012, 0.16, 0.01], 'frame', undefined, 0.004)
  for (const s of [-1, 1]) kit.box([x + s * (face + 0.004), h + 0.03, face - 0.02], [0.008, 0.16, 0.05], 'frame', undefined, 0.003)
  // cradle with a black liner and a front lip; the bar rests at BENCH_RACK.cup in front of the post centre
  const zc = face + 0.01 + depth / 2
  kit.box([x, h - 0.014 - 0.017, zc], [P - 0.006, 0.022, depth], 'frame', undefined, 0.005)
  kit.box([x, h - 0.018, zc], [P - 0.004, 0.008, depth - 0.002], 'rubber', undefined, 0.003)
  kit.box([x, h + 0.004, face + 0.01 + depth - 0.006], [P - 0.004, 0.05, 0.014], 'rubber', undefined, 0.005)
  kit.knob([x + Math.sign(x) * (face + 0.008), h + 0.08, face - 0.02], [Math.sign(x), 0, 0], 0.012)
}

export function buildUprights(p: UprightsParams = {}): PropBuild<UprightsSockets> {
  const o = { ...uprightsDefaults, ...p }
  const kit = new Kit()
  const { x } = BENCH_RACK
  const top = o.hookHeight + BENCH_RACK.top
  for (const s of [-1, 1]) {
    const xs = s * x
    kit.tube([xs, 0.025, RAIL.back], [xs, 0.025, RAIL.front], P, 0.05, 'frame', { side: [1, 0, 0], cap: 'both' })
    foot(kit, [xs, 0, RAIL.back + 0.04])
    foot(kit, [xs, 0, RAIL.front - 0.04])
    kit.tube([xs, 0.05, 0], [xs, top, 0], P, P, 'frame', { cap: 'b' })
    // gusset from the rail up the post's rear face
    kit.tube([xs, 0.05, -P / 2 - 0.06], [xs, 0.26, -P / 2 - 0.004], 0.04, 0.03, 'frame', { side: [1, 0, 0] })
    holeRow(kit, xs, P / 2, [0, 0, 1], 0.45, top - 0.08, 0.05)
    cup(kit, xs, o.hookHeight)
  }
  kit.tube([-x + P / 2, 0.025, RAIL.back + 0.03], [x - P / 2, 0.025, RAIL.back + 0.03], P, 0.05, 'frame', { side: [0, 0, 1] })
  return finish(kit, { barRest: { position: new Vector3(0, o.hookHeight, BENCH_RACK.cup), axis: new Vector3(1, 0, 0) }, top })
}
