import type { ImplementSpec } from '../../../../motion/implements.ts'
import { firstPose, fixedLayout, poseMatrix4, type LayoutSource, type MachineLayout } from '../layout.ts'
import { buildFloorMat, buildPlyoBox, buildWall } from '../shared.ts'

// Shared supports (plyo box / step, floor mat, wall section) drawn where a template places their implements.

type Box = Extract<ImplementSpec['parts'][number], { shape: 'box' }>

const firstBox = (spec: ImplementSpec) => spec.parts.find((p): p is Box => p.shape === 'box')!

function pieces(spec: ImplementSpec) {
  const b = firstBox(spec)
  switch (spec.kind) {
    case 'plyo_box':
      return buildPlyoBox({ height: spec.sites.top.pos[1], width: b.size[0], depth: b.size[2] }).pieces
    case 'mat':
      return buildFloorMat({ width: b.size[0], length: b.size[2] }).pieces
    case 'wall':
      return buildWall({ width: b.size[0], height: b.size[1] }).pieces
  }
  return null
}

export const layouts: LayoutSource = (b) => {
  const out: MachineLayout[] = []
  for (const spec of b.implements) {
    const p = pieces(spec)
    // a box stands taller than the composer's floor-part cut: frame it whole so its base stays in the picture
    if (p) out.push(fixedLayout(spec.id, poseMatrix4(firstPose(b, spec.id)!), p, spec.kind === 'plyo_box' ? { whole: true } : {}))
  }
  return out
}
