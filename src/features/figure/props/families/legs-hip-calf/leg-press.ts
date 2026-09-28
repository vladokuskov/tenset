import { Matrix4, Vector3 } from 'three'
import type { Baked } from '../../../../../motion/bake.ts'
import type { Piece } from '../../kit.ts'
import type { MachineLayout, Poses } from '../../layout.ts'
import { buildLegPress, legPressDefaults } from '../../legpress.ts'

// The leg press for the calf raise, drawn as the squat's (props/legpress.ts). The footplate is left out of the
// collision pieces: the template's sled implement is the same plate and carries the resting tolerance for the feet,
// whose rigid forefoot capsules dip into it while the toes extend flat on it at the top of the raise.

/** the plate face pieces of buildLegPress: rubber face, backing plate and bottom lip */
const PLATE_GEOS = ['rbox:0.72:0.012:0.66:', 'rbox:0.76:0.026:0.72:', 'rbox:0.72:0.024:0.02:']

export const isPlatePiece = (p: Piece) => PLATE_GEOS.some((g) => p.geo.startsWith(g))

export function calfLegPress(b: Baked): MachineLayout | null {
  const frame = b.implements.find((s) => s.id === 'press_frame')
  if (!frame || !b.implements.some((s) => s.id === 'sled')) return null
  const hip = legPressDefaults.hip
  const a = (legPressDefaults.sledAngle * Math.PI) / 180
  const d = new Vector3(0, Math.sin(a), Math.cos(a))
  const hs = b.implements.find((s) => s.id === 'handles')?.sites
  const handles = hs && { l: { pos: hs.l.pos, axis: hs.l.axis! }, r: { pos: hs.r.pos, axis: hs.r.axis! } }
  const build = (poses: Poses) => {
    const p = poses.get('sled')!.pos
    const sled = new Vector3(p[0], p[1], p[2]).sub(new Vector3(...hip)).dot(d)
    return { placement: new Matrix4(), pieces: buildLegPress({ sledAngle: legPressDefaults.sledAngle, sled, hip, handles }).pieces }
  }
  const solid = (poses: Poses) => {
    const r = build(poses)
    return { ...r, pieces: r.pieces.filter((p) => !isPlatePiece(p)) }
  }
  return { key: 'leg-press', holds: ['handles'], fixed: false, build, solid }
}
