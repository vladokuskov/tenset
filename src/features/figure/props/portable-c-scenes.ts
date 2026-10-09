import { Matrix4, Vector3 } from 'three'
import type { ImplementSpec } from '../../../motion/implements.ts'
import { abWheel, abWheelPose, abWheelSpin, gymRing, landmine, landmineBar, landminePitchFor, landminePose, ringAnchor, ringPose, LANDMINE, RING_HEIGHT } from '../../../motion/implements/index.ts'
import { add, qrot, type V3 } from '../../../motion/math.ts'
import type { ImplementPose } from '../../../motion/skeleton.ts'
import { Kit, poseMatrix, type PropBuild } from './kit'
import { buildAbWheel, buildLandmine, buildLandmineBar, buildRing, buildRingAnchor, drawRingStrap, spinPieces } from './portable-c'
import type { GalleryScene } from './scenes'
import type { GripSocket } from './sockets'

// Props gallery scenes for the tier C portable equipment: ?scene=props-portable-c (all), props-rings,
// props-landmine, props-abwheel.

class Board {
  kit = new Kit()
  markers: GalleryScene['markers'] = []

  place<S>(b: { pieces: PropBuild<S>['pieces'] }, m: Matrix4) {
    this.kit.merge(b, m)
    return m
  }

  grips(m: Matrix4, g: Record<string, GripSocket>) {
    for (const s of Object.values(g)) this.markers.push({ pos: s.position.clone().applyMatrix4(m), kind: 'grip' })
  }

  mark(m: Matrix4, kind: GalleryScene['markers'][number]['kind'], ...pts: Vector3[]) {
    for (const p of pts) this.markers.push({ pos: p.clone().applyMatrix4(m), kind })
  }
}

const at = (x: number, y: number, z: number, rotY = 0) => new Matrix4().makeRotationY(rotY).setPosition(x, y, z)
const world = (spec: ImplementSpec, pose: ImplementPose, site: string): V3 => add(pose.pos, qrot(pose.rot, spec.sites[site].pos))

/** a rig with both rings held at `height`, the hands `ahead` m in front of the beam (straps leaning towards them) */
function rig(B: Board, x: number, z: number, height: number, ahead = 0, axis: V3 = [0, 0, 1]) {
  const anchor = ringAnchor()
  const m = B.place(buildRingAnchor(anchor), at(x, 0, z))
  for (const s of ['l', 'r'] as const) {
    const top = new Vector3(...anchor.sites[`strap_${s}`].pos).applyMatrix4(m).toArray() as V3
    const ring = gymRing({ id: `ring_${s}` })
    const pose = ringPose(ring, [top[0], height, top[2] + ahead], axis, top)
    const rm = poseMatrix(pose.pos, pose.rot)
    const b = buildRing(ring)
    B.place(b, rm)
    B.grips(rm, { grip: b.sockets.grip })
    drawRingStrap(B.kit, [top, world(ring, pose, 'strap')], qrot(pose.rot, [1, 0, 0]))
  }
}

function rings(B: Board, x: number, z: number) {
  rig(B, x - 1.9, z, RING_HEIGHT.pull_up, 0, [1, 0, 0])
  rig(B, x, z, RING_HEIGHT.dip)
  // a row: the hands pull the rings forward of the beam, the straps lean
  rig(B, x + 1.9, z, RING_HEIGHT.row, 0.55, [1, 0, 0])
}

/** the pitch at which the loaded bar's plates rest on the floor */
function floorPitch(spec: ImplementSpec) {
  const plate = spec.parts.filter((p) => p.shape === 'cylinder' && p.r >= 0.06).at(-1)!
  const xc = plate.shape === 'cylinder' ? plate.b[0] : 0, r = plate.shape === 'cylinder' ? plate.r : 0
  let lo = -10, hi = 30
  for (let k = 0; k < 40; k++) {
    const p = (lo + hi) / 2, a = (p * Math.PI) / 180
    if (LANDMINE.pivot + xc * Math.sin(a) - r * Math.cos(a) > 0) hi = p
    else lo = p
  }
  return (lo + hi) / 2
}

function landmines(B: Board, x: number, z: number) {
  const base = landmine()
  const pivot = (bx: number, bz: number): V3 => [bx, LANDMINE.pivot, bz]
  // resting on its plates
  const rest = landmineBar({ plateKg: 20 })
  B.place(buildLandmine(base), at(x - 0.7, 0, z - 1.0))
  const p0 = landminePose('bar', pivot(x - 0.7, z - 1.0), 0, floorPitch(rest))
  const m0 = B.place(buildLandmineBar({ spec: rest }), poseMatrix(p0.pos, p0.rot))
  B.grips(m0, buildLandmineBar({ spec: rest }).sockets.grips)
  // a T-bar row with the V-handle, the grips at knee height
  const row = landmineBar({ plateKg: 40, handle: 'v' })
  // turned across the view so the handle under the shaft shows
  B.place(buildLandmine(base), at(x - 0.4, 0, z - 1.9))
  const p1 = landminePose('bar', pivot(x - 0.4, z - 1.9), 75, landminePitchFor(row, 'v_l', pivot(x - 0.4, z - 1.9), 75, 0.5)!)
  const m1 = B.place(buildLandmineBar({ spec: row }), poseMatrix(p1.pos, p1.rot))
  B.grips(m1, buildLandmineBar({ spec: row }).sockets.grips)
  // a press: the pivot ahead, the tip at shoulder height towards the lifter
  const press = landmineBar({ plateKg: 10 })
  B.place(buildLandmine(base), at(x + 1.4, 0, z + 1.0))
  const p2 = landminePose('bar', pivot(x + 1.4, z + 1.0), 180, landminePitchFor(press, 'tip', pivot(x + 1.4, z + 1.0), 180, 1.35)!)
  const m2 = B.place(buildLandmineBar({ spec: press }), poseMatrix(p2.pos, p2.rot))
  B.grips(m2, buildLandmineBar({ spec: press }).sockets.grips)
}

function wheels(B: Board, x: number, z: number) {
  const spec = abWheel()
  const b = buildAbWheel(spec)
  ;[[0, 0], [0.45, 30], [0.9, -25]].forEach(([dx, heading], k) => {
    const pose = abWheelPose('wheel', x + dx, z + 0.2 * k, heading)
    const m = poseMatrix(pose.pos, pose.rot)
    B.place({ pieces: [...spinPieces(b.wheel, abWheelSpin(pose) + k), ...b.fixed] }, m)
    B.grips(m, b.sockets.grips)
    B.mark(m, 'surface', b.sockets.floor.position)
  })
}

export const portableCScenes: Record<string, () => GalleryScene> = {
  // rings at pull-up, dip and row heights on three rigs, landmines (resting, V-handle row, press), ab wheels
  'portable-c': () => {
    const B = new Board()
    rings(B, 0, -1.4)
    landmines(B, -0.6, 1.4)
    wheels(B, 1.4, 1.2)
    return { pieces: B.kit.pieces, markers: B.markers }
  },
  rings: () => {
    const B = new Board()
    rings(B, 0, 0)
    return { pieces: B.kit.pieces, markers: B.markers, figure: { at: [0, 0, 0.35] } }
  },
  landmine: () => {
    const B = new Board()
    landmines(B, 0, 0)
    return { pieces: B.kit.pieces, markers: B.markers }
  },
  abwheel: () => {
    const B = new Board()
    wheels(B, -0.45, -0.2)
    return { pieces: B.kit.pieces, markers: B.markers }
  },
}
