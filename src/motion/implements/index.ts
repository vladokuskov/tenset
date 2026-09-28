import * as arms from './arms.ts'
import * as back from './back.ts'
import * as chestShoulderIsolation from './chest-shoulder-isolation.ts'
import * as core from './core.ts'
import * as hinge from './hinge.ts'
import * as legsHipCalf from './legs-hip-calf.ts'
import * as legsKnee from './legs-knee.ts'
import * as pressHorizontal from './press-horizontal.ts'
import * as pressVerticalBodyweight from './press-vertical-bodyweight.ts'
import * as shared from './shared.ts'

// Implement extension modules: shared supports plus one module per family (docs/FAMILIES.md). Family agents edit
// only their own module; kinds and moving kinds are collected here.

export { floorMat, flatBench, plyoBox, wallSection, FLOOR_MAT, PLYO_BOX, SKIRTING, TREAD, WALL } from './shared.ts'

const MODULES = [shared, pressHorizontal, pressVerticalBodyweight, chestShoulderIsolation, back, legsKnee, legsHipCalf, hinge, arms, core]

export type ExtensionKind =
  | (typeof shared.KINDS)[number]
  | (typeof pressHorizontal.KINDS)[number]
  | (typeof pressVerticalBodyweight.KINDS)[number]
  | (typeof chestShoulderIsolation.KINDS)[number]
  | (typeof back.KINDS)[number]
  | (typeof legsKnee.KINDS)[number]
  | (typeof legsHipCalf.KINDS)[number]
  | (typeof hinge.KINDS)[number]
  | (typeof arms.KINDS)[number]
  | (typeof core.KINDS)[number]

/** implement kinds that move with the hands: the equipment-equipment check tests them against everything drawn */
export const MOVING_KINDS: ReadonlySet<string> = new Set(['barbell', 'ez_bar', 'dumbbell', 'cable_handle', ...MODULES.flatMap((m) => m.MOVING)])
