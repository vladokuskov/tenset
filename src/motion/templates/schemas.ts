import { z } from 'zod'
import {
  angle, Attachment, BenchAngle, CableHeight, common, Depth, Grip, GripWidth, Hold, ImplementId, MachineId, Posture, Stance,
  Support,
} from './params.ts'

// Frozen param schema per template id used in data/backlog.csv. Strict: unknown keys fail, so legacy keys
// surface during the one-pass normalization. Defaults describe the most common variant of each template.

/** implement "machine" without `machine` resolves to the template's usual machine */
const machineDefault = <T extends { implement: string; machine?: string }>(pick: (v: T) => NonNullable<T['machine']>) => (v: T): T =>
  v.implement === 'machine' && !v.machine ? { ...v, machine: pick(v) } : v

const press = (benchDefault: number, benchMin: number, benchMax: number) =>
  z.strictObject({
    implement: ImplementId.extract(['barbell', 'dumbbell', 'machine', 'smith']).default('barbell'),
    machine: MachineId.extract(['chest_press_machine']).optional(),
    posture: Posture.extract(['lying_supine', 'seated']).default('lying_supine'),
    benchAngle: angle(benchMin, benchMax).default(benchDefault),
    grip: Grip.extract(['pronated', 'neutral']).default('pronated'),
    gripWidth: GripWidth.default(1.4),
    /** upper-arm abduction from the torso at the bottom */
    elbowFlare: angle(0, 90).default(55),
    ...common,
  }).transform(machineDefault(() => 'chest_press_machine'))

