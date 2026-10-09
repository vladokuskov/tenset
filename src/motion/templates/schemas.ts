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
    /** landmine = standing, both hands cupped round the tip of a landmine bar at the upper chest */
    implement: ImplementId.extract(['barbell', 'dumbbell', 'machine', 'smith', 'landmine']).default('barbell'),
    machine: MachineId.extract(['chest_press_machine']).optional(),
    posture: Posture.extract(['lying_supine', 'seated', 'standing']).default('lying_supine'),
    /** machine: the press line's angle above horizontal at mid-stroke */
    benchAngle: angle(benchMin, benchMax).default(benchDefault),
    grip: Grip.extract(['pronated', 'neutral']).default('pronated'),
    gripWidth: GripWidth.default(1.4),
    /** upper-arm abduction from the torso at the bottom */
    elbowFlare: angle(0, 90).default(55),
    /** standing (landmine): split = staggered, one foot forward; omitted = the variant's usual */
    stance: Stance.extract(['hip', 'split']).optional(),
    ...common,
  }).transform(machineDefault(() => 'chest_press_machine'))

export const SCHEMAS = {
  'horizontal-press': z.strictObject({
    implement: ImplementId.extract(['barbell', 'dumbbell', 'machine', 'smith', 'kettlebell', 'cable', 'band']).default('barbell'),
    machine: MachineId.extract(['chest_press_machine']).optional(),
    posture: Posture.extract(['lying_supine', 'seated', 'standing']).default('lying_supine'),
    benchAngle: angle(-30, 15).default(0),
    grip: Grip.extract(['pronated', 'neutral']).default('pronated'),
    gripWidth: GripWidth.default(1.4),
    /** upper-arm abduction from the torso at the bottom */
    elbowFlare: angle(0, 90).default(55),
    /** floor = lying on a mat (floor press: the upper arms stop on the floor); omitted = the bench */
    support: Support.extract(['bench', 'floor']).optional(),
    /** standing cable or band press: split = one foot forward; omitted = hip */
    stance: Stance.extract(['hip', 'split']).optional(),
    /** dumbbells pressed together the whole rep (squeeze press) */
    squeeze: z.boolean().optional(),
    ...common,
  }).transform(machineDefault(() => 'chest_press_machine')),
  'incline-press': press(30, 10, 60),
  'vertical-press': z.strictObject({
    /** landmine = one end of a barbell in a floor pivot in front, the other pressed up and forward from the shoulder */
    implement: ImplementId.extract(['barbell', 'dumbbell', 'machine', 'smith', 'kettlebell', 'band', 'landmine']).default('barbell'),
    machine: MachineId.extract(['shoulder_press_machine']).optional(),
    /** kneeling = half kneeling (landmine): the pressing side's knee down, the other foot flat in front */
    posture: Posture.extract(['standing', 'seated', 'kneeling']).default('standing'),
    benchAngle: BenchAngle.default(90),
    /** supinated = palms facing you at the start (Arnold press, with `rotate`) */
    grip: Grip.extract(['pronated', 'neutral', 'supinated']).default('pronated'),
    gripWidth: GripWidth.default(1.1),
    /** seated: floor = sitting on a mat, legs straight (Z press); omitted = the bench */
    support: Support.extract(['bench', 'floor']).optional(),
    /** dumbbells turn from the start grip to palms forward on the way up and back on the way down (Arnold press) */
    rotate: z.boolean().optional(),
    /** standing (landmine): split = staggered, the pressing side's foot back; omitted = the variant's usual */
    stance: Stance.extract(['hip', 'split']).optional(),
    ...common,
  }).transform(machineDefault(() => 'shoulder_press_machine')),
  dip: z.strictObject({
    /** rings = on gymnastic rings, the rings by the hips */
    implement: ImplementId.extract(['bodyweight', 'machine', 'rings']).default('bodyweight'),
    torsoAngle: angle(0, 60).default(20),
    grip: Grip.extract(['neutral', 'pronated']).default('neutral'),
    kneeAngle: angle(0, 120).default(70),
    /** bench = hands on a bench edge behind the hips, feet on the floor (bench dip); omitted = parallel bars */
    support: Support.extract(['bench']).optional(),
    ...common,
  }),
  'push-up': z.strictObject({
    /** band = a band across the upper back, its ends under the hands; rings = the hands on gymnastic rings just above the floor */
    implement: ImplementId.extract(['bodyweight', 'band', 'rings']).default('bodyweight'),
    elevation: z.enum(['floor', 'hands', 'feet']).default('floor'),
    plus: z.boolean().default(false),
    /** below 0.5 the hands touch, fingers turned in (diamond) */
    gripWidth: z.number().min(0.2).max(2.6).default(1.2),
    kneeling: z.boolean().default(false),
    /** hips high, the body folded at the hips, the head lowering in front of the hands (pike push-up) */
    pike: z.boolean().optional(),
    ...common,
  }),
  fly: z.strictObject({
    implement: ImplementId.extract(['dumbbell', 'cable', 'machine', 'band']).default('dumbbell'),
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
    implement: ImplementId.extract(['dumbbell', 'cable', 'machine', 'band']).default('dumbbell'),
    posture: Posture.extract(['standing', 'seated']).default('standing'),
    cableHeight: CableHeight.default('low'),
    grip: Grip.extract(['neutral', 'pronated']).default('neutral'),
    /** plane of elevation: 0 = pure abduction, ~20-30 = scapular plane */
    plane: angle(-10, 60).default(20),
    topElevation: angle(60, 150).default(85),
    elbowAngle: angle(0, 45).default(15),
    leanAngle: angle(0, 40).default(0),
    support: Support.extract(['none', 'upright', 'bench']).default('none'),
    /** bilateral cable: each hand takes the opposite low pulley's cable, crossed in front of the body */
    crossed: z.boolean().optional(),
    ...common,
  }),
  'front-raise': z.strictObject({
    implement: ImplementId.extract(['dumbbell', 'cable', 'barbell', 'plate']).default('dumbbell'),
    posture: Posture.extract(['standing', 'seated', 'lying_prone']).default('standing'),
    benchAngle: BenchAngle.default(45),
    grip: Grip.extract(['pronated', 'neutral']).default('pronated'),
    /** 90 = straight forward, ~45 = Y-raise */
    plane: angle(20, 100).default(90),
    topElevation: angle(60, 180).default(90),
    elbowAngle: angle(0, 45).default(10),
    /** cable: rope = both hands on the rope ends, the cable from a low pulley behind running between the legs */
    attachment: Attachment.extract(['rope']).optional(),
    ...common,
  }),
  'rear-raise': z.strictObject({
    implement: ImplementId.extract(['dumbbell', 'cable', 'machine', 'band']).default('dumbbell'),
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
    implement: ImplementId.extract(['cable', 'dumbbell', 'band']).default('cable'),
    posture: Posture.extract(['standing', 'side_lying']).default('standing'),
    armPosition: z.enum(['side', 'abducted']).default('side'),
    cableHeight: CableHeight.default('mid'),
    support: Support.extract(['none', 'bench']).default('none'),
    ...common,
  }),
  row: z.strictObject({
    /** machine = the chest-supported T-bar station; landmine = a bar pivoting in a floor landmine (T-bar, Meadows row) */
    implement: ImplementId.extract(['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'smith', 'band', 'kettlebell', 'landmine', 'rings']).default('barbell'),
    posture: Posture.extract(['standing', 'seated', 'lying_prone', 'lying_supine', 'kneeling']).default('standing'),
    support: Support.extract(['none', 'bench', 'chest_pad', 'floor']).default('none'),
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
    stance: Stance.extract(['hip', 'shoulder', 'split', 'wide']).default('hip'),
    /** floor = the bar returns to the floor and rests there each rep (Pendlay row); omitted = rows from the hang */
    start: z.enum(['hang', 'floor']).optional(),
    ...common,
  }),
  'vertical-pull': z.strictObject({
    /** rings = hanging from gymnastic rings (the palms turn in as the body rises) */
    implement: ImplementId.extract(['bodyweight', 'cable', 'machine', 'band', 'rings']).default('bodyweight'),
    machine: MachineId.extract(['lat_pulldown', 'assisted_pullup']).optional(),
    posture: Posture.extract(['hanging', 'seated', 'kneeling']).default('hanging'),
    grip: Grip.extract(['pronated', 'supinated', 'neutral']).default('pronated'),
    gripWidth: GripWidth.default(1.5),
    attachment: Attachment.extract(['long_bar', 'v_bar', 'straight_bar', 'single_handle']).optional(),
    legs: z.enum(['straight', 'bent', 'crossed']).default('bent'),
    /** scapular = shoulder blades only, elbows straight (scapular pull-up); omitted = the full pull */
    range: z.enum(['full', 'scapular']).optional(),
    ...common,
  }).transform(machineDefault((v) => (v.posture === 'kneeling' ? 'assisted_pullup' : 'lat_pulldown'))),
  shrug: z.strictObject({
    implement: ImplementId.extract(['barbell', 'dumbbell', 'cable', 'smith', 'machine', 'band', 'trap_bar']).default('dumbbell'),
    posture: Posture.extract(['standing', 'seated']).default('standing'),
    grip: Grip.extract(['pronated', 'neutral', 'mixed']).default('neutral'),
    gripWidth: GripWidth.default(1.1),
    /** upright_row = the bar rises close up the body, elbows leading to shoulder height; omitted = the shrug */
    movement: z.enum(['shrug', 'upright_row']).optional(),
    ...common,
  }),
  squat: z.strictObject({
    /** landmine = both hands cupped round the tip of a landmine bar at the chest; band = a band behind the knees anchored
     * ahead (Spanish squat) */
    implement: ImplementId.extract(['barbell', 'dumbbell', 'smith', 'machine', 'bodyweight', 'kettlebell', 'landmine', 'band']).default('barbell'),
    machine: MachineId.extract(['leg_press', 'hack_squat', 'pendulum_squat', 'belt_squat']).optional(),
    /** two_hand = one dumbbell hanging upright between the legs, its top head cupped in both hands (sumo squat) */
    hold: Hold.extract(['back_high', 'back_low', 'front_rack', 'goblet', 'sides', 'hands', 'two_hand']).default('back_high'),
    posture: Posture.extract(['standing', 'seated', 'lying_supine']).default('standing'),
    /** single_leg = pistol: one foot planted, the other leg reaching forward */
    stance: Stance.extract(['narrow', 'hip', 'shoulder', 'wide', 'single_leg']).default('shoulder'),
    toeOut: angle(0, 45).default(15),
    depth: Depth.default('full'),
    gripWidth: GripWidth.default(2.1),
    /** leg press sled angle from horizontal */
    sledAngle: angle(0, 90).default(45),
    footPosition: z.enum(['low', 'mid', 'high', 'forward']).default('mid'),
    /** bodyweight squat arm placement */
    armPosition: z.enum(['forward', 'crossed', 'hips']).default('forward'),
    /** heels on a weight plate, forefeet on the floor */
    heelsElevated: z.boolean().optional(),
    /** sit back onto a box at the bottom (box squat; depth sets the box height) */
    box: z.boolean().optional(),
    /** hack squat facing the machine, the chest on the pad (reverse hack squat) */
    reverse: z.boolean().optional(),
    /** sissy squat: on the balls of the feet, the knees travel forward with the hips straight, a hand on a wall */
    sissy: z.boolean().optional(),
    ...common,
  }).transform(machineDefault(() => 'leg_press')),
  lunge: z.strictObject({
    implement: ImplementId.extract(['dumbbell', 'barbell', 'bodyweight', 'smith', 'kettlebell']).default('dumbbell'),
    hold: Hold.extract(['sides', 'goblet', 'back_high', 'front_rack', 'hands']).default('sides'),
    /** lateral = the working leg steps out to the side; curtsy = the rear leg steps back and across; cossack = a very
     * wide stance, sinking deep over one foot with the other leg straight, its toes up */
    direction: z.enum(['forward', 'reverse', 'in_place', 'step_up', 'lateral', 'curtsy', 'cossack']).default('reverse'),
    rearFootElevated: z.boolean().default(false),
    /** in place: the front foot on a low step (deficit split squat) */
    frontFootElevated: z.boolean().optional(),
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
    /** trap_bar = standing inside the hexagon, hands on the handles at the sides (hold sides, grip neutral) */
    implement: ImplementId.extract(['barbell', 'dumbbell', 'cable', 'bodyweight', 'kettlebell', 'trap_bar']).default('barbell'),
    /** back_high = good morning (bar on the upper back) */
    hold: Hold.extract(['hands', 'front_of_thighs', 'opposite_hand', 'sides', 'back_high']).default('hands'),
    grip: Grip.default('pronated'),
    gripWidth: GripWidth.default(1.1),
    /** split = B-stance (kickstand): the back toes beside the front heel, most of the weight on the front (side) leg */
    stance: Stance.extract(['narrow', 'hip', 'shoulder', 'wide', 'single_leg', 'split']).default('hip'),
    toeOut: angle(0, 45).default(10),
    kneeAngle: angle(0, 90).default(20),
    /** pins = rack pull: the bar starts on the rack's safety pins just below the knees */
    start: z.enum(['hang', 'floor', 'pins']).default('hang'),
    attachment: Attachment.extract(['rope', 'single_handle', 'straight_bar']).optional(),
    cableHeight: CableHeight.default('low'),
    ...common,
  }),
  'hip-thrust': z.strictObject({
    implement: ImplementId.extract(['barbell', 'bodyweight', 'dumbbell', 'machine', 'smith']).default('barbell'),
    support: Support.extract(['bench', 'floor']).default('bench'),
    stance: Stance.extract(['narrow', 'hip', 'shoulder', 'wide', 'single_leg']).default('hip'),
    /** knee flexion at lockout; 90 = vertical shins */
    kneeAngle: angle(45, 120).default(90),
    ...common,
  }),
  'leg-curl': z.strictObject({
    implement: ImplementId.extract(['machine', 'bodyweight', 'dumbbell', 'cable']).default('machine'),
    machine: MachineId.extract(['leg_curl_seated', 'leg_curl_lying']).optional(),
    posture: Posture.extract(['seated', 'lying_prone', 'kneeling', 'standing']).default('seated'),
    hipAngle: angle(-10, 120).default(90),
    /** bodyweight kneeling: ghd = glute-ham raise on a glute-ham developer (knees behind the round pad, ankles between
     * the rollers); omitted = the floor Nordic */
    support: z.enum(['ghd']).optional(),
    ...common,
  }).transform(machineDefault((v) => (v.posture === 'lying_prone' ? 'leg_curl_lying' : 'leg_curl_seated'))),
  'back-extension': z.strictObject({
    implement: ImplementId.extract(['bodyweight', 'dumbbell', 'barbell']).default('bodyweight'),
    benchAngle: angle(0, 45).default(45),
    armPosition: z.enum(['crossed', 'behind_head', 'extended']).default('crossed'),
    spine: z.enum(['neutral', 'flexion']).default('neutral'),
    /** ghd = on a glute-ham developer: horizontal, the upper thighs over the round pad, ankles between the rollers
     * (90-degree back extension; benchAngle is ignored) */
    support: z.enum(['ghd']).optional(),
    ...common,
  }),
  'hip-abduction': z.strictObject({
    /** band = mini band round the legs above the knees (seated: on the front of a flat bench) */
    implement: ImplementId.extract(['machine', 'cable', 'bodyweight', 'band']).default('machine'),
    machine: MachineId.extract(['hip_abduction', 'hip_adduction']).optional(),
    direction: z.enum(['abduction', 'adduction']).default('abduction'),
    posture: Posture.extract(['seated', 'standing', 'side_lying']).default('seated'),
    hipAngle: angle(0, 110).default(90),
    attachment: Attachment.extract(['ankle_strap']).optional(),
    cableHeight: CableHeight.default('low'),
    ...common,
  }).transform(machineDefault((v) => (v.direction === 'adduction' ? 'hip_adduction' : 'hip_abduction'))),
  'calf-raise': z.strictObject({
    implement: ImplementId.extract(['machine', 'dumbbell', 'bodyweight', 'smith', 'barbell', 'band']).default('machine'),
    machine: MachineId.extract(['calf_machine', 'seated_calf', 'leg_press', 'hack_squat']).optional(),
    direction: z.enum(['plantarflexion', 'dorsiflexion']).default('plantarflexion'),
    posture: Posture.extract(['standing', 'seated']).default('standing'),
    kneeAngle: angle(0, 110).default(0),
    stance: Stance.extract(['hip', 'single_leg']).default('hip'),
    /** bench = forearms on a bench, hips hinged (donkey); floor = long sitting on the floor, hands behind */
    support: Support.extract(['none', 'wall', 'bench', 'floor']).default('none'),
    platform: z.enum(['floor', 'step']).default('step'),
    /** trunk angle from vertical when hinged over a support (donkey raise) */
    torsoAngle: angle(0, 90).optional(),
    ...common,
  }).transform(machineDefault((v) => (v.posture === 'seated' ? 'seated_calf' : 'calf_machine'))),
  curl: z.strictObject({
    implement: ImplementId.extract(['dumbbell', 'barbell', 'ez_bar', 'cable', 'band']).default('dumbbell'),
    grip: Grip.extract(['supinated', 'neutral', 'pronated']).default('supinated'),
    /** dumbbells rotate from neutral at the bottom to supinated at the top */
    supinate: z.boolean().default(false),
    /** grip on the way down when it differs (Zottman: supinated up, pronated down); turns at the top and bottom */
    lowerGrip: Grip.extract(['supinated', 'neutral', 'pronated']).optional(),
    /** hand path: omitted = the usual arc; drag = bar against the torso, elbows travel back; cross_body = towards the opposite shoulder */
    path: z.enum(['drag', 'cross_body']).optional(),
    /** thigh = concentration curl: seated, the working upper arm braced on the inner thigh; preacher = seated, the
     * upper arms on a preacher bench's sloping pad */
    support: z.enum(['thigh', 'preacher']).optional(),
    /** two_hand = one dumbbell held upright by its top head in both palms (waiter curl) */
    hold: Hold.extract(['two_hand']).optional(),
    /** abducted = upper arms level out to the sides between two pulleys (high cable curl) */
    armPosition: z.enum(['abducted']).optional(),
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
    /** rings = standing, leaning into gymnastic rings at chest height (bodyweight extension) */
    implement: ImplementId.extract(['cable', 'dumbbell', 'ez_bar', 'barbell', 'band', 'rings']).default('cable'),
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
    /** upper-arm abduction from the torso; lying with dumbbells palms to the feet and elbows out = Tate press */
    elbowFlare: angle(0, 90).optional(),
    ...common,
  }),
  'wrist-curl': z.strictObject({
    implement: ImplementId.extract(['dumbbell', 'barbell', 'cable', 'band']).default('dumbbell'),
    grip: Grip.extract(['supinated', 'pronated']).default('supinated'),
    /** standing = bar behind the thighs, arms hanging (pronated: palms back, the wrists flex the bar up behind) */
    posture: Posture.extract(['kneeling', 'seated', 'standing']).default('kneeling'),
    /** kneeling on thigh = half kneeling, the working forearm along the front thigh (bilateral cable: kneeling, sitting
     * back, both forearms along the thighs) */
    support: Support.extract(['bench', 'thigh', 'none']).default('bench'),
    /** cable: the attachment on the low pulley */
    attachment: Attachment.extract(['straight_bar']).optional(),
    ...common,
  }),
  crunch: z.strictObject({
    implement: ImplementId.extract(['bodyweight', 'cable', 'machine', 'plate']).default('bodyweight'),
    attachment: Attachment.extract(['rope']).optional(),
    cableHeight: CableHeight.default('high'),
    /** seated (with implement machine) = on a GHD pad, feet under its rollers (GHD sit-up) */
    posture: Posture.extract(['kneeling', 'lying_supine', 'standing', 'seated']).default('lying_supine'),
    kneeAngle: angle(0, 130).default(90),
    /** sit_up: the trunk rises from the hips to nearly upright; omitted = crunch (shoulder blades off the floor) */
    range: z.enum(['crunch', 'sit_up']).optional(),
    /** crossed = arms folded across the chest, each hand on the opposite side; omitted = fingertips at the temples (a
     * plate is held on the chest by its rim) */
    arms: z.enum(['temples', 'crossed']).optional(),
    /** lying on a decline bench, feet hooked under its rollers: the back pad's angle (negative); omitted = the floor */
    benchAngle: angle(-30, 0).optional(),
    ...common,
  }),
  'leg-raise': z.strictObject({
    implement: ImplementId.extract(['bodyweight']).default('bodyweight'),
    posture: Posture.extract(['hanging', 'lying_supine']).default('hanging'),
    support: Support.extract(['none', 'elbow_pads']).default('none'),
    kneeAngle: angle(0, 120).default(0),
    /** hip flexion at the top (total between thighs and thorax; past 130 only for toes-to-bar; below 45 only for
     * lying alternating kicks) */
    topHipAngle: angle(20, 160).default(100),
    /** hanging: the trunk leans back until the toes touch the bar (toes-to-bar) */
    toBar: z.boolean().optional(),
    /** lying: thigh angle above the mat at the bottom; omitted = legs just off the mat */
    bottomHipAngle: angle(0, 100).optional(),
    /** lying: the pelvis rolls up off the mat towards the ribs (reverse crunch) */
    pelvisCurl: z.boolean().optional(),
    /** hanging: the knees turn towards the working side's shoulder at the top, deg of pelvis rotation (oblique raise) */
    twist: angle(0, 45).optional(),
    ...common,
  }),
  hold: z.strictObject({
    /** copenhagen_plank = side plank on the forearm with the working (top) leg across a flat bench, the bottom leg hanging */
    /** l_sit = on straight arms between dip bars, legs straight out level with the hips */
    kind: z.enum(['front_plank', 'side_plank', 'pallof_press', 'hollow_hold', 'bear_plank', 'suitcase_hold', 'copenhagen_plank', 'l_sit']).default('front_plank'),
    implement: ImplementId.extract(['bodyweight', 'cable', 'band', 'dumbbell']).default('bodyweight'),
    support: z.enum(['forearm', 'hand']).default('forearm'),
    legs: z.enum(['stacked', 'staggered']).default('stacked'),
    attachment: Attachment.extract(['single_handle']).optional(),
    cableHeight: CableHeight.default('mid'),
    stance: Stance.extract(['hip', 'shoulder', 'split']).default('hip'),
    pressOut: z.boolean().default(false),
    /** forearm front plank: elbows this far ahead of the shoulders, m (long-lever plank) */
    elbowsAhead: z.number().min(0).max(0.3).optional(),
    /** side plank: the hips lower this far towards the floor and drive back up each rep, m (hip dip) */
    hipDip: z.number().min(0).max(0.3).optional(),
    /** hand plank: the working side's hand taps the opposite shoulder each rep (shoulder tap) */
    tap: z.boolean().optional(),
    ...common,
  }),
  rotation: z.strictObject({
    /** barbell = one end of a bar in a landmine, the free end held in both hands (landmine rotation) */
    implement: ImplementId.extract(['cable', 'bodyweight', 'dumbbell', 'band', 'plate', 'barbell']).default('cable'),
    attachment: Attachment.extract(['single_handle', 'rope']).optional(),
    cableHeight: CableHeight.default('high'),
    direction: z.enum(['high_to_low', 'low_to_high', 'horizontal']).default('high_to_low'),
    stance: Stance.extract(['hip', 'shoulder', 'wide', 'split']).default('wide'),
    /** seated: on the mat leaning back, heels down (Russian twist) */
    posture: Posture.extract(['standing', 'kneeling', 'seated']).default('standing'),
    ...common,
  }),
  // tier C templates (wave 3c): always on the ab wheel, so no implement key
  rollout: z.strictObject({
    /** kneeling = from the knees on a pad; standing = from the feet, legs straight */
    posture: Posture.extract(['kneeling', 'standing']).default('kneeling'),
    /** oblique = the wheel rolls out on a diagonal towards the working side and back to the centre */
    direction: z.enum(['straight', 'oblique']).default('straight'),
    /** oblique: the path's angle from straight ahead; omitted = the template's usual diagonal */
    diagonal: angle(10, 45).optional(),
    /** shoulder flexion at full extension (~170 = arms in line with the trunk) */
    reach: angle(90, 180).default(160),
    ...common,
  }),
  'floor-core': z.strictObject({
    kind: z.enum(['dead_bug', 'bird_dog', 'mountain_climber', 'bicycle', 'v_up', 'dragon_flag', 'superman']).default('dead_bug'),
    /** bench = lying on a flat bench, hands gripping it behind the head (dragon flag); omitted = the kind's usual (the floor) */
    support: Support.extract(['floor', 'bench']).optional(),
    /** knee flexion of the extending leg(s) at full reach; omitted = the kind's usual */
    kneeAngle: angle(0, 120).optional(),
    ...common,
  }),
  pullover: z.strictObject({
    implement: ImplementId.extract(['cable', 'dumbbell', 'band']).default('cable'),
    /** standing = straight-arm pulldown (cable, band); lying_supine = on a flat bench (dumbbell pullover) */
    posture: Posture.extract(['standing', 'lying_supine']).default('standing'),
    attachment: Attachment.extract(['straight_bar', 'rope']).optional(),
    cableHeight: CableHeight.default('high'),
    grip: Grip.extract(['pronated', 'neutral']).default('pronated'),
    gripWidth: GripWidth.default(1),
    /** two_hand = one dumbbell held upright by its top head in both palms */
    hold: Hold.extract(['hands', 'two_hand']).default('hands'),
    /** standing: trunk angle from vertical, hinged forward */
    torsoAngle: angle(0, 45).default(15),
    /** elbow flexion held through the rep */
    elbowAngle: angle(0, 45).default(10),
    /** shoulder flexion at the stretch; omitted = the variant's usual */
    topElevation: angle(60, 180).optional(),
    stance: Stance.extract(['hip', 'split']).default('hip'),
    ...common,
  }),
  swing: z.strictObject({
    implement: ImplementId.extract(['kettlebell', 'dumbbell']).default('kettlebell'),
    /** chest = the bell floats to chest height (Russian swing); overhead = arms vertical at the top */
    height: z.enum(['chest', 'overhead']).default('chest'),
    stance: Stance.extract(['hip', 'shoulder', 'wide']).default('shoulder'),
    toeOut: angle(0, 45).default(15),
    /** knee flexion at the bottom of the hike; omitted = the template's usual */
    kneeAngle: angle(0, 60).optional(),
    ...common,
  }),
  'hip-kickback': z.strictObject({
    implement: ImplementId.extract(['cable', 'bodyweight', 'band']).default('cable'),
    /** standing = one leg kicks back against a low cable; lying_prone = reverse hyperextension, hips at the bench end,
     * both legs swing up; kneeling = on all fours (donkey kick) */
    posture: Posture.extract(['standing', 'lying_prone', 'kneeling']).default('standing'),
    attachment: Attachment.extract(['ankle_strap']).optional(),
    cableHeight: CableHeight.default('low'),
    /** lying_prone: what the trunk lies on; omitted = a flat bench; bench = a high padded bench with handles (the
     * reverse hyper station's frame, unloaded), so the straight legs hang free */
    support: Support.extract(['bench']).optional(),
    /** knee flexion of the working leg(s), held through the rep */
    kneeAngle: angle(0, 100).default(0),
    /** standing: trunk lean from vertical, hands on the cable frame */
    torsoAngle: angle(0, 60).default(20),
    ...common,
  }),
} as const

export type TemplateId = keyof typeof SCHEMAS
export const TEMPLATE_IDS = Object.keys(SCHEMAS) as TemplateId[]
export type ParamsOf<T extends TemplateId> = z.infer<(typeof SCHEMAS)[T]>
