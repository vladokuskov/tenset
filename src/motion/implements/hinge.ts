import type { ImplementSpec, Part } from '../implements.ts'
import { cross, qfromBasis, type V3 } from '../math.ts'

// F7 hinge: implement factories (ImplementSpec geometry) for this family's templates. New implement kinds go in
// KINDS, and kinds that move with the hands in MOVING (the equipment-equipment check tests those against everything).
// The drawn props (figure/props/families/hinge) read these dimensions, so what QA collides with is what is drawn.
export const KINDS = ['spot', 'back_extension', 'thrust_bench', 'bar_pad'] as const
export const MOVING: readonly string[] = []

/** a point on the floor without geometry: the support a single-leg stance balances over (site `c`, at the origin) */
export function floorSpot(o: { id?: string } = {}): ImplementSpec {
  return { id: o.id ?? 'spot', kind: 'spot', mass: 0, com: [0, 0, 0], parts: [], sites: { c: { pos: [0, 0, 0] as V3 } } }
}

/** partless markers where the palms rest (floor, chest): grip contacts, so the scene can give the hands a posed shape */
export function palmRests(o: { id?: string; l: V3; r: V3 }): ImplementSpec {
  return { id: o.id ?? 'palms', kind: 'spot', mass: 0, com: [0, 0, 0], parts: [], sites: { l: { pos: o.l }, r: { pos: o.r } } }
}

/** flat bench laid across the lifter for hip thrusts: pad top height, depth (along Z), length (along X), thickness */
export const THRUST_BENCH = { height: 0.43, width: 0.3, length: 1.16, thick: 0.065 }

/**
 * Flat bench across the lifter (long axis X). Local origin on the floor under the middle of the pad's front edge (the
 * edge the upper back rests on, towards +Z); the pad runs back towards -Z. Site `edge` along that edge.
 */
export function thrustBench(o: { id?: string; height?: number } = {}): ImplementSpec {
  const { width: w, length: l, thick: t } = THRUST_BENCH
  const h = o.height ?? THRUST_BENCH.height
  return {
    id: o.id ?? 'thrust_bench',
    kind: 'thrust_bench',
    mass: 0,
    com: [0, 0, 0],
    parts: [{ shape: 'box', center: [0, h - t / 2, -w / 2], size: [l, t, w], pad: true }],
    sites: { edge: { pos: [0, h, 0], axis: [1, 0, 0], normal: [0, 1, 0] } },
  }
}

/** foam sleeve round the middle of a bar resting on the hips */
export const BAR_PAD = { r: 0.045, half: 0.2 }

/** bar pad: local origin at the bar centre, sleeve along X (pose it with the bar) */
export function barPad(o: { id?: string } = {}): ImplementSpec {
  const { r, half } = BAR_PAD
  const part: Part = { shape: 'cylinder', a: [-half, 0, 0], b: [half, 0, 0], r, pad: true }
  return { id: o.id ?? 'bar_pad', kind: 'bar_pad', mass: 0, com: [0, 0, 0], parts: [part], sites: {} }
}

/**
 * 45-degree back extension bench (generic): hip pad in front of the upper thighs, ankle roller behind the lower shins,
 * foot plate under the soles, an inclined beam in front of the legs from the floor at the back up to the pad, a base
 * rail with stabilisers and a strut. `pad.below`: the pad's upper edge sits this far below the hip joints (along the
 * legs) so the pelvis folds over it; `roller.up`: the roller axle this far up the shins from the ankles.
 */
export const BACK_EXTENSION = {
  pad: { width: 0.34, length: 0.3, thick: 0.07, below: 0.16 },
  plate: { width: 0.4, length: 0.3, thick: 0.035, ahead: 0.06 },
  roller: { r: 0.05, half: 0.19, up: 0.14 },
  /** beam centre line in front of the legs' line, m */
  beam: 0.28,
  base: { y: 0.035, rear: 0.16, front: 0.14 },
}

/**
 * The bench round a lifter's legs, in world space (pose identity). `ankle`: midpoint of the ankle joints, `u`: along the
 * legs (ankles to hips), `n`: the legs' front. Offsets (m) of the contact faces from the leg line: `pad` (front of the
 * thighs), `roller` (behind the shins), `plate` (under the soles, along -u).
 */
export function backExtensionBench(o: { id?: string; ankle: V3; hip: V3; u: V3; n: V3; pad: number; roller: number; plate: number }): ImplementSpec {
  const { pad, plate, roller } = BACK_EXTENSION
  const at = (base: V3, du: number, dn: number): V3 => [base[0] + o.u[0] * du + o.n[0] * dn, base[1] + o.u[1] * du + o.n[1] * dn, base[2] + o.u[2] * du + o.n[2] * dn]
  // box frames: local Y along n (thickness), local Z along u
  const rot = boxRot(o.n, o.u)
  const padC = at(o.hip, -(pad.below + pad.length / 2), o.pad + pad.thick / 2)
  const plateC = at(o.ankle, -(o.plate + plate.thick / 2), plate.ahead)
  const rollerC = at(o.ankle, roller.up, -(o.roller + roller.r))
  return {
    id: o.id ?? 'back_extension',
    kind: 'back_extension',
    mass: 0,
    com: [0, 0, 0],
    parts: [
      { shape: 'box', center: padC, size: [pad.width, pad.thick, pad.length], rot, pad: true },
      { shape: 'box', center: plateC, size: [plate.width, plate.thick, plate.length], rot: boxRot(o.u, o.n), pad: true },
      { shape: 'cylinder', a: [-roller.half, rollerC[1], rollerC[2]], b: [roller.half, rollerC[1], rollerC[2]], r: roller.r, pad: true },
    ],
    sites: {
      pad: { pos: padC, normal: o.n.map((v) => -v) as V3, axis: o.u },
      plate: { pos: plateC, normal: o.u, axis: o.n },
      roller: { pos: rollerC, axis: [1, 0, 0] },
      beam: { pos: at(o.ankle, 0, BACK_EXTENSION.beam), axis: o.u },
    },
  }
}

/** rotation taking local Y to `y` and local Z to `z` (unit, orthogonal) */
const boxRot = (y: V3, z: V3) => qfromBasis(cross(y, z), y)
