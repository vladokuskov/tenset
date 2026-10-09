import { cableHandle, type ImplementSpec, type Part } from '../implements.ts'
import { add, scale, type Quat, type V3 } from '../math.ts'

// F9 core: implement factories (ImplementSpec geometry) for this family's templates. New implement kinds go in
// KINDS, and kinds that move with the hands in MOVING (the equipment-equipment check tests those against everything).
export const KINDS = ['palm_rest', 'decline_board'] as const
export const MOVING: readonly string[] = []

/**
 * partless markers where a hand rests (flat on the mat, on the hip): grip contacts, so the scene can give the hand a
 * posed shape. Sites in the implement frame; pose it at the origin for fixed rests or with the body for moving ones.
 */
export function palmRest(o: { id?: string; sites: Record<string, V3> }): ImplementSpec {
  return { id: o.id ?? 'palms', kind: 'palm_rest', mass: 0, com: [0, 0, 0], parts: [], sites: Object.fromEntries(Object.entries(o.sites).map(([k, pos]) => [k, { pos }])) }
}

const cyl = (a: V3, b: V3, r: number): Part => ({ shape: 'cylinder', a, b, r })

/** cable rope with its grips `half` m either side of the midline, `drop` m below the carabiner (local -Y) */
export function coreRope(o: { id?: string; half: number; drop: number }): ImplementSpec {
  const base = cableHandle({ id: o.id ?? 'handle', attachment: 'rope' })
  const k = 1 / 0.85
  const end = (s: number): V3 => [s * o.half * k, -o.drop * k, 0]
  const axis = (s: number): V3 => {
    const l = Math.hypot(o.half, o.drop)
    return [(s * o.half) / l, -o.drop / l, 0]
  }
  return {
    ...base,
    parts: [cyl([0, 0, 0], end(1), 0.012), cyl([0, 0, 0], end(-1), 0.012)],
    sites: { l: { pos: [o.half, -o.drop, 0], axis: axis(1) }, r: { pos: [-o.half, -o.drop, 0], axis: axis(-1) } },
  }
}

/** D-handle with a grip bar long enough for two hands side by side (sites l and r, `gap` m apart along local X) */
export function twoHandHandle(o: { id?: string; gap: number }): ImplementSpec {
  const base = cableHandle({ id: o.id ?? 'handle', attachment: 'single_handle' })
  const half = o.gap / 2 + 0.065
  const y = -0.11
  return {
    ...base,
    parts: [cyl([0, 0, 0], [half - 0.01, y + 0.01, 0], 0.006), cyl([0, 0, 0], [-half + 0.01, y + 0.01, 0], 0.006), cyl([-half, y, 0], [half, y, 0], 0.016)],
    sites: { l: { pos: [o.gap / 2, y, 0], axis: [1, 0, 0] }, r: { pos: [-o.gap / 2, y, 0], axis: [1, 0, 0] } },
  }
}

/**
 * Decline sit-up board: one long pad rising at `angle` (deg) from the head end to the feet, foam rollers across the
 * front of the ankles at the high end, on two posts and floor rails. Local frame: origin on the floor under the pad's
 * head end, +Z up the slope towards the feet. Sites: `top` (the pad top at `along` m up the slope, normal off the pad,
 * axis up the slope), `roller` (the rollers' axis centre, axis X).
 */
export const DECLINE_BOARD = { length: 1.75, width: 0.32, thick: 0.06, low: 0.36, roller: { r: 0.05, half: 0.17 }, post: 0.025 }

export function declineBoardFrame(angle: number) {
  const a = (Math.abs(angle) * Math.PI) / 180
  const dir: V3 = [0, Math.sin(a), Math.cos(a)]
  const normal: V3 = [0, Math.cos(a), -Math.sin(a)]
  /** rotation about X taking +Z up the slope and +Y to the pad normal */
  const rot: Quat = [-Math.sin(a / 2), 0, 0, Math.cos(a / 2)]
  /** pad top at `s` m up the slope */
  const top = (s: number): V3 => add([0, DECLINE_BOARD.low, 0], scale(dir, s))
  return { a, dir, normal, rot, top }
}

/** `roller`: the rollers' axis `along` m up the slope and `lift` m off the pad top (over the front of the ankles) */
export function declineBoard(o: { id?: string; angle: number; roller: { along: number; lift: number } }): ImplementSpec {
  const { length: L, width: W, thick: T, roller: R, post } = DECLINE_BOARD
  const { dir, normal, rot, top } = declineBoardFrame(o.angle)
  const center = add(top(L / 2), scale(normal, -T / 2))
  const rollerAt = add(top(o.roller.along), scale(normal, o.roller.lift))
  const low = add(top(0.18), scale(normal, -T)), high = add(top(L - 0.25), scale(normal, -T))
  const parts: Part[] = [
    { shape: 'box', center, size: [W, T, L], rot, pad: true },
    { shape: 'cylinder', a: add(rollerAt, [-R.half, 0, 0]), b: add(rollerAt, [R.half, 0, 0]), r: R.r, pad: true },
    cyl([0, 0, low[2]], low, post),
    cyl([0, 0, high[2]], high, post),
    cyl([0, post, low[2] - 0.05], [0, post, high[2] + 0.05], post),
  ]
  return {
    id: o.id ?? 'board',
    kind: 'decline_board',
    mass: 0,
    com: [0, 0, 0],
    parts,
    sites: { top: { pos: top(0.75), normal, axis: dir }, roller: { pos: rollerAt, axis: [1, 0, 0] } },
  }
}
