import { Matrix4, Vector3 } from 'three'
import {
  beltLever,
  beltSquat,
  captainsChair,
  declineBench,
  ghd,
  hackSled,
  hackSquat,
  hipBelt,
  hyperLever,
  inclinePressLever,
  leverPose,
  pendulumArm,
  pendulumSquat,
  preacherBench,
  reverseHyper,
  sealBench,
  sledPose,
  tbarLever,
  tbarStation,
  BELT_SQUAT,
  REVERSE_HYPER,
  TBAR,
} from '../../../motion/implements/stations.ts'
import type { V3 } from '../../../motion/math.ts'
import { buildChestPress } from './families/press-horizontal/chest-press.ts'
import { buildUprights } from './families/press-horizontal/uprights.ts'
import { Kit, poseMatrix, type PropBuild } from './kit.ts'
import type { GalleryScene } from './scenes.ts'
import {
  buildBeltLever,
  buildBeltSquat,
  buildCaptainsChair,
  buildDeclineBench,
  buildGhd,
  buildHackFrame,
  buildHackSled,
  buildHyperLever,
  buildPendulumArm,
  buildPendulumFrame,
  buildPreacher,
  buildReverseHyper,
  buildSealBench,
  buildTbarLever,
  buildTbarStation,
  drawChain,
  drawHipBelt,
  type StationSockets,
} from './stations.ts'

// Props gallery scenes for the fixed machine stations: ?scene=props-stations (all) and props-<station> close up, each
// with a standing figure beside it for scale. Moving parts are shown at a mid pose.

class Board {
  kit = new Kit()
  markers: GalleryScene['markers'] = []

  place(b: PropBuild<StationSockets>, m: Matrix4) {
    this.kit.merge(b, m)
    const at = (v: Vector3) => v.clone().applyMatrix4(m)
    for (const s of Object.values(b.sockets.grips)) this.markers.push({ pos: at(s.position), kind: 'grip' })
    for (const s of Object.values(b.sockets.surfaces)) this.markers.push({ pos: at(s.position), kind: 'surface' })
    for (const s of Object.values(b.sockets.axes)) this.markers.push({ pos: at(s.position), kind: 'cable' })
    return m
  }

  scene(figure?: GalleryScene['figure']): GalleryScene {
    return { pieces: this.kit.pieces, markers: this.markers, ...(figure ? { figure } : {}) }
  }
}

const at = (x: number, z: number, rotY = 0) => new Matrix4().makeRotationY(rotY).setPosition(x, 0, z)
const pose = (frame: Matrix4, p: { pos: readonly number[]; rot: readonly number[] }) => frame.clone().multiply(poseMatrix(p.pos as V3, p.rot as [number, number, number, number]))

type Station = (B: Board, m: Matrix4) => void

const STATIONS: Record<string, Station> = {
  ghd: (B, m) => {
    B.place(buildGhd(ghd()), m)
  },
  hack: (B, m) => {
    const frame = hackSquat()
    B.place(buildHackFrame(frame), m)
    const sled = hackSled()
    B.place(buildHackSled(sled), pose(m, sledPose(sled.id, frame, 0.4)))
  },
  pendulum: (B, m) => {
    const frame = pendulumSquat()
    B.place(buildPendulumFrame(frame), m)
    const arm = pendulumArm()
    B.place(buildPendulumArm(arm), pose(m, leverPose(arm.id, frame.sites.pivot.pos, 0)))
  },
  'belt-squat': (B, m) => {
    const frame = beltSquat()
    B.place(buildBeltSquat(frame), m)
    const lever = beltLever()
    const lp = pose(m, leverPose(lever.id, BELT_SQUAT.pivot, BELT_SQUAT.lift / 2))
    B.place(buildBeltLever(lever), lp)
    // the hip belt where a lifter's pelvis would be, the chain down to the hook
    const belt = hipBelt()
    const bm = m.clone().multiply(new Matrix4().makeTranslation(0, 0.9, -0.02))
    drawHipBelt(B.kit, belt, bm)
    const hook = new Vector3(...lever.sites.hook.pos).add(new Vector3(0, 0.055, 0)).applyMatrix4(lp)
    drawChain(B.kit, new Vector3(...belt.sites.front.pos).add(new Vector3(0, -0.022, 0)).applyMatrix4(bm), hook)
  },
  preacher: (B, m) => {
    B.place(buildPreacher(preacherBench()), m)
  },
  tbar: (B, m) => {
    const frame = tbarStation()
    B.place(buildTbarStation(frame), m)
    const lever = tbarLever()
    B.place(buildTbarLever(lever), pose(m, leverPose(lever.id, TBAR.pivot, 0)))
  },
  'captains-chair': (B, m) => {
    B.place(buildCaptainsChair(captainsChair()), m)
  },
  'decline-bench': (B, m) => {
    const bench = declineBench()
    B.place(buildDeclineBench(bench), m)
    // F1 bench-press uprights at the head end, for the barbell decline press
    B.kit.merge(buildUprights({ hookHeight: 1.0 }), m.clone().multiply(new Matrix4().makeTranslation(0, 0, -0.98)))
  },
  'seal-bench': (B, m) => {
    B.place(buildSealBench(sealBench()), m)
  },
  'reverse-hyper': (B, m) => {
    const frame = reverseHyper()
    B.place(buildReverseHyper(frame), m)
    const lever = hyperLever()
    B.place(buildHyperLever(lever), pose(m, leverPose(lever.id, REVERSE_HYPER.pivot, 20)))
  },
  'incline-press': (B, m) => {
    // the seated chest press with its lever pivot moved forward and down so the handles press up the incline
    const seatHeight = 0.46
    const mid: V3 = [0, 1.12, 0.42]
    const { pivot, swing } = inclinePressLever({ mid, incline: 35, reach: 0.95, stroke: 0.36 })
    const b = buildChestPress({ seatHeight, recline: 28, backBottom: [0, seatHeight + 0.03, 0], pivot, reach: 0.95, gripHalf: 0.25, swing: swing[0] })
    B.kit.merge(b, m)
    for (const g of Object.values(b.sockets.grips)) B.markers.push({ pos: g.position.clone().applyMatrix4(m), kind: 'grip' })
  },
}

/** the overview: all stations in three rows, turned so the elevated three-quarter camera sees into them */
function overview(): GalleryScene {
  const B = new Board()
  const rows: [string, number, number, number][] = [
    ['hack', -3.4, -2.6, 0.5],
    ['pendulum', -1.6, -2.6, 0.5],
    ['captains-chair', 0.2, -2.8, 0.5],
    ['tbar', 1.9, -2.6, 0.5],
    ['belt-squat', 3.6, -2.4, 0.5],
    ['ghd', -3.4, 0.2, 0.5],
    ['reverse-hyper', -1.6, 0.2, 0.5],
    ['preacher', 0.2, 0.2, 0.5],
    ['decline-bench', 1.9, 0.2, 0.5],
    ['seal-bench', 3.6, 0.2, 0.5],
  ]
  for (const [k, x, z, r] of rows) STATIONS[k](B, at(x, z, r))
  return B.scene({ at: [0.2, 0, 1.9] })
}

function single(k: string): GalleryScene {
  const B = new Board()
  STATIONS[k](B, at(0, 0, 0.5))
  return B.scene({ at: [1.15, 0, 0.6] })
}

export const stationNames = Object.keys(STATIONS)

export const stationScenes: Record<string, () => GalleryScene> = {
  stations: overview,
  ...Object.fromEntries(stationNames.map((k) => [k, () => single(k)])),
}
