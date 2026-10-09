import { Matrix4 } from 'three'
import type { Baked } from '../../../../motion/bake.ts'
import type { ImplementSpec } from '../../../../motion/implements.ts'
import { bandPath, isAnchor, isBand } from '../../../../motion/implements/index.ts'
import { buildBandAnchor, buildBandGrip, buildBandHandle, drawBandStrip } from '../band.ts'
import { buildKettlebell, buildTrapBar, buildWeightPlate } from '../free-weights.ts'
import { Kit, type Piece } from '../kit.ts'
import { firstPose, fixedLayout, poseMatrix4, type LayoutSource, type MachineLayout, type Poses } from '../layout.ts'

// Portable equipment (bands, kettlebells, plates, the trap bar) drawn where a template places its implements.
// Held weights and band handles follow their implement's pose; their collision is the implement's own parts (the
// body-prop and equipment gates), so the drawn layout has no solid pieces. The band strip is rebuilt every frame through
// its path and never collides. A band anchor stands still and collides like a wall or post.

const NONE: Piece[] = []

/** pieces in the implement frame, or null when this module does not draw the kind */
function heldPieces(spec: ImplementSpec, b: Baked): Piece[] | null {
  switch (spec.kind) {
    case 'kettlebell':
      return buildKettlebell({ spec }).pieces
    case 'weight_plate':
      return buildWeightPlate({ spec }).pieces
    case 'trap_bar':
      return buildTrapBar({ spec }).pieces
    case 'band_handle':
      return buildBandHandle(spec).pieces
    case 'band_grip': {
      const strip = b.implements.find((s) => isBand(s) && s.band.path.some((p) => p.implement === spec.id))
      return buildBandGrip(strip && isBand(strip) ? strip.band.width : undefined).pieces
    }
  }
  return null
}

function follow(key: string, id: string, pieces: Piece[]): MachineLayout {
  return {
    key,
    holds: [],
    fixed: false,
    build: (poses) => ({ placement: poseMatrix4(poses.get(id)!), pieces }),
    solid: (poses) => ({ placement: poseMatrix4(poses.get(id)!), pieces: NONE }),
  }
}

export const layouts: LayoutSource = (b) => {
  const out: MachineLayout[] = []
  const specs = new Map(b.implements.map((s) => [s.id, s]))
  for (const spec of b.implements) {
    if (isBand(spec)) {
      const id = new Matrix4()
      const build = (poses: Poses) => ({ placement: id, pieces: drawBandStrip(new Kit(), bandPath(spec, specs, poses), spec.band).pieces })
      out.push({ key: spec.id, holds: [], fixed: false, build, solid: () => ({ placement: id, pieces: NONE }) })
      continue
    }
    if (isAnchor(spec)) {
      out.push(fixedLayout(spec.id, poseMatrix4(firstPose(b, spec.id)!), buildBandAnchor(spec).pieces, { whole: true }))
      continue
    }
    const pieces = heldPieces(spec, b)
    if (pieces) out.push(follow(spec.id, spec.id, pieces))
  }
  return out
}
