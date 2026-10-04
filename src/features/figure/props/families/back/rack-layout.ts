import type { Baked } from '../../../../../motion/bake.ts'
import { firstPose, fixedLayout, poseMatrix4, type MachineLayout } from '../../layout.ts'
import { buildSquatRack } from '../../rack.ts'

/**
 * the half rack under a racked bar (inverted row), drawn where the template's rack marker stands; framed by its base,
 * so the lifter (who lies low) fills the frame and the uprights run out of the top (the 407 precedent for tall frames)
 */
export function rackLayouts(b: Baked): MachineLayout[] {
  const spec = b.implements.find((s) => s.kind === 'row_rack')
  if (!spec) return []
  const pieces = buildSquatRack({ hookHeight: spec.sites.bar.pos[1], safetyHeight: spec.sites.safety.pos[1] }).pieces
  return [fixedLayout('row-rack', poseMatrix4(firstPose(b, spec.id)!), pieces)]
}
