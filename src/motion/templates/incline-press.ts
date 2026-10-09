import type { Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO } from '../timing.ts'
import { benchContext, sampleBench, unsupportedBench, type BenchCtx } from './press-bench.ts'
import { machineContext, sampleMachine, unsupportedMachine, type MachineCtx } from './press-machine.ts'
import { landmineContext, sampleLandmine, type LandmineCtx } from './press-landmine.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { memo, type Template } from './types.ts'

// Incline press on the adjustable bench (barbell with uprights, dumbbells, Smith): the bench-press motion of
// press-bench.ts with the back pad at benchAngle (30-45 deg favours the clavicular pec: Rodriguez-Ridao 2020), the
// touch point up on the chest just below the clavicles and a flatter J (the lockout is over the shoulders).
// Machine (122): the seated chest press with the back reclined and the lever pivot forward and down, the handles
// pressing up and forward at `benchAngle` above horizontal (press-machine.ts). Landmine (136): standing staggered, both
// hands cupped round the tip of a landmine bar at the upper chest, pressed up and forward along its arc
// (press-landmine.ts).

type P = ParamsOf<'incline-press'>

const context = memo((p: P, skel: Skeleton): BenchCtx | MachineCtx | (LandmineCtx & { kind: 'landmine' }) => {
  if (p.implement === 'landmine') {
    if (p.posture !== 'standing' || p.laterality !== 'bilateral') throw new Error(`incline-press: variant not implemented yet (landmine ${p.posture} ${p.laterality})`)
    return { kind: 'landmine', ...landmineContext({ hands: 'two', base: 'split', side: p.side }, skel, p.tempo ?? DEFAULT_TEMPO) }
  }
  if (p.implement === 'machine') {
    const why = unsupportedMachine(p)
    if (why) throw new Error(`incline-press: variant not implemented yet (${why})`)
    return machineContext(p, skel, p.tempo ?? DEFAULT_TEMPO, { incline: p.benchAngle })
  }
  const why = unsupportedBench(p)
  if (why) throw new Error(`incline-press: variant not implemented yet (${why})`)
  return benchContext(p, skel, p.tempo ?? DEFAULT_TEMPO)
})

export const inclinePress: Template<P> = {
  id: 'incline-press',
  driver: 'implement',
  params: SCHEMAS['incline-press'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample: (u, p, skel) => {
    const ctx = context(p, skel)
    if (ctx.kind === 'landmine') return sampleLandmine(u, skel, ctx)
    return ctx.kind === 'machine' ? sampleMachine(u, skel, ctx) : sampleBench(u, skel, ctx)
  },
}
