import type { Baked } from '../../../../motion/bake.ts'
import type { LayoutSource, MachineLayout } from '../layout.ts'
import { layouts as arms } from './arms.ts'
import { layouts as back } from './back.ts'
import { layouts as chestShoulderIsolation } from './chest-shoulder-isolation.ts'
import { layouts as core } from './core.ts'
import { layouts as hinge } from './hinge.ts'
import { layouts as legsHipCalf } from './legs-hip-calf.ts'
import { layouts as legsKnee } from './legs-knee.ts'
import { layouts as pressHorizontal } from './press-horizontal.ts'
import { layouts as pressVerticalBodyweight } from './press-vertical-bodyweight.ts'
import { layouts as shared } from './shared.ts'

// Prop extension modules: shared supports plus one module per family (docs/FAMILIES.md).
const SOURCES: LayoutSource[] = [shared, pressHorizontal, pressVerticalBodyweight, chestShoulderIsolation, back, legsKnee, legsHipCalf, hinge, arms, core]

export function familyLayouts(b: Baked): MachineLayout[] {
  return SOURCES.flatMap((s) => s(b))
}
