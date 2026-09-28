import { cableCrossover } from '../implements/chest-shoulder-isolation.ts'
import { cableHandle, comWorld, type Cable, type ImplementSpec } from '../implements.ts'
import { norm, type V3 } from '../math.ts'
import { setDofs, type Contact, type ImplementPose, type Skeleton } from '../skeleton.ts'
import type { Tempo } from '../timing.ts'
import { footContacts, handleInHand, pressureZ, splitStance, standSplit, type Side, type SplitStance } from './isolation.ts'
import { ARM_BALANCE_TOL, limitSway, makeStance, stanceWidth, standBalanced, type StanceSetup, type Sway } from './standing.ts'
import type { Setup } from './types.ts'

// Standing between the two stacks of a cable crossover (F3): one D-handle per hand, each on the cable of its tower
// (or, crossed, of the opposite tower). The body leans against the pulls: the centre of pressure of body, handles
// and cable forces stays over the midfoot, held towards the rep's average like the approved standing arm templates.

export type CrossoverStance =
  | { kind: 'split'; front: Side; step: number; frontKnee: number; tilt: number }
  | { kind: 'hip'; knee: number; tilt: number }

export type CrossoverCtx = {
  tempo: Tempo
  setup: Setup
  stance: CrossoverStance
  split?: SplitStance
  hip?: StanceSetup
  trunk: Record<string, number>
  handles: Record<Side, ImplementSpec>
  cables: Record<Side, Cable>
  crossover: ImplementSpec
  sway?: Sway
}

export function crossoverContext(
  skel: Skeleton,
  o: {
    tempo: Tempo
    /** tower pulleys: `l` on the lifter's left (+X) */
    pulleys: { l: V3; r: V3 }
    /** each hand holds the opposite tower's cable */
    crossed: boolean
    kg: number
    stance: CrossoverStance
    trunk: Record<string, number>
    /** horizontal direction both towers face (their pulleys swivel towards the handles) */
    facing: V3
  },
): CrossoverCtx {
  const handles = { l: cableHandle({ id: 'handle_l', attachment: 'single_handle' }), r: cableHandle({ id: 'handle_r', attachment: 'single_handle' }) }
  const tower = (s: Side): Side => (o.crossed ? (s === 'l' ? 'r' : 'l') : s)
  const cables = {
    l: { pulley: o.pulleys[tower('l')], implement: 'handle_l', point: [0, 0, 0] as V3, kg: o.kg },
    r: { pulley: o.pulleys[tower('r')], implement: 'handle_r', point: [0, 0, 0] as V3, kg: o.kg },
  }
  const facing = norm([o.facing[0], 0, o.facing[2]])
  const crossover = cableCrossover({ pulleys: o.pulleys, facing: { l: facing, r: facing } })
  const st = o.stance
  const split = st.kind === 'split' ? splitStance(skel, st.front, st.step) : undefined
  const hip = st.kind === 'hip' ? makeStance(skel, stanceWidth(skel, 'hip'), 10) : undefined
  const contacts: Contact[] = [
    ...footContacts(skel, (split ?? hip)!.feet),
    { site: 'grip_l', kind: 'grip', target: { implement: 'handle_l', grip: 'c' } },
    { site: 'grip_r', kind: 'grip', target: { implement: 'handle_r', grip: 'c' } },
  ]
  const setup: Setup = {
    implements: [handles.l, handles.r, crossover],
    contacts,
    tempo: o.tempo,
    // a split stance is not mirror-symmetric (the arms still mirror exactly)
    symmetric: st.kind === 'hip',
    balance: { point: 'com', over: 'midfoot', tol: ARM_BALANCE_TOL },
    cables: [cables.l, cables.r],
  }
  return { tempo: o.tempo, setup, stance: st, split, hip, trunk: o.trunk, handles, cables, crossover }
}

export function handlePoses(skel: Skeleton, ctx: CrossoverCtx, q: Float64Array): ImplementPose[] {
  return (['l', 'r'] as const).map((s) => handleInHand(skel, q, s, ctx.cables[s].pulley, ctx.handles[s]))
}

function measure(skel: Skeleton, ctx: CrossoverCtx) {
  return (q: Float64Array) => {
    const hp = handlePoses(skel, ctx, q)
    const loads = (['l', 'r'] as const).map((s, k) => ({ mass: ctx.handles[s].mass, pos: comWorld(ctx.handles[s], hp[k]) }))
    return pressureZ(skel, q, loads, [{ cable: ctx.cables.l, pose: hp[0] }, { cable: ctx.cables.r, pose: hp[1] }])
  }
}

/** legs and trunk balanced against the cables, arms by `arms` */
export function crossoverBody(skel: Skeleton, ctx: CrossoverCtx, q: Float64Array, arms: (q: Float64Array) => void, sway?: Sway) {
  setDofs(skel, q, ctx.trunk)
  const m = measure(skel, ctx)
  const st = ctx.stance
  if (st.kind === 'split') {
    // a still pelvis (follow 0) needs no balancing solve
    if (sway?.follow !== 0) return standSplit(skel, q, ctx.split!, { frontKnee: st.frontKnee, tilt: st.tilt }, arms, m, sway)
    standSplit(skel, q, ctx.split!, { frontKnee: st.frontKnee, tilt: st.tilt }, arms, undefined, sway)
    return { x: sway.ref, offset: m(q) - ctx.split!.midfoot[2] }
  }
  return standBalanced(skel, q, ctx.hip!, { knee: st.knee, tilt: st.tilt }, m, arms, undefined, sway)
}

/** sway limit over the loop (call once the context is complete) */
export function crossoverSway(skel: Skeleton, ctx: CrossoverCtx, zero: () => Float64Array, armsAt: (u: number) => (q: Float64Array) => void) {
  return limitSway((u, sway) => crossoverBody(skel, ctx, zero(), armsAt(u), sway))
}

/**
 * Split stance with the hips still through the rep: the one pelvis position (forward coordinate) that keeps the
 * centre of pressure of body, handles and cable pulls closest to the midfoot line over the loop. A balancing solve
 * per frame is not monotonic here (the rear leg straightens and stops following), and lifters hold the stagger still.
 */
export function stillSplit(skel: Skeleton, ctx: CrossoverCtx, zero: () => Float64Array, armsAt: (u: number) => (q: Float64Array) => void, n = 16): Sway {
  const st = ctx.stance
  if (st.kind !== 'split') throw new Error('stillSplit: split stance only')
  const m = measure(skel, ctx)
  const mid = ctx.split!.midfoot[2]
  const worst = (z: number) => {
    let w = 0
    for (let i = 0; i < n; i++) {
      const q = zero()
      setDofs(skel, q, ctx.trunk)
      standSplit(skel, q, ctx.split!, { frontKnee: st.frontKnee, tilt: st.tilt }, armsAt(i / n), undefined, { ref: z, follow: 0 })
      w = Math.max(w, Math.abs(m(q) - mid))
    }
    return w
  }
  // golden-section search over a hand's width either side of the midfoot
  let a = mid - 0.15, b = mid + 0.15
  const g = (Math.sqrt(5) - 1) / 2
  let x1 = b - g * (b - a), x2 = a + g * (b - a)
  let f1 = worst(x1), f2 = worst(x2)
  while (b - a > 1e-4) {
    if (f1 < f2) {
      b = x2
      x2 = x1
      f2 = f1
      x1 = b - g * (b - a)
      f1 = worst(x1)
    } else {
      a = x1
      x1 = x2
      f1 = f2
      x2 = a + g * (b - a)
      f2 = worst(x2)
    }
  }
  return { ref: (a + b) / 2, follow: 0 }
}

