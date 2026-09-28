import { Matrix4 } from 'three'
import type { Baked } from '../../../../motion/bake.ts'
import { Kit } from '../kit.ts'
import { firstPose, fixedLayout, poseMatrix4, type LayoutSource, type MachineLayout, type Poses } from '../layout.ts'
import { buildKneeLever, buildLyingKneeMachine, buildSeatedKneeMachine, CAM_R } from './legs-knee/knee-machine.ts'
import { buildSplitBench } from './legs-knee/bench.ts'
import { buildCatchMat, buildNordicStation } from './legs-knee/nordic.ts'

// F5 legs-knee: the knee machines, Nordic station, catch mat and split squat bench drawn where the templates place
// their implements.
// Layout pieces are also the QA penetration gate's collision primitives (collision.ts).

/** lever rotation about +X, rad */
const leverAngle = (rot: readonly number[]) => 2 * Math.atan2(rot[0], rot[3])

function leverAngles(b: Baked, id: string) {
  const k = b.implements.findIndex((s) => s.id === id)
  const out: number[] = []
  for (let i = 0; i < b.frames; i++) {
    const o = (i * b.implements.length + k) * 7
    out.push(leverAngle([b.ip[o + 3], b.ip[o + 4], b.ip[o + 5], b.ip[o + 6]]))
  }
  return out
}

const MACHINES = { leg_extension: buildSeatedKneeMachine, leg_curl_seated: buildSeatedKneeMachine, leg_curl_lying: buildLyingKneeMachine }

export const layouts: LayoutSource = (b) => {
  const out: MachineLayout[] = []
  const machine = b.implements.find((s) => s.kind in MACHINES)
  const lever = b.implements.find((s) => s.kind === 'knee_lever')
  if (machine && lever) {
    const draw = MACHINES[machine.kind as keyof typeof MACHINES]
    const handles = b.implements.find((s) => s.kind === 'machine_handles')
    const angles = leverAngles(b, lever.id)
    // the stack rests at the end of the eccentric: knees bent on the extension, straight on the curls
    const rest = machine.kind === 'leg_extension' ? Math.max(...angles) : Math.min(...angles)
    const leverPieces = buildKneeLever(lever).pieces
    const build = (poses: Poses) => {
      const lp = poses.get(lever.id)!
      const frame = draw(machine, handles, CAM_R * Math.abs(leverAngle(lp.rot) - rest)).pieces
      return { placement: new Matrix4(), pieces: new Kit().merge({ pieces: frame }).merge({ pieces: leverPieces }, poseMatrix4(lp)).pieces }
    }
    out.push({ key: 'knee-machine', holds: handles ? [handles.id] : [], fixed: false, build, solid: build })
  }
  for (const spec of b.implements) {
    const pose = firstPose(b, spec.id)!
    if (spec.kind === 'nordic_station') out.push(fixedLayout('nordic-station', poseMatrix4(pose), buildNordicStation(spec).pieces))
    // the mat is collided as the template's implement, which carries the resting tolerance for the hands
    if (spec.kind === 'catch_pad') out.push(fixedLayout('catch-mat', poseMatrix4(pose), buildCatchMat(spec).pieces, { colliders: () => [] }))
    // collided as the template's implement (its parts match the drawing), which carries the resting foot's tolerance
    if (spec.kind === 'split_bench') out.push(fixedLayout('split-bench', poseMatrix4(pose), buildSplitBench(spec).pieces, { colliders: () => [], whole: true }))
  }
  return out
}
