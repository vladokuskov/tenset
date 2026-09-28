import { Vector3 } from 'three'
import type { ImplementSpec, Part } from '../../../../../motion/implements.ts'
import { finish, Kit, vec, type PropBuild } from '../../kit.ts'
import { foot } from '../../parts.ts'
import { drawPad } from './knee-machine.ts'

// Floor Nordic station (kneeling pad on a low base, ankle roller on two uprights behind it) and the thick catch mat,
// at the geometry the leg-curl template puts in their specs. World frame, the lifter faces +Z.

type Box = Extract<Part, { shape: 'box' }>
type Cyl = Extract<Part, { shape: 'cylinder' }>

const X = new Vector3(1, 0, 0)
const Z = new Vector3(0, 0, 1)

export function buildNordicStation(spec: ImplementSpec): PropBuild<Record<string, never>> {
  const kit = new Kit()
  const pad = spec.parts[0] as Box
  const roller = spec.parts[1] as Cyl
  drawPad(kit, pad)
  const c = vec(roller.a).add(vec(roller.b)).multiplyScalar(0.5)
  const half = Math.abs(roller.b[0] - roller.a[0]) / 2
  const zFront = pad.center[2] + pad.size[2] / 2 + 0.03
  const zBack = c.z - 0.05
  const rail = half + 0.05
  for (const s of [-1, 1]) {
    kit.tube([s * rail, 0.02, zBack], [s * rail, 0.02, zFront], 0.05, 0.04, 'frame', { side: X, cap: 'both' })
    foot(kit, [s * rail, 0, zFront - 0.03], 0.06, 0.05)
    foot(kit, [s * rail, 0, zBack + 0.03], 0.06, 0.05)
  }
  for (const z of [zFront - 0.02, zBack + 0.02]) kit.tube([-rail, 0.02, z], [rail, 0.02, z], 0.05, 0.04, 'frame', { side: Z })
  // platform under the kneeling pad
  const under = pad.center[1] - pad.size[1] / 2 - 0.012
  kit.box([0, (0.04 + under) / 2, pad.center[2]], [pad.size[0] - 0.06, Math.max(0.01, under - 0.04), pad.size[2] - 0.06], 'frame', undefined, 0.006)
  // roller uprights with an axle and a height pin
  const post = half + 0.035
  for (const s of [-1, 1]) {
    kit.tube([s * post, 0.04, c.z], [s * post, c.y + 0.07, c.z], 0.045, 0.045, 'frame', { cap: 'b' })
    kit.knob([s * (post + 0.022), c.y - 0.06, c.z], [s, 0, 0], 0.012)
    kit.tube([s * post, 0.02, c.z], [s * rail, 0.02, c.z], 0.045, 0.04, 'frame', { side: Z })
  }
  kit.rod([-post, c.y, c.z], [post, c.y, c.z], 0.012, 'steel', 16)
  kit.rod(roller.a, roller.b, roller.r, 'pad', 32)
  for (const s of [-1, 1]) kit.rod([s * (half - 0.004), c.y, c.z], [s * (half + 0.006), c.y, c.z], roller.r * 0.55, 'frameDark', 24)
  return finish(kit, {})
}

/** thick dark mat, in its own frame (origin on the floor under its centre) */
export function buildCatchMat(spec: ImplementSpec): PropBuild<Record<string, never>> {
  const kit = new Kit()
  const b = spec.parts[0] as Box
  kit.box(b.center, b.size, 'mat', undefined, 0.012)
  return finish(kit, {})
}
