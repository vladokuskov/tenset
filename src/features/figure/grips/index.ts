import { GRIPS as arms } from './arms.ts'
import { GRIPS as back } from './back.ts'
import { GRIPS as chestShoulderIsolation } from './chest-shoulder-isolation.ts'
import { GRIPS as core } from './core.ts'
import { GRIPS as hinge } from './hinge.ts'
import { GRIPS as legsHipCalf } from './legs-hip-calf.ts'
import { GRIPS as legsKnee } from './legs-knee.ts'
import { GRIPS as pressHorizontal } from './press-horizontal.ts'
import { GRIPS as pressVerticalBodyweight } from './press-vertical-bodyweight.ts'
import type { GripDef } from './types.ts'

export type { GripDef, PosedDef, ThumbRest, WrapDef } from './types.ts'

// Family hand shapes (docs/FAMILIES.md), merged into the hands.ts grip library.
const PARTS: Record<string, Record<string, GripDef>> = { pressHorizontal, pressVerticalBodyweight, chestShoulderIsolation, back, legsKnee, legsHipCalf, hinge, arms, core }

export const FAMILY_GRIPS = { ...pressHorizontal, ...pressVerticalBodyweight, ...chestShoulderIsolation, ...back, ...legsKnee, ...legsHipCalf, ...hinge, ...arms, ...core }

export type FamilyGripName = keyof typeof FAMILY_GRIPS

/** grip names defined by more than one family module (a test keeps this empty) */
export function duplicateGrips(core: readonly string[]): string[] {
  const seen = new Map<string, number>(core.map((n) => [n, 1]))
  for (const part of Object.values(PARTS)) for (const n of Object.keys(part)) seen.set(n, (seen.get(n) ?? 0) + 1)
  return [...seen].filter(([, k]) => k > 1).map(([n]) => n)
}
