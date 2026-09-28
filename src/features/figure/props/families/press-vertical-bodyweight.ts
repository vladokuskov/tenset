import { Matrix4 } from 'three'
import type { Baked } from '../../../../motion/bake.ts'
import { PRESS_MACHINE, type PressGeometry } from '../../../../motion/implements/press-vertical-bodyweight.ts'
import { firstPose, fixedLayout, poseMatrix4, type LayoutSource, type MachineLayout, type Poses } from '../layout.ts'
import { buildDipStation } from './press-vertical-bodyweight/dip-station.ts'
import { buildShoulderPress, HELD_PIECES } from './press-vertical-bodyweight/shoulder-press.ts'
import { buildTallSmith } from './press-vertical-bodyweight/smith.ts'

// F2 press-vertical-bodyweight: the shoulder press machine, the tall Smith frame (standing overhead press) and the
// dip station, laid out on the template's implements. The pieces are also the QA penetration gate's collision
// primitives (collision.ts).

const id = new Matrix4()

/** lever angle (deg) of the press handles from their pose: a rotation about X */
function leverAngle(poses: Poses): number {
  const r = poses.get('handles')!.rot
  return (-2 * Math.atan2(r[0], r[3]) * 180) / Math.PI
}

function shoulderPress(b: Baked): MachineLayout | null {
  const handles = b.implements.find((s) => s.kind === 'press_handles')
  const frame = b.implements.find((s) => s.kind === 'shoulder_press')
  if (!handles || !frame) return null
  const first = firstPose(b, 'handles')!
  const a = leverAngle(new Map([['handles', first]])) * (Math.PI / 180)
  const { arm } = PRESS_MACHINE
  const pivot: [number, number, number] = [first.pos[0], first.pos[1] - arm * Math.sin(a), first.pos[2] - arm * Math.cos(a)]
  const half = handles.sites.l.pos[0]
  const [seat, back] = frame.parts as Extract<(typeof frame.parts)[number], { shape: 'box' }>[]
  const g: PressGeometry = { pivot, half, arm, angle0: 0, angle1: 0, seat: seat.center[1] + seat.size[1] / 2, back: back.center }
  const build = (poses: Poses) => ({ placement: id, pieces: buildShoulderPress(g, leverAngle(poses)).pieces })
  return {
    key: 'shoulder-press',
    holds: ['handles'],
    fixed: false,
    build,
    solid: (poses) => ({ placement: id, pieces: build(poses).pieces.slice(HELD_PIECES) }),
  }
}

function tallSmith(b: Baked): MachineLayout | null {
  if (b.template !== 'vertical-press' || b.params.implement !== 'smith') return null
  const build = (poses: Poses) => {
    const p = poses.get('bar')!.pos
    return { placement: new Matrix4().makeTranslation(p[0], 0, p[2]), pieces: buildTallSmith({ barHeight: p[1] }).pieces }
  }
  // framed base to top: the frame is only a little taller than the bar at lockout
  return { key: 'tall-smith', holds: ['bar'], fixed: false, build, solid: build, whole: true }
}

function dipStation(b: Baked): MachineLayout | null {
  const spec = b.implements.find((s) => s.kind === 'dip_bars')
  if (!spec) return null
  const pose = firstPose(b, spec.id)!
  return fixedLayout('dip-station', poseMatrix4(pose), buildDipStation({ spec }).pieces, { holds: [spec.id], whole: true })
}

export const layouts: LayoutSource = (b) => [shoulderPress(b), tallSmith(b), dipStation(b)].filter((l): l is MachineLayout => !!l)
