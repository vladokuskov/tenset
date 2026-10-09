import * as arms from './arms.ts'
import * as back from './back.ts'
import * as bands from './bands.ts'
import * as chestShoulderIsolation from './chest-shoulder-isolation.ts'
import * as core from './core.ts'
import * as freeWeights from './free-weights.ts'
import * as hinge from './hinge.ts'
import * as legsHipCalf from './legs-hip-calf.ts'
import * as legsKnee from './legs-knee.ts'
import * as portableC from './portable-c.ts'
import * as pressHorizontal from './press-horizontal.ts'
import * as pressVerticalBodyweight from './press-vertical-bodyweight.ts'
import * as shared from './shared.ts'
import * as stations from './stations.ts'

// Implement extension modules: shared supports plus one module per family (docs/FAMILIES.md). Family agents edit
// only their own module; kinds and moving kinds are collected here.

export { floorMat, flatBench, plyoBox, wallSection, FLOOR_MAT, PLYO_BOX, SKIRTING, TREAD, WALL } from './shared.ts'
export { around, band, bandAnchor, bandGrip, bandHandle, bandNode, bandPath, bandPose, isAnchor, isBand, poseHandle, segmentPose, BAND, BAND_ANCHOR, BAND_GRIP, BAND_HANDLE } from './bands.ts'
export type { AnchorMount, AnchorSpec, BandPoint, BandSize, BandSpec } from './bands.ts'
export { kettlebell, kettlebellDims, plateStack, trapBar, trapEdgeZ, weightPlate, KETTLEBELL_KG, PLATE, PLATE_RIM_SEGMENTS, TRAP_BAR } from './free-weights.ts'
export type { PlateKg } from './free-weights.ts'
export { abWheel, abWheelPose, abWheelSpin, gymRing, gymRings, isRingAnchor, isRingStrap, landmine, landmineBar, landminePitchFor, landminePose, ringAnchor, ringPose, ringStrap, strapPath, AB_WHEEL, LANDMINE, LANDMINE_V, RING, RING_HEIGHT } from './portable-c.ts'
export type { LandmineHandle, RingAnchorMount, RingAnchorSpec, RingStrapSpec } from './portable-c.ts'
export { beltLever, beltSquat, captainsChair, declineBench, ghd, hackSled, hackSquat, hipBelt, hyperLever, inclinePressLever, leverPose, pendulumArm, pendulumSquat, preacherBench, reverseHyper, sealBench, sledPose, tbarLever, tbarStation, BELT_SQUAT, CAPTAIN, CARRIAGE, DECLINE_BENCH, GHD, HACK, HIP_BELT, PENDULUM, PREACHER, REVERSE_HYPER, SEAL_BENCH, TBAR } from './stations.ts'

const MODULES = [shared, bands, freeWeights, portableC, pressHorizontal, pressVerticalBodyweight, chestShoulderIsolation, back, legsKnee, legsHipCalf, hinge, arms, core, stations]

export type ExtensionKind =
  | (typeof shared.KINDS)[number]
  | (typeof bands.KINDS)[number]
  | (typeof freeWeights.KINDS)[number]
  | (typeof portableC.KINDS)[number]
  | (typeof pressHorizontal.KINDS)[number]
  | (typeof pressVerticalBodyweight.KINDS)[number]
  | (typeof chestShoulderIsolation.KINDS)[number]
  | (typeof back.KINDS)[number]
  | (typeof legsKnee.KINDS)[number]
  | (typeof legsHipCalf.KINDS)[number]
  | (typeof hinge.KINDS)[number]
  | (typeof arms.KINDS)[number]
  | (typeof core.KINDS)[number]
  | (typeof stations.KINDS)[number]

/** implement kinds that move with the hands: the equipment-equipment check tests them against everything drawn */
export const MOVING_KINDS: ReadonlySet<string> = new Set(['barbell', 'ez_bar', 'dumbbell', 'cable_handle', ...MODULES.flatMap((m) => m.MOVING)])
