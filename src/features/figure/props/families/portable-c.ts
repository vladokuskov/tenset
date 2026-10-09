import { Matrix4 } from 'three'
import type { ImplementSpec } from '../../../../motion/implements.ts'
import { abWheelSpin, isRingAnchor, isRingStrap, strapPath } from '../../../../motion/implements/index.ts'
import { qrot, type V3 } from '../../../../motion/math.ts'
import { Kit, type Piece } from '../kit.ts'
import { firstPose, fixedLayout, poseMatrix4, type LayoutSource, type MachineLayout, type Poses } from '../layout.ts'
import { buildAbWheel, buildLandmine, buildLandmineBar, buildRing, buildRingAnchor, drawRingStrap, spinPieces } from '../portable-c.ts'

// Tier C portable equipment drawn where a template places its implements: rings and the landmine bar follow their
// implement (their collision is the implement's own parts), the ab wheel follows and its tyre turns with the distance
// rolled, ring straps are rebuilt every frame along their path and never collide, the ring anchor and the landmine
// base stand still and collide like machines.

const NONE: Piece[] = []
const ID = new Matrix4()

function follow(id: string, pieces: (poses: Poses) => Piece[]): MachineLayout {
  return {
    key: id,
    holds: [],
    fixed: false,
    build: (poses) => ({ placement: poseMatrix4(poses.get(id)!), pieces: pieces(poses) }),
    solid: (poses) => ({ placement: poseMatrix4(poses.get(id)!), pieces: NONE }),
  }
}

/** the strap's width direction: the X axis of the implement at its last path point (the ring), else world X */
function strapSide(spec: ImplementSpec & { strap: { path: { implement: string }[] } }, poses: Poses): V3 {
  const last = spec.strap.path[spec.strap.path.length - 1]
  const pose = last && poses.get(last.implement)
  return pose ? qrot(pose.rot, [1, 0, 0]) : [1, 0, 0]
}

export const layouts: LayoutSource = (b) => {
  const out: MachineLayout[] = []
  const specs = new Map(b.implements.map((s) => [s.id, s]))
  for (const spec of b.implements) {
    if (isRingStrap(spec)) {
      const build = (poses: Poses) => ({ placement: ID, pieces: drawRingStrap(new Kit(), strapPath(spec, specs, poses), strapSide(spec, poses)).pieces })
      out.push({ key: spec.id, holds: [], fixed: false, build, solid: () => ({ placement: ID, pieces: NONE }) })
      continue
    }
    if (isRingAnchor(spec)) {
      out.push(fixedLayout(spec.id, poseMatrix4(firstPose(b, spec.id)!), buildRingAnchor(spec).pieces, spec.whole ? { whole: true } : {}))
      continue
    }
    switch (spec.kind) {
      case 'landmine':
        out.push(fixedLayout(spec.id, poseMatrix4(firstPose(b, spec.id)!), buildLandmine(spec).pieces))
        break
      case 'gym_ring': {
        const pieces = buildRing(spec).pieces
        out.push(follow(spec.id, () => pieces))
        break
      }
      case 'landmine_bar': {
        const pieces = buildLandmineBar({ spec }).pieces
        out.push(follow(spec.id, () => pieces))
        break
      }
      case 'ab_wheel': {
        const w = buildAbWheel(spec)
        out.push(follow(spec.id, (poses) => [...spinPieces(w.wheel, abWheelSpin(poses.get(spec.id)!)), ...w.fixed]))
        break
      }
    }
  }
  return out
}
