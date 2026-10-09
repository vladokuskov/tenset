import { Vector3 } from 'three'
import type { ImplementSpec } from '../../../motion/implements.ts'
import { BAND, BAND_ANCHOR, BAND_GRIP, BAND_HANDLE, bandAnchor, bandHandle, type AnchorSpec } from '../../../motion/implements/index.ts'
import { bandWidthAxis, type BandVertex } from '../../../motion/implements/bands.ts'
import type { V3 } from '../../../motion/math.ts'
import { finish, Kit, type PropBuild } from './kit.ts'
import type { MatKey } from './materials.ts'
import { buildWall } from './shared.ts'
import type { GripSocket, SurfaceSocket } from './sockets.ts'

// Resistance bands drawn from their src/motion descriptors (implements/bands.ts): the strip through the band path,
// the soft handles, the bare band bunched in a fist and the wall or post anchor.

/** the band's rubber (no collider kind: the strip never collides) */
export const BAND_MAT: MatKey = 'band'

const v = (p: V3) => new Vector3(p[0], p[1], p[2])

/**
 * A flat strip through world points: one rounded flat tube per run, its width across `bandWidthAxis`, each run
 * overlapping its neighbours by the strip thickness so bends stay closed.
 */
export function drawBandStrip(kit: Kit, verts: BandVertex[], o: { closed?: boolean; width?: number; thick?: number } = {}) {
  const w = o.width ?? BAND.width.medium, t = o.thick ?? BAND.thick
  const n = verts.length
  const runs = o.closed ? n : n - 1
  for (let k = 0; k < runs; k++) {
    const a = verts[k], b = verts[(k + 1) % n]
    const A = v(a.pos), B = v(b.pos)
    const len = A.distanceTo(B)
    if (len < 1e-5) continue
    const face = a.face && b.face ? v(a.face).add(v(b.face)).normalize().toArray() : (a.face ?? b.face)
    const side = v(bandWidthAxis(a.pos, b.pos, face))
    const d = B.clone().sub(A).divideScalar(len)
    kit.tube(A.clone().addScaledVector(d, -t), B.clone().addScaledVector(d, t), w, t, BAND_MAT, { side, r: t * 0.45 })
  }
  return kit
}

export type BandHandleSockets = { grip: GripSocket; ring: Vector3 }

/** Soft band handle: black foam grip with end caps on a webbing loop up to a steel ring at the origin. */
export function buildBandHandle(spec: ImplementSpec = bandHandle({ id: 'handle' })): PropBuild<BandHandleSockets> {
  const { drop, half, r, ring } = BAND_HANDLE
  const kit = new Kit()
  kit.rod([-half, -drop, 0], [half, -drop, 0], r, 'pad', 24)
  for (const s of [-1, 1]) {
    kit.rod([s * half, -drop, 0], [s * (half + 0.006), -drop, 0], r * 0.9, 'rubber', 24)
    // webbing from the grip's ends up to the ring
    kit.tube([s * (half + 0.003), -drop, 0], [s * 0.004, -ring * 0.8, 0], 0.02, 0.0025, 'rope', { side: [0, 0, 1], r: 0.001 })
  }
  kit.torus([0, 0, 0], ring, 0.0028, [0, 0, 1], 'steel')
  const c = spec.sites.c
  return finish(kit, { grip: { position: v(c.pos), axis: v(c.axis ?? [1, 0, 0]) }, ring: new Vector3() })
}

/** A bare band bunched in the fist: a short thick roll of band rubber along X. */
export function buildBandGrip(width: number = BAND.width.medium): PropBuild<{ grip: GripSocket }> {
  const { half, r } = BAND_GRIP
  const kit = new Kit()
  kit.tube([-half, 0, 0], [half, 0, 0], Math.max(2 * r, width), 1.6 * r, BAND_MAT, { side: [0, 1, 0], r: 0.7 * r })
  return finish(kit, { grip: { position: new Vector3(), axis: new Vector3(1, 0, 0) } })
}

export type BandAnchorSockets = { hook: Vector3; face: SurfaceSocket }

/** Band anchor: a webbing strap and a steel ring on a wall section, or on a light upright post with a floor plate. */
export function buildBandAnchor(spec: AnchorSpec = bandAnchor({ height: 1.2 })): PropBuild<BandAnchorSockets> {
  const kit = new Kit()
  const hook = v(spec.sites.hook.pos)
  const h = hook.y, reach = BAND_ANCHOR.reach
  if (spec.mount === 'wall') kit.merge(buildWall())
  else {
    const { width: w, height: H, base, plate } = BAND_ANCHOR.post
    kit.tube([0, plate, -w / 2], [0, H, -w / 2], w, w, 'frame', { cap: 'b' })
    kit.box([0, plate / 2, -w / 2], [base, plate, base], 'frameDark', undefined, 0.004)
    for (const x of [-1, 1]) for (const z of [-1, 1]) kit.bolt([x * base * 0.38, plate, -w / 2 + z * base * 0.38], [0, 1, 0], 0.01)
    for (let y = 0.3; y < H - 0.1; y += 0.1) if (Math.abs(y - h) > 0.06) kit.hole([0, y, 0.0005], [0, 0, 1], 0.008)
  }
  // mount plate, strap out to the ring
  kit.box([0, h, 0.004], [0.05, 0.07, 0.008], 'frameDark', undefined, 0.003)
  kit.tube([0, h, 0.006], [0, h, reach - 0.012], 0.024, 0.004, 'rope', { side: [0, 1, 0], r: 0.0015 })
  kit.torus([0, h, reach], 0.014, 0.003, [1, 0, 0], 'steel')
  return finish(kit, { hook, face: { position: v(spec.sites.face.pos), normal: new Vector3(0, 0, 1) } })
}