export const SCHEMAS = {
  'horizontal-press': press(0, -30, 15),
  'incline-press': press(30, 10, 60),
  'vertical-press': z.strictObject({
    implement: ImplementId.extract(['barbell', 'dumbbell', 'machine', 'smith']).default('barbell'),
    machine: MachineId.extract(['shoulder_press_machine']).optional(),
    posture: Posture.extract(['standing', 'seated']).default('standing'),
    benchAngle: BenchAngle.default(90),
    grip: Grip.extract(['pronated', 'neutral']).default('pronated'),
    gripWidth: GripWidth.default(1.1),
    ...common,
  }).transform(machineDefault(() => 'shoulder_press_machine')),
  dip: z.strictObject({
    implement: ImplementId.extract(['bodyweight', 'machine']).default('bodyweight'),
    torsoAngle: angle(0, 60).default(20),
    grip: Grip.extract(['neutral', 'pronated']).default('neutral'),
    kneeAngle: angle(0, 120).default(70),
    ...common,
  }),
  'push-up': z.strictObject({
    implement: ImplementId.extract(['bodyweight']).default('bodyweight'),
    elevation: z.enum(['floor', 'hands', 'feet']).default('floor'),
    plus: z.boolean().default(false),
    gripWidth: GripWidth.default(1.2),
    kneeling: z.boolean().default(false),
    ...common,
  }),
  fly: z.strictObject({
    implement: ImplementId.extract(['dumbbell', 'cable', 'machine']).default('dumbbell'),
    machine: MachineId.extract(['pec_deck']).optional(),
    posture: Posture.extract(['lying_supine', 'standing', 'seated']).default('lying_supine'),
    benchAngle: BenchAngle.default(0),
    cableHeight: CableHeight.default('mid'),
    stance: Stance.extract(['hip', 'split']).default('hip'),
    grip: Grip.extract(['neutral', 'pronated']).default('neutral'),
    elbowAngle: angle(0, 60).default(20),
    ...common,
  }).transform(machineDefault(() => 'pec_deck')),
  'lateral-raise': z.strictObject({
    implement: ImplementId.extract(['dumbbell', 'cable', 'machine']).default('dumbbell'),
    posture: Posture.extract(['standing', 'seated']).default('standing'),
    cableHeight: CableHeight.default('low'),
    grip: Grip.extract(['neutral', 'pronated']).default('neutral'),
    /** plane of elevation: 0 = pure abduction, ~20-30 = scapular plane */
    plane: angle(-10, 60).default(20),
    topElevation: angle(60, 120).default(85),
    elbowAngle: angle(0, 45).default(15),
    leanAngle: angle(0, 40).default(0),
    support: Support.extract(['none', 'upright', 'bench']).default('none'),
    ...common,
  }),
  'front-raise': z.strictObject({
    implement: ImplementId.extract(['dumbbell', 'cable', 'barbell']).default('dumbbell'),
    posture: Posture.extract(['standing', 'seated', 'lying_prone']).default('standing'),
    benchAngle: BenchAngle.default(45),
    grip: Grip.extract(['pronated', 'neutral']).default('pronated'),
    /** 90 = straight forward, ~45 = Y-raise */
    plane: angle(20, 100).default(90),
    topElevation: angle(60, 180).default(90),
    elbowAngle: angle(0, 45).default(10),
    ...common,
  }),
  'rear-raise': z.strictObject({
    implement: ImplementId.extract(['dumbbell', 'cable', 'machine']).default('dumbbell'),
    machine: MachineId.extract(['pec_deck']).optional(),
    posture: Posture.extract(['standing', 'seated', 'lying_prone']).default('standing'),
    torsoAngle: angle(0, 90).default(75),
    benchAngle: BenchAngle.optional(),
    grip: Grip.extract(['neutral', 'pronated']).default('neutral'),
    cableHeight: CableHeight.default('mid'),
    crossed: z.boolean().default(false),
    elbowAngle: angle(0, 45).default(15),
    ...common,
  }).transform(machineDefault(() => 'pec_deck')),
  'external-rotation': z.strictObject({
    implement: ImplementId.extract(['cable', 'dumbbell']).default('cable'),
    posture: Posture.extract(['standing', 'side_lying']).default('standing'),
    armPosition: z.enum(['side', 'abducted']).default('side'),
    cableHeight: CableHeight.default('mid'),
    support: Support.extract(['none', 'bench']).default('none'),
    ...common,
  }),
  row: z.strictObject({
    implement: ImplementId.extract(['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'smith']).default('barbell'),
    posture: Posture.extract(['standing', 'seated', 'lying_prone', 'lying_supine', 'kneeling']).default('standing'),
    support: Support.extract(['none', 'bench', 'chest_pad']).default('none'),
    /** trunk angle from vertical: 0 upright, 90 horizontal */
    torsoAngle: angle(0, 90).default(45),
    benchAngle: BenchAngle.optional(),
    grip: Grip.default('pronated'),
    gripWidth: GripWidth.default(1.3),
    attachment: Attachment.optional(),
    cableHeight: CableHeight.default('mid'),
    /** upper-arm abduction from the torso at the finish: ~20 lats, ~65 upper back */
    elbowFlare: angle(0, 90).default(30),
    finish: z.enum(['none', 'external_rotation']).default('none'),
    barHeight: z.enum(['low', 'mid', 'high']).default('mid'),
    stance: Stance.extract(['hip', 'shoulder', 'split']).default('hip'),
    ...common,
  }),
  'vertical-pull': z.strictObject({
    implement: ImplementId.extract(['bodyweight', 'cable', 'machine']).default('bodyweight'),
    machine: MachineId.extract(['lat_pulldown', 'assisted_pullup']).optional(),
    posture: Posture.extract(['hanging', 'seated', 'kneeling']).default('hanging'),
    grip: Grip.extract(['pronated', 'supinated', 'neutral']).default('pronated'),
    gripWidth: GripWidth.default(1.5),
    attachment: Attachment.extract(['long_bar', 'v_bar', 'straight_bar', 'single_handle']).optional(),
    legs: z.enum(['straight', 'bent', 'crossed']).default('bent'),
    ...common,
  }).transform(machineDefault((v) => (v.posture === 'kneeling' ? 'assisted_pullup' : 'lat_pulldown'))),
  shrug: z.strictObject({
    implement: ImplementId.extract(['barbell', 'dumbbell', 'cable', 'smith', 'machine']).default('dumbbell'),
    posture: Posture.extract(['standing', 'seated']).default('standing'),
    grip: Grip.extract(['pronated', 'neutral', 'mixed']).default('neutral'),
    gripWidth: GripWidth.default(1.1),
    ...common,
  }),
  squat: z.strictObject({
    implement: ImplementId.extract(['barbell', 'dumbbell', 'smith', 'machine', 'bodyweight']).default('barbell'),
    machine: MachineId.extract(['leg_press']).optional(),
    hold: Hold.extract(['back_high', 'back_low', 'front_rack', 'goblet', 'sides', 'hands']).default('back_high'),
    posture: Posture.extract(['standing', 'seated', 'lying_supine']).default('standing'),
    stance: Stance.extract(['narrow', 'hip', 'shoulder', 'wide']).default('shoulder'),
    toeOut: angle(0, 45).default(15),
    depth: Depth.default('full'),
    gripWidth: GripWidth.default(2.1),
    /** leg press sled angle from horizontal */
    sledAngle: angle(0, 90).default(45),
    footPosition: z.enum(['low', 'mid', 'high', 'forward']).default('mid'),
    /** bodyweight squat arm placement */
    armPosition: z.enum(['forward', 'crossed', 'hips']).default('forward'),
    ...common,
  }).transform(machineDefault(() => 'leg_press')),
  lunge: z.strictObject({
    implement: ImplementId.extract(['dumbbell', 'barbell', 'bodyweight', 'smith']).default('dumbbell'),
    hold: Hold.extract(['sides', 'goblet', 'back_high', 'front_rack', 'hands']).default('sides'),
    direction: z.enum(['forward', 'reverse', 'in_place', 'step_up']).default('reverse'),
    rearFootElevated: z.boolean().default(false),
    travel: z.boolean().default(false),
    platformHeight: z.enum(['low', 'mid', 'knee']).default('knee'),
    /** step length as a multiple of leg length */
    stepLength: z.number().min(0.5).max(1.6).default(1),
    torsoAngle: angle(0, 45).default(10),
    ...common,
  }),
  'leg-extension': z.strictObject({
    implement: ImplementId.extract(['machine', 'cable']).default('machine'),
    machine: MachineId.extract(['leg_extension']).default('leg_extension'),
    posture: Posture.extract(['seated']).default('seated'),
    /** 90 upright seat, smaller = reclined */
    hipAngle: angle(0, 120).default(90),
    ...common,
  }),
  hinge: z.strictObject({
    implement: ImplementId.extract(['barbell', 'dumbbell', 'cable', 'bodyweight']).default('barbell'),
    hold: Hold.extract(['hands', 'front_of_thighs', 'opposite_hand', 'sides']).default('hands'),
    grip: Grip.default('pronated'),
    gripWidth: GripWidth.default(1.1),
    stance: Stance.extract(['narrow', 'hip', 'shoulder', 'wide', 'single_leg']).default('hip'),
    toeOut: angle(0, 45).default(10),
    kneeAngle: angle(0, 90).default(20),
    start: z.enum(['hang', 'floor']).default('hang'),
    attachment: Attachment.extract(['rope', 'single_handle', 'straight_bar']).optional(),
    cableHeight: CableHeight.default('low'),
    ...common,
  }),
  'hip-thrust': z.strictObject({
    implement: ImplementId.extract(['barbell', 'bodyweight', 'dumbbell', 'machine']).default('barbell'),
    support: Support.extract(['bench', 'floor']).default('bench'),
    stance: Stance.extract(['narrow', 'hip', 'shoulder', 'wide']).default('hip'),
    /** knee flexion at lockout; 90 = vertical shins */
    kneeAngle: angle(45, 120).default(90),
    ...common,
  }),
  'leg-curl': z.strictObject({
    implement: ImplementId.extract(['machine', 'bodyweight', 'dumbbell', 'cable']).default('machine'),
    machine: MachineId.extract(['leg_curl_seated', 'leg_curl_lying']).optional(),
    posture: Posture.extract(['seated', 'lying_prone', 'kneeling', 'standing']).default('seated'),
    hipAngle: angle(-10, 120).default(90),
    ...common,
  }).transform(machineDefault((v) => (v.posture === 'lying_prone' ? 'leg_curl_lying' : 'leg_curl_seated'))),
  'back-extension': z.strictObject({
    implement: ImplementId.extract(['bodyweight', 'dumbbell', 'barbell']).default('bodyweight'),
    benchAngle: angle(0, 45).default(45),
    armPosition: z.enum(['crossed', 'behind_head', 'extended']).default('crossed'),
    spine: z.enum(['neutral', 'flexion']).default('neutral'),
    ...common,
  }),
  'hip-abduction': z.strictObject({
    implement: ImplementId.extract(['machine', 'cable', 'bodyweight']).default('machine'),
    machine: MachineId.extract(['hip_abduction', 'hip_adduction']).optional(),
    direction: z.enum(['abduction', 'adduction']).default('abduction'),
    posture: Posture.extract(['seated', 'standing', 'side_lying']).default('seated'),
    hipAngle: angle(0, 110).default(90),
    attachment: Attachment.extract(['ankle_strap']).optional(),
    cableHeight: CableHeight.default('low'),
    ...common,
  }).transform(machineDefault((v) => (v.direction === 'adduction' ? 'hip_adduction' : 'hip_abduction'))),
  'calf-raise': z.strictObject({
    implement: ImplementId.extract(['machine', 'dumbbell', 'bodyweight', 'smith', 'barbell']).default('machine'),
    machine: MachineId.extract(['calf_machine', 'seated_calf', 'leg_press']).optional(),
    direction: z.enum(['plantarflexion', 'dorsiflexion']).default('plantarflexion'),
    posture: Posture.extract(['standing', 'seated']).default('standing'),
    kneeAngle: angle(0, 110).default(0),
    stance: Stance.extract(['hip', 'single_leg']).default('hip'),
    support: Support.extract(['none', 'wall']).default('none'),
    platform: z.enum(['floor', 'step']).default('step'),
    ...common,
  }).transform(machineDefault((v) => (v.posture === 'seated' ? 'seated_calf' : 'calf_machine'))),
  curl: z.strictObject({
    implement: ImplementId.extract(['dumbbell', 'barbell', 'ez_bar', 'cable']).default('dumbbell'),
    grip: Grip.extract(['supinated', 'neutral', 'pronated']).default('supinated'),
    /** dumbbells rotate from neutral at the bottom to supinated at the top */
    supinate: z.boolean().default(false),
    gripWidth: GripWidth.default(1),
    posture: Posture.extract(['standing', 'seated', 'lying_prone']).default('standing'),
    benchAngle: BenchAngle.optional(),
    /** upper arm relative to the torso; omitted = upper arm hangs vertically */
    shoulderFlexion: angle(-60, 100).optional(),
    attachment: Attachment.extract(['rope', 'straight_bar', 'ez_bar', 'single_handle']).optional(),
    cableHeight: CableHeight.default('low'),
    ...common,
  }),
  'triceps-extension': z.strictObject({
    implement: ImplementId.extract(['cable', 'dumbbell', 'ez_bar', 'barbell']).default('cable'),
    attachment: Attachment.extract(['rope', 'straight_bar', 'v_bar', 'single_handle', 'ez_bar']).optional(),
    cableHeight: CableHeight.default('high'),
    grip: Grip.extract(['neutral', 'pronated', 'supinated']).default('neutral'),
    gripWidth: GripWidth.default(0.8),
    posture: Posture.extract(['standing', 'seated', 'lying_supine']).default('standing'),
    benchAngle: BenchAngle.optional(),
    torsoAngle: angle(0, 90).default(10),
    stance: Stance.extract(['hip', 'split']).default('hip'),
    /** 0 = upper arm at the side (pushdown), ~110 lying, ~170 overhead */
    shoulderFlexion: angle(-60, 180).default(0),
    hold: Hold.extract(['hands', 'two_hand']).default('hands'),
    support: Support.extract(['none', 'bench']).default('none'),
    ...common,
  }),
  'wrist-curl': z.strictObject({
    implement: ImplementId.extract(['dumbbell', 'barbell', 'cable']).default('dumbbell'),
    grip: Grip.extract(['supinated', 'pronated']).default('supinated'),
    posture: Posture.extract(['kneeling', 'seated']).default('kneeling'),
    support: Support.extract(['bench', 'thigh']).default('bench'),
    ...common,
  }),
  crunch: z.strictObject({
    implement: ImplementId.extract(['bodyweight', 'cable', 'machine']).default('bodyweight'),
    attachment: Attachment.extract(['rope']).optional(),
    cableHeight: CableHeight.default('high'),
    posture: Posture.extract(['kneeling', 'lying_supine']).default('lying_supine'),
    kneeAngle: angle(0, 130).default(90),
    ...common,
  }),
  'leg-raise': z.strictObject({
    implement: ImplementId.extract(['bodyweight']).default('bodyweight'),
    posture: Posture.extract(['hanging', 'lying_supine']).default('hanging'),
    support: Support.extract(['none', 'elbow_pads']).default('none'),
    kneeAngle: angle(0, 120).default(0),
    /** hip flexion at the top */
    topHipAngle: angle(45, 130).default(100),
    ...common,
  }),
  hold: z.strictObject({
    kind: z.enum(['front_plank', 'side_plank', 'pallof_press']).default('front_plank'),
    implement: ImplementId.extract(['bodyweight', 'cable']).default('bodyweight'),
    support: z.enum(['forearm', 'hand']).default('forearm'),
    legs: z.enum(['stacked', 'staggered']).default('stacked'),
    attachment: Attachment.extract(['single_handle']).optional(),
    cableHeight: CableHeight.default('mid'),
    stance: Stance.extract(['hip', 'shoulder', 'split']).default('hip'),
    pressOut: z.boolean().default(false),
    ...common,
  }),
  rotation: z.strictObject({
    implement: ImplementId.extract(['cable', 'bodyweight', 'dumbbell']).default('cable'),
    attachment: Attachment.extract(['single_handle', 'rope']).optional(),
    cableHeight: CableHeight.default('high'),
    direction: z.enum(['high_to_low', 'low_to_high', 'horizontal']).default('high_to_low'),
    stance: Stance.extract(['hip', 'shoulder', 'wide', 'split']).default('wide'),
    posture: Posture.extract(['standing', 'kneeling']).default('standing'),
    ...common,
  }),
} as const

export type TemplateId = keyof typeof SCHEMAS
export const TEMPLATE_IDS = Object.keys(SCHEMAS) as TemplateId[]
export type ParamsOf<T extends TemplateId> = z.infer<(typeof SCHEMAS)[T]>
