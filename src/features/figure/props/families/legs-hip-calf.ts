import { Matrix4 } from 'three'
import type { Baked } from '../../../../motion/bake.ts'
import type { ImplementSpec } from '../../../../motion/implements.ts'
import { CALF_STANDING } from '../../../../motion/implements/legs-hip-calf.ts'
import { firstPose, fixedLayout, poseMatrix4, type MachineLayout, type LayoutSource, type Poses } from '../layout.ts'
import { buildSeatedCalf, buildStandingCalf } from './legs-hip-calf/calf.ts'
import { buildGrabHandle, buildHipMachine } from './legs-hip-calf/hip.ts'
import { calfLegPress } from './legs-hip-calf/leg-press.ts'
import { buildPlyoBox } from '../shared.ts'

// F6 legs-hip-calf: prop builders (Kit pieces in the props materials) with their sockets, and the layouts that draw them
// around a baked motion. Layout pieces are also the QA penetration gate's collision primitives (collision.ts).

type V3 = [number, number, number]
type Q = [number, number, number, number]

const spec = (b: Baked, id: string) => b.implements.find((s) => s.id === id)

/** lowest height an implement reaches over the loop */
function lowest(b: Baked, id: string) {
  const k = b.implements.findIndex((s) => s.id === id)
  let y = Infinity
  for (let i = 0; i < b.frames; i++) y = Math.min(y, b.ip[(i * b.implements.length + k) * 7 + 1])
  return y
}

type Pieces = ReturnType<typeof buildStandingCalf>['pieces']

function moving(key: string, holds: string[], build: (poses: Poses) => Matrix4 | null, pieces: (poses: Poses) => Pieces, collide: (p: Pieces[number]) => boolean = () => true): MachineLayout {
  const make = (poses: Poses) => ({ placement: build(poses) ?? new Matrix4(), pieces: pieces(poses) })
  return { key, holds, fixed: false, build: make, solid: (poses) => { const m = make(poses); return { ...m, pieces: m.pieces.filter(collide) } } }
}

/** the shoulder pads rest on the girdle within the template's rest tolerance, so only the yoke implement collides them */
const SHOULDER_PAD = `rbox:${CALF_STANDING.pad.size.join(':')}:`

export const layouts: LayoutSource = (b) => {
  const out: MachineLayout[] = []
  const bar = spec(b, 'calf'), yoke = spec(b, 'yoke')
  if (bar?.kind === 'calf_machine' && yoke) {
    const low = lowest(b, 'yoke')
    out.push(moving('calf-machine', ['yoke'], () => null, (poses) => {
      const at = poses.get('yoke')!.pos as V3
      return buildStandingCalf({ bar, yoke, at, lift: at[1] - low }).pieces
    }, (p) => !p.geo.startsWith(SHOULDER_PAD)))
  }
  const seat = spec(b, 'calf_seat'), seatBar = spec(b, 'calf_bar'), lever = spec(b, 'lever')
  if (seat && seatBar && lever?.kind === 'seated_calf') {
    out.push(moving('seated-calf', ['lever'], () => null, (poses) => {
      const pose = poses.get('lever')!
      return buildSeatedCalf({ seat, bar: seatBar, lever, pivot: pose.pos as V3, rot: pose.rot as Q }).pieces
    }))
  }
  const hipSeat = spec(b, 'hip_seat')
  const arms = (['l', 'r'] as const).map((side) => ({ side, spec: spec(b, `arm_${side}`) }))
  if (hipSeat?.kind === 'hip_machine' && arms.every((a) => a.spec)) {
    // the stack rests at the stretch: knees together on abduction, apart on adduction
    const turn = (rot: readonly number[]) => Math.abs(2 * Math.atan2(rot[1], rot[3]))
    const k = b.implements.findIndex((s) => s.id === 'arm_l')
    const angles = Array.from({ length: b.frames }, (_, i) => turn(Array.from(b.ip.subarray((i * b.implements.length + k) * 7 + 3, (i * b.implements.length + k) * 7 + 7))))
    const rest = b.params.direction === 'adduction' ? Math.max(...angles) : Math.min(...angles)
    out.push(moving('hip-machine', ['hip_seat'], () => null, (poses) => {
      const placed = arms.map((a) => {
        const pose = poses.get(`arm_${a.side}`)!
        return { spec: a.spec!, side: a.side, pos: pose.pos as V3, rot: pose.rot as Q }
      })
      return buildHipMachine({ seat: hipSeat, arms: placed, lift: 0.24 * Math.abs(turn(placed[0].rot) - rest) }).pieces
    }))
  }
  const press = calfLegPress(b)
  if (press) out.push(press)
  for (const st of b.implements.filter((s) => s.kind === 'calf_step')) {
    const top = st.parts[1] as Extract<ImplementSpec['parts'][number], { shape: 'box' }>
    const pieces = buildPlyoBox({ height: st.sites.top.pos[1], width: top.size[0], depth: top.size[2] }).pieces
    // collided as the template's implement, which carries the foot's resting tolerance (implements/legs-hip-calf.ts)
    out.push(fixedLayout(st.id, poseMatrix4(firstPose(b, st.id)!), pieces, { colliders: () => [] }))
  }
  for (const g of b.implements.filter((s) => s.kind === 'grab_handle')) out.push(fixedLayout(g.id, poseMatrix4(firstPose(b, g.id)!), buildGrabHandle(g).pieces, { holds: [g.id] }))
  return out
}
