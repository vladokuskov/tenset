import { Vector3 } from 'three'
import { FLOOR_MAT, PLYO_BOX, SKIRTING, TREAD, WALL } from '../../../motion/implements/shared.ts'
import { finish, Kit, type PropBuild } from './kit.ts'
import type { GripSocket, SurfaceSocket } from './sockets.ts'

// Supports several families share, drawn at the dimensions of their src/motion implements (implements/shared.ts).
// Frames: origin on the floor, X across, Y up; the box and mat are centred on the origin, the wall face is z = 0.

const UP = new Vector3(0, 1, 0)
const X = new Vector3(1, 0, 0)

export type PlyoBoxParams = { height?: number; width?: number; depth?: number }
export type PlyoBoxSockets = {
  top: SurfaceSocket
  /** top edges front (+Z) and rear, axis along the edge (the ball of the foot, the heels of the hands) */
  front: GripSocket
  back: GripSocket
}

/** Plyo box / step (20, 30 or 45 cm): light powder-coated body, black rubber tread, hand slots on taller boxes. */
export function buildPlyoBox(p: PlyoBoxParams = {}): PropBuild<PlyoBoxSockets> {
  const h = p.height ?? PLYO_BOX.heights[1], w = p.width ?? PLYO_BOX.width, d = p.depth ?? PLYO_BOX.depth
  const kit = new Kit()
  kit.box([0, (h - TREAD) / 2, 0], [w, h - TREAD, d], 'frame', undefined, 0.018)
  kit.box([0, h - TREAD / 2, 0], [w - 0.004, TREAD, d - 0.004], 'rubber', undefined, 0.004)
  if (h >= 0.3) for (const s of [-1, 1]) kit.box([s * (w / 2 - 0.0015), h - 0.09, 0], [0.004, 0.036, 0.13], 'hole', undefined, 0.0015)
  return finish(kit, {
    top: { position: new Vector3(0, h, 0), normal: UP.clone(), along: new Vector3(0, 0, 1), size: [d, w] },
    front: { position: new Vector3(0, h, d / 2), axis: X.clone() },
    back: { position: new Vector3(0, h, -d / 2), axis: X.clone() },
  })
}

export type FloorMatParams = { length?: number; width?: number }

/** Thin dark gray exercise mat, length along Z. */
export function buildFloorMat(p: FloorMatParams = {}): PropBuild<{ top: SurfaceSocket }> {
  const L = p.length ?? FLOOR_MAT.length, W = p.width ?? FLOOR_MAT.width, T = FLOOR_MAT.thick
  const kit = new Kit()
  kit.box([0, T / 2, 0], [W, T, L], 'mat', undefined, 0.004)
  return finish(kit, { top: { position: new Vector3(0, T, 0), normal: UP.clone(), along: new Vector3(0, 0, 1), size: [L, W] } })
}

export type WallParams = { width?: number; height?: number }

/** Wall section: a plain light panel with a skirting board, face in the plane z = 0 towards +Z. */
export function buildWall(p: WallParams = {}): PropBuild<{ face: SurfaceSocket }> {
  const W = p.width ?? WALL.width, H = p.height ?? WALL.height, D = WALL.thick
  const kit = new Kit()
  kit.box([0, H / 2, -D / 2], [W, H, D], 'frame', undefined, 0.01)
  kit.box([0, SKIRTING.height / 2, SKIRTING.depth / 2], [W, SKIRTING.height, SKIRTING.depth], 'frameDark', undefined, 0.003)
  return finish(kit, { face: { position: new Vector3(0, 1, 0), normal: new Vector3(0, 0, 1), along: UP.clone(), size: [H, W] } })
}
