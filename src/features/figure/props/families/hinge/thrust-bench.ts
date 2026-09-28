import { Vector3 } from 'three'
import { THRUST_BENCH } from '../../../../../motion/implements/hinge.ts'
import { finish, Kit, type PropBuild } from '../../kit.ts'
import { BENCH, type SurfaceSocket } from '../../sockets.ts'

/**
 * Flat bench laid across the lifter for hip thrusts, in the adjustable bench's style: black pad on a board, a spine
 * rail and two T-legs with rubber feet. Frame as the implement (implements/hinge.ts thrustBench): origin on the floor
 * under the middle of the pad's front edge, the pad towards -Z, long axis X.
 */
export function buildThrustBench(p: { height?: number } = {}): PropBuild<{ top: SurfaceSocket }> {
  const { width: w, length: l, thick: t } = THRUST_BENCH
  const h = p.height ?? THRUST_BENCH.height
  const zc = -w / 2
  const kit = new Kit()
  kit.box([0, h - t / 2, zc], [l, t, w], 'pad', undefined, 0.022)
  kit.box([0, h - t - 0.006, zc], [l - 0.04, 0.012, w - 0.04], 'frameDark', undefined, 0.003)
  const legs = [-1, 1].map((s) => s * (l / 2 - 0.12))
  for (const x of legs) {
    kit.tube([x, 0.035, zc - 0.24], [x, 0.035, zc + 0.24], 0.07, 0.05, 'frame')
    for (const s of [-1, 1]) kit.box([x, 0.017, zc + s * 0.25], [0.06, 0.035, 0.07], 'rubber', undefined, 0.012)
    kit.tube([x, 0.05, zc], [x, h - t - 0.012, zc], 0.07, 0.05, 'frame')
  }
  kit.tube([legs[0], BENCH.railY, zc], [legs[1], BENCH.railY, zc], 0.08, 0.06, 'frame')
  return finish(kit, { top: { position: new Vector3(0, h, zc), normal: new Vector3(0, 1, 0), along: new Vector3(1, 0, 0), size: [l, w] } })
}
