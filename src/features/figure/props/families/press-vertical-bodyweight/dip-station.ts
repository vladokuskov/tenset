import { DIP } from '../../../../../motion/implements/press-vertical-bodyweight.ts'
import type { ImplementSpec, Part } from '../../../../../motion/implements.ts'
import { finish, Kit, type PropBuild } from '../../kit.ts'
import { foot } from '../../parts.ts'
import { gripSocket, type GripSocket } from '../../sockets.ts'

// Free-standing dip station: two parallel bars on front and rear uprights, long floor rails with cross members at
// the ends, braces. Bars from the motion's dip bar descriptor (implements/press-vertical-bodyweight.ts). Frame:
// origin on the floor between the grips, bars along Z, the lifter faces +Z and hangs between them.

type Cyl = Extract<Part, { shape: 'cylinder' }>

const POST = 0.06
const RAIL = 0.62

export function buildDipStation(p: { spec: ImplementSpec }): PropBuild<{ grips: Record<string, GripSocket> }> {
  const kit = new Kit()
  const bars = p.spec.parts.filter((c): c is Cyl => c.shape === 'cylinder')
  for (const b of bars) {
    kit.knurl(b.a, b.b, b.r, 'handle')
    for (const e of [b.a, b.b]) kit.rod([e[0], e[1], e[2] + Math.sign(e[2]) * -0.004], [e[0], e[1], e[2] + Math.sign(e[2]) * 0.012], b.r + 0.004, 'rubber', 24)
  }
  const h = DIP.height
  const zs = [DIP.from + 0.06, DIP.to - 0.06]
  for (const b of bars) {
    const x = b.a[0], s = Math.sign(x)
    const xo = x + s * (b.r + POST / 2 + 0.004)
    kit.tube([xo, 0.025, -RAIL], [xo, 0.025, RAIL], POST, 0.05, 'frame', { side: [1, 0, 0], cap: 'both' })
    foot(kit, [xo, 0, -RAIL + 0.04])
    foot(kit, [xo, 0, RAIL - 0.04])
    for (const z of zs) {
      kit.tube([xo, 0.05, z], [xo, h + 0.03, z], POST, POST, 'frame', { cap: 'b' })
      // bar bracket from the upright in to the bar
      kit.box([(xo + x) / 2, h, z], [Math.abs(xo - x) + 0.02, 0.045, 0.05], 'frame', undefined, 0.008)
      // brace down and out to the rail end
      kit.tube([xo, 0.55, z], [xo, 0.05, Math.sign(z) * (RAIL - 0.12)], 0.045, 0.045, 'frame', { side: [1, 0, 0] })
    }
  }
  const w = Math.abs(bars[0].a[0]) + bars[0].r + POST + 0.004
  for (const z of [-RAIL + 0.03, RAIL - 0.03]) kit.tube([-w + POST / 2, 0.025, z], [w - POST / 2, 0.025, z], 0.05, 0.05, 'frame', { side: [0, 0, 1] })
  return finish(kit, { grips: Object.fromEntries(Object.entries(p.spec.sites).map(([k, s]) => [k, gripSocket(s)])) })
}
