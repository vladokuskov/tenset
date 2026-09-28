import { Vector3 } from 'three'
import type { ImplementSpec, Part } from '../../../../../motion/implements.ts'
import { finish, Kit, type PropBuild } from '../../kit.ts'
import { foot } from '../../parts.ts'
import { drawPad } from './knee-machine.ts'

// The split squat's flat bench at the geometry of its spec (src/motion/implements/legs-knee.ts splitBench): a long pad
// on a board, two posts on cross feet. Own frame: origin on the floor under the pad's near end, the pad running back.

type Box = Extract<Part, { shape: 'box' }>

const X = new Vector3(1, 0, 0)

export function buildSplitBench(spec: ImplementSpec): PropBuild<Record<string, never>> {
  const kit = new Kit()
  const [pad, ...rest] = spec.parts as Box[]
  const posts = rest.slice(0, rest.length / 2)
  drawPad(kit, pad)
  const under = pad.center[1] - pad.size[1] / 2 - 0.012
  // a rail under the pad joins the posts
  const z0 = posts[0].center[2], z1 = posts[posts.length - 1].center[2]
  kit.tube([0, under - 0.02, z0 + 0.03], [0, under - 0.02, z1 - 0.03], 0.06, 0.04, 'frame', { side: X, cap: 'both' })
  for (const p of posts) {
    const z = p.center[2]
    kit.tube([0, 0.04, z], [0, under - 0.02, z], p.size[0], p.size[2], 'frame')
    kit.tube([-0.2, 0.02, z], [0.2, 0.02, z], 0.05, 0.04, 'frame', { side: new Vector3(0, 0, 1), cap: 'both' })
    foot(kit, [-0.17, 0, z])
    foot(kit, [0.17, 0, z])
  }
  return finish(kit, {})
}
