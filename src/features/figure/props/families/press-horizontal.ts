import type { Baked } from '../../../../motion/bake.ts'
import type { ImplementSpec, Part } from '../../../../motion/implements.ts'
import { firstPose, fixedLayout, poseMatrix4, type LayoutSource, type MachineLayout, type Poses } from '../layout.ts'
import { qrot, type Quat, type V3 } from '../../../../motion/math.ts'
import { buildChestPress, CAM_R, type ChestPressParams } from './press-horizontal/chest-press.ts'
import { buildUprights } from './press-horizontal/uprights.ts'

// F1 press-horizontal: bench-press uprights where a template places its 'rack' implement, and the seated chest press
// around its 'machine' frame and 'handles' lever arms. Layout pieces are also the QA penetration gate's collision
// primitives (collision.ts).

type Box = Extract<Part, { shape: 'box' }>

/** lever angle about X from the arm pose, deg */
const swingOf = (rot: readonly number[]) => (2 * Math.atan2(rot[0], rot[3]) * 180) / Math.PI

/** the drawn chest press's parameters at the lever pose in `poses` (the stack rides up as the levers turn) */
export function chestPressParams(b: Baked, machine: ImplementSpec, arms: ImplementSpec): (poses: Poses) => ChestPressParams {
  const [seat, back] = machine.parts as Box[]
  const k = b.implements.indexOf(arms)
  let min = Infinity
  for (let i = 0; i < b.frames; i++) {
    const o = (i * b.implements.length + k) * 7
    min = Math.min(min, swingOf([b.ip[o + 3], b.ip[o + 4], b.ip[o + 5], b.ip[o + 6]]))
  }
  const hinge = machine.sites.hinge.pos
  const base = {
    seatHeight: seat.center[1] + seat.size[1] / 2,
    recline: -swingOf(back.rot!),
    backBottom: [hinge[0], hinge[1], hinge[2]] as [number, number, number],
    reach: -arms.sites.pivot.pos[1],
    gripHalf: arms.sites.l.pos[0],
  }
  return (poses) => {
    const p = poses.get(arms.id)!
    const swing = swingOf(p.rot)
    const off = qrot(p.rot as Quat, arms.sites.pivot.pos as V3)
    const pivot: V3 = [p.pos[0] + off[0], p.pos[1] + off[1], p.pos[2] + off[2]]
    return { ...base, pivot, swing, stackLift: (CAM_R * (swing - min) * Math.PI) / 180 }
  }
}

function chestPressLayout(b: Baked, machine: ImplementSpec, arms: ImplementSpec): MachineLayout {
  const params = chestPressParams(b, machine, arms)
  const build = (poses: Poses) => ({ placement: poseMatrix4(firstPose(b, machine.id)!), pieces: buildChestPress(params(poses)).pieces })
  // framed whole: the stack tower behind the back pad stands above the head
  return { key: 'chest-press', holds: [arms.id], fixed: false, build, solid: build, whole: true }
}

export const layouts: LayoutSource = (b) => {
  const out: MachineLayout[] = []
  const rack = b.implements.find((s) => s.kind === 'bench_rack')
  if (rack) {
    const pose = firstPose(b, rack.id)!
    out.push(fixedLayout('rack', poseMatrix4(pose), buildUprights({ hookHeight: rack.sites.l.pos[1] }).pieces, { whole: true }))
  }
  const machine = b.implements.find((s) => s.kind === 'chest_press')
  const arms = b.implements.find((s) => s.kind === 'press_arms')
  if (machine && arms) out.push(chestPressLayout(b, machine, arms))
  return out
}
