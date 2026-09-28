import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Baked } from '../../../../motion/bake.ts'
import { cableHandle, type ImplementSpec } from '../../../../motion/implements.ts'
import { buildCableStack } from '../cable.ts'
import { Kit } from '../kit.ts'
import { firstPose, poseMatrix4, type LayoutSource, type MachineLayout, type Poses } from '../layout.ts'
import { buildPecDeck, buildPecDeckArm } from './chest-shoulder-isolation/pec-deck.ts'

// F3 chest-shoulder-isolation: the pec deck (frame plus the two arms the hands hold) and the cable crossover (two
// single-column cable stacks, each drawing its cable to the handle it pulls). Layout pieces are also the QA
// penetration gate's collision primitives (collision.ts).

const V = (v: readonly number[]) => new Vector3(v[0], v[1], v[2])
const merged = (pieces: ReturnType<typeof buildPecDeckArm>['pieces'], m: Matrix4) => new Kit().merge({ pieces }, m).pieces

/** closest approach of an implement to a point over the loop */
function minDistance(b: Baked, id: string, from: Vector3) {
  const k = b.implements.findIndex((i) => i.id === id)
  let min = Infinity
  for (let i = 0; i < b.frames; i++) {
    const o = (i * b.implements.length + k) * 7
    min = Math.min(min, from.distanceTo(new Vector3(b.ip[o], b.ip[o + 1], b.ip[o + 2])))
  }
  return min
}

/** rotation of an arm about Y from its pose quaternion (rad) */
const yaw = (rot: readonly number[]) => 2 * Math.atan2(rot[1], rot[3])

function pecDeckLayouts(b: Baked, frame: ImplementSpec): MachineLayout[] {
  const pose = firstPose(b, frame.id)!
  const placement = poseMatrix4(pose)
  const seat = frame.parts[0] as Extract<ImplementSpec['parts'][number], { shape: 'box' }>
  const pad = frame.parts[1] as Extract<ImplementSpec['parts'][number], { shape: 'box' }>
  const pl = frame.sites.pl.pos
  const params = {
    seatHeight: seat.center[1] + seat.size[1] / 2,
    pad: [pad.center[1] - pad.size[1] / 2, pad.center[1] + pad.size[1] / 2] as [number, number],
    pivot: { x: pl[0], y: pl[1], z: pl[2] },
  }
  const arms = b.implements.filter((s) => s.kind === 'pec_deck_arm')
  // the stack rises as the arms leave the start of the rep (loop start is the top of the rep)
  const start = arms.map((a) => yaw(firstPose(b, a.id)!.rot))
  let travel = 0
  for (let i = 0; i < b.frames; i++) {
    arms.forEach((a, n) => {
      const o = (i * b.implements.length + b.implements.indexOf(a)) * 7
      travel = Math.max(travel, Math.abs(yaw([b.ip[o + 3], b.ip[o + 4], b.ip[o + 5], b.ip[o + 6]]) - start[n]))
    })
  }
  const lift = (poses: Poses) => {
    if (!travel) return 0
    const moved = Math.max(...arms.map((a, n) => Math.abs(yaw(poses.get(a.id)!.rot) - start[n])))
    return 0.14 * (1 - moved / travel)
  }
  const build = (poses: Poses) => ({ placement, pieces: buildPecDeck({ ...params, stackLift: lift(poses) }).pieces })
  const armPieces = new Map(arms.map((a) => [a.id, buildPecDeckArm(a).pieces]))
  const out: MachineLayout[] = [{ key: 'pec-deck', holds: [], fixed: false, build, solid: build }]
  if (arms.length) {
    const drawArms = (poses: Poses) => ({
      placement: new Matrix4(),
      pieces: arms.flatMap((a) => merged(armPieces.get(a.id)!, poseMatrix4(poses.get(a.id)!))),
    })
    // the arms are implements: the gates check them as such, so they add no colliders here
    out.push({ key: 'pec-deck-arms', holds: arms.map((a) => a.id), fixed: false, build: drawArms, solid: () => ({ placement: new Matrix4(), pieces: [] }) })
  }
  return out
}

function crossoverLayouts(b: Baked, spec: ImplementSpec): MachineLayout[] {
  const out: MachineLayout[] = []
  for (const side of ['l', 'r'] as const) {
    const site = spec.sites[side]
    const pulley = V(site.pos)
    const cable = (b.cables ?? []).find((c) => V(c.pulley).distanceTo(pulley) < 0.02)
    if (!cable) continue
    const handle = b.implements.find((s) => s.id === cable.implement)!
    const facing = V(site.normal!).setY(0).normalize()
    const column = pulley.clone().addScaledVector(facing, -0.12).setY(0)
    const placement = new Matrix4().makeRotationY(Math.atan2(facing.x, facing.z)).setPosition(column)
    const inv = placement.clone().invert()
    const min = minDistance(b, handle.id, pulley)
    const spec0 = handle.kind === 'cable_handle' ? handle : cableHandle({ attachment: 'single_handle' })
    const make = (attachment: 'single_handle' | null) => (poses: Poses) => {
      const hp = poses.get(handle.id)!
      const local = poseMatrix4(hp).premultiply(inv)
      const pos = new Vector3(), rot = new Quaternion()
      local.decompose(pos, rot, new Vector3())
      const stackLift = Math.max(0, pulley.distanceTo(V(hp.pos)) - min)
      return { placement, pieces: buildCableStack({ pulley: pulley.y, attachment, attachmentSpec: spec0, handle: { pos, rot }, stackLift }).pieces }
    }
    out.push({ key: `crossover-${side}`, holds: [handle.id], fixed: false, build: make('single_handle'), solid: make(null) })
  }
  return out
}

export const layouts: LayoutSource = (b) => {
  const out: MachineLayout[] = []
  for (const spec of b.implements) {
    if (spec.kind === 'pec_deck') out.push(...pecDeckLayouts(b, spec))
    if (spec.kind === 'cable_crossover') out.push(...crossoverLayouts(b, spec))
  }
  return out
}
