import type { Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO } from '../timing.ts'
import { benchContext, sampleBench, unsupportedBench, type BenchCtx } from './press-bench.ts'
import { sampleStanding, standingContext, unsupportedStanding, type StandingPressCtx } from './press-cable.ts'
import { machineContext, sampleMachine, unsupportedMachine, type MachineCtx } from './press-machine.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { memo, type Template } from './types.ts'

// Horizontal press: flat bench press (barbell with uprights, dumbbells) lying on the bench (press-bench.ts), and the
// seated chest press machine (press-machine.ts). Grip width and elbow flare come from the record: a close grip
// (707) tucks the elbows, the standard grip sits ~50-55 deg out (Larsen 2021; Green & Comfort 2007). Wave 3b: the
// floor press and the squeeze press (press-bench.ts), and the standing cable and band presses (press-cable.ts).

type P = ParamsOf<'horizontal-press'>

const context = memo((p: P, skel: Skeleton): BenchCtx | MachineCtx | StandingPressCtx => {
  const tempo = p.tempo ?? DEFAULT_TEMPO
  if (p.posture === 'standing') {
    const why = unsupportedStanding(p)
    if (why) throw new Error(`horizontal-press: variant not implemented yet (${why})`)
    return standingContext(p, skel, tempo)
  }
  if (p.implement === 'machine') {
    const why = unsupportedMachine(p)
    if (why) throw new Error(`horizontal-press: variant not implemented yet (${why})`)
    return machineContext(p, skel, tempo)
  }
  const why = unsupportedBench(p)
  if (why) throw new Error(`horizontal-press: variant not implemented yet (${why})`)
  return benchContext(p, skel, tempo)
})

export const horizontalPress: Template<P> = {
  id: 'horizontal-press',
  driver: 'implement',
  params: SCHEMAS['horizontal-press'],
  implemented: true,
  setup: (p, skel) => context(p, skel).setup,
  sample: (u, p, skel) => {
    const ctx = context(p, skel)
    if (ctx.kind === 'standing') return sampleStanding(u, skel, ctx)
    return ctx.kind === 'machine' ? sampleMachine(u, skel, ctx) : sampleBench(u, skel, ctx)
  },
}
