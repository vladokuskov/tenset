import { Matrix4, Vector3 } from 'three'
import { around, bandAnchor, bandGrip, bandHandle, KETTLEBELL_KG, kettlebellDims, PLATE, poseHandle, type BandPoint } from '../../../motion/implements/index.ts'
import type { BandVertex } from '../../../motion/implements/bands.ts'
import { add, type V3 } from '../../../motion/math.ts'
import { buildBandAnchor, buildBandGrip, buildBandHandle, drawBandStrip } from './band'
import { buildKettlebell, buildTrapBar, buildWeightPlate } from './free-weights'
import { Kit, poseMatrix, type PropBuild } from './kit'
import type { GalleryScene } from './scenes'
import type { GripSocket } from './sockets'

// Props gallery scenes for the portable equipment: ?scene=props-portable (all four), props-bands, props-weights.

class Board {
  kit = new Kit()
  markers: GalleryScene['markers'] = []

  place<S>(b: PropBuild<S>, m: Matrix4) {
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

function kettlebells(B: Board, x0: number, z: number, kgs: readonly number[] = [12, 20, 32]) {
  kgs.forEach((kg, k) => {
    const b = buildKettlebell({ kg })
    B.grips(B.place(b, at(x0 + k * 0.34, kettlebellDims(kg).base, z, -0.35)), b.sockets.grips)
  })
}

function plates(B: Board, x0: number, z: number) {
  let x = x0
  for (const kg of [5, 10, 20] as const) {
    const b = buildWeightPlate({ kg })
    // standing on its rim, face turned towards the camera
    B.grips(B.place(b, at(x + PLATE[kg].r, PLATE[kg].r, z, -0.5)), b.sockets.grips)
    x += 2 * PLATE[kg].r + 0.06
  }
}

/** a band from an anchor ring to a handle held at `hand` (world) */
function bandToHandle(B: Board, hook: V3, hand: V3, axis: V3 = [1, 0, 0]) {
  const spec = bandHandle({ id: 'h' })
  const pose = poseHandle(spec, 'c', hand, axis, hook)
  const m = poseMatrix(pose.pos, pose.rot)
  B.grips(B.place(buildBandHandle(spec), m), { c: buildBandHandle(spec).sockets.grip })
  drawBandStrip(B.kit, [{ pos: hook }, { pos: pose.pos }])
}

function bands(B: Board, x: number, z: number) {
  // wall anchor at chest height, two handles pulled forward (a standing chest press)
  const wall = bandAnchor({ height: 1.25 })
  const mw = B.place(buildBandAnchor(wall), at(x, 0, z))
  const hook = new Vector3(...wall.sites.hook.pos).applyMatrix4(mw).toArray() as V3
  B.mark(mw, 'cable', new Vector3(...wall.sites.hook.pos))
  bandToHandle(B, hook, [x + 0.22, 1.18, z + 0.75])
  bandToHandle(B, hook, [x - 0.22, 1.18, z + 0.75])
  // post anchor low, one handle at the hip (an external rotation or a row)
  const post = bandAnchor({ height: 0.95, mount: 'post' })
  const mp = B.place(buildBandAnchor(post), at(x + 1.05, 0, z))
  const low = new Vector3(...post.sites.hook.pos).applyMatrix4(mp).toArray() as V3
  bandToHandle(B, low, [x + 1.05, 1.0, z + 0.6], [0, 0, 1])
  // bare band between two fists (pull-apart)
  const g = bandGrip({ id: 'g' })
  for (const s of [1, -1]) {
    const m = at(x + 0.52 + s * 0.24, 1.35, z + 0.35)
    B.grips(B.place(buildBandGrip(), m), { c: buildBandGrip().sockets.grip })
  }
  const end = (s: number, site: 'a' | 'b'): BandVertex => ({ pos: add([x + 0.52 + s * 0.24, 1.35, z + 0.35], g.sites[site].pos) })
  drawBandStrip(B.kit, [end(1, 'b'), end(-1, 'a')])
  // mini band loop standing on the floor, as round both knees
  const loop = (pts: BandPoint[], c: V3): BandVertex[] => pts.map((p) => ({ pos: add(c, p.at!), face: p.face }))
  const legs = [...around('n', { r: 0.06, from: -90, to: 90, center: [0.09, 0, 0] }), ...around('n', { r: 0.06, from: 90, to: 270, center: [-0.09, 0, 0] })]
  drawBandStrip(B.kit, loop(legs, [x + 0.5, 0.03, z + 0.9]), { closed: true, width: 0.05 })
}

function trapBar(B: Board, x: number, z: number) {
  const b = buildTrapBar({ plateKg: 40 })
  B.grips(B.place(b, at(x, b.sockets.floorHeight, z)), b.sockets.grips)
}

export const portableScenes: Record<string, () => GalleryScene> = {
  // bands (wall and post anchors, handles, bare band, mini loop), kettlebells, plates and the trap bar
  portable: () => {
    const B = new Board()
    bands(B, -1.6, -0.9)
    trapBar(B, 0.9, -0.3)
    kettlebells(B, -0.4, 0.95)
    plates(B, 0.6, 1.0)
    return { pieces: B.kit.pieces, markers: B.markers }
  },
  bands: () => {
    const B = new Board()
    bands(B, -0.5, -0.5)
    return { pieces: B.kit.pieces, markers: B.markers }
  },
  weights: () => {
    const B = new Board()
    kettlebells(B, -0.85, 0.6, KETTLEBELL_KG)
    plates(B, -0.7, -0.2)
    trapBar(B, 0.2, -1.1)
    return { pieces: B.kit.pieces, markers: B.markers }
  },
}
