import type { Skeleton } from '../skeleton.ts'
import { DEFAULT_TEMPO } from '../timing.ts'
import { benchContext, sampleBench, unsupportedBench } from './press-bench.ts'
import { SCHEMAS, type ParamsOf } from './schemas.ts'
import { memo, type Template } from './types.ts'

// Incline press on the adjustable bench (barbell with uprights, dumbbells, Smith): the bench-press motion of
// press-bench.ts with the back pad at benchAngle (30-45 deg favours the clavicular pec: Rodriguez-Ridao 2020), the
// touch point up on the chest just below the clavicles and a flatter J (the lockout is over the shoulders).

type P = ParamsOf<'incline-press'>

const context = memo((p: P, skel: Skeleton) => {
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
  sample: (u, p, skel) => sampleBench(u, skel, context(p, skel)),
}
