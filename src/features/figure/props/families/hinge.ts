import type { ImplementSpec } from '../../../../motion/implements.ts'
import { firstPose, fixedLayout, poseMatrix4, type LayoutSource, type MachineLayout } from '../layout.ts'
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

export const layouts: LayoutSource = (b) => {
  const out: MachineLayout[] = []
  for (const spec of b.implements) {
    if (spec.kind === 'thrust_bench') out.push(fixedLayout('thrust-bench', poseMatrix4(firstPose(b, spec.id)!), buildThrustBench({ height: spec.sites.edge.pos[1] }).pieces))
    if (spec.kind === 'bar_pad') out.push(barPadLayout(spec))
    if (spec.kind === 'back_extension') out.push(fixedLayout('back-extension', poseMatrix4(firstPose(b, spec.id)!), buildBackExtension(spec)))
  }
  return out
}
