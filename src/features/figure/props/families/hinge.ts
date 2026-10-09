import type { Baked } from '../../../../motion/bake.ts'
import type { ImplementSpec } from '../../../../motion/implements.ts'
import { buildBarbell } from '../barbell.ts'
import { firstPose, fixedLayout, poseMatrix4, type LayoutSource, type MachineLayout, type Poses } from '../layout.ts'
import { buildSmith } from '../smith.ts'
import { buildBackExtension } from './hinge/back-extension.ts'
import { buildBarPad } from './hinge/bar-pad.ts'
import { buildThrustBench } from './hinge/thrust-bench.ts'

// F7 hinge: prop builders (Kit pieces in the props materials) with their sockets, and the layouts that draw them
// around a baked motion. Layout pieces are also the QA penetration gate's collision primitives (collision.ts).

/** the bar pad rides the bar; it is collided as the template's implement (a pad), so the layout adds no colliders */
function barPadLayout(spec: ImplementSpec): MachineLayout {
  const pieces = buildBarPad()
  const build = (poses: ReadonlyMap<string, { pos: readonly number[]; rot: readonly number[] }>) => ({ placement: poseMatrix4(poses.get(spec.id)!), pieces })
  return { key: 'bar-pad', holds: [], fixed: false, build, solid: build, colliders: () => [] }
}

/**
 * Smith hip thrust: the frame turned round on the rail line (180 deg about Y), so its rear posts and base stand beyond
 * the lifter's feet and the open front faces the bench. The bar is drawn as the template's barbell; the safety stops
 * sit under the carriages' lowest point
 */
function smithReversedLayout(b: Baked): MachineLayout {
  const bar = b.implements.find((s) => s.id === 'bar')!
  const gripWidth = Math.abs(bar.sites.l.pos[0] - bar.sites.r.pos[0])
  const plates = Math.round((bar.mass - 20) / 2 / 20)
  const barCount = buildBarbell({ gripWidth, plates }).pieces.length
  const k = b.implements.indexOf(bar)
  let low = Infinity
  for (let i = 0; i < b.frames; i++) low = Math.min(low, b.ip[(i * b.implements.length + k) * 7 + 1])
  const safetyHeight = low - 0.09
  const build = (poses: Poses) => {
    const p = poses.get('bar')!.pos
    const pieces = buildSmith({ barHeight: p[1], gripWidth, plates, safetyHeight }).pieces
    return { placement: poseMatrix4({ pos: [p[0], 0, p[2]], rot: [0, 1, 0, 0] }), pieces: pieces.slice(0, pieces.length - barCount) }
  }
  return { key: 'smith-reversed', holds: ['bar'], fixed: false, build, solid: build }
}

export const layouts: LayoutSource = (b) => {
  const out: MachineLayout[] = []
  for (const spec of b.implements) {
    if (spec.kind === 'thrust_bench') out.push(fixedLayout('thrust-bench', poseMatrix4(firstPose(b, spec.id)!), buildThrustBench({ height: spec.sites.edge.pos[1] }).pieces))
    if (spec.kind === 'bar_pad') out.push(barPadLayout(spec))
    if (spec.id === 'smith_reversed') out.push(smithReversedLayout(b))
    if (spec.kind === 'back_extension') out.push(fixedLayout('back-extension', poseMatrix4(firstPose(b, spec.id)!), buildBackExtension(spec)))
  }
  return out
}
