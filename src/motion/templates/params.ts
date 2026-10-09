import { z } from 'zod'

// One vocabulary for every template's media.params. Documented in data/motion-templates/PARAMS.md.
// Angles in degrees. gripWidth is a multiple of skeleton shoulderWidth (distance between the shoulder joint centres).

export const ImplementId = z.enum(['barbell', 'dumbbell', 'ez_bar', 'cable', 'machine', 'smith', 'bodyweight', 'band', 'kettlebell', 'plate', 'trap_bar'])
export const MachineId = z.enum([
  'leg_press', 'leg_extension', 'leg_curl_seated', 'leg_curl_lying', 'lat_pulldown', 'chest_press_machine',
  'shoulder_press_machine', 'pec_deck', 'hip_abduction', 'hip_adduction', 'back_extension', 'assisted_pullup',
  'calf_machine', 'seated_calf',
])
export const Grip = z.enum(['pronated', 'supinated', 'neutral', 'mixed'])
export const GripWidth = z.number().min(0.5).max(2.6)
/** back pad angle from horizontal: 0 flat, + incline, - decline, 90 upright seat back */
export const BenchAngle = z.number().min(-30).max(90)
export const CableHeight = z.enum(['low', 'mid', 'high'])
export const Posture = z.enum(['standing', 'seated', 'lying_prone', 'lying_supine', 'kneeling', 'hanging', 'side_lying'])
export const Laterality = z.enum(['bilateral', 'unilateral', 'alternating'])
export const WorkingSide = z.enum(['left', 'right'])
export const Attachment = z.enum(['rope', 'straight_bar', 'ez_bar', 'v_bar', 'single_handle', 'long_bar', 'ankle_strap'])
export const Stance = z.enum(['narrow', 'hip', 'shoulder', 'wide', 'split', 'single_leg'])
/** where the load sits */
export const Hold = z.enum(['hands', 'sides', 'goblet', 'front_rack', 'back_high', 'back_low', 'front_of_thighs', 'overhead', 'chest', 'opposite_hand', 'two_hand'])
export const Depth = z.enum(['quarter', 'parallel', 'full'])
export const Support = z.enum(['none', 'bench', 'chest_pad', 'wall', 'upright', 'thigh', 'elbow_pads', 'floor'])
export const Tempo = z.tuple([z.number().min(0).max(10), z.number().min(0).max(10), z.number().min(0).max(10), z.number().min(0).max(10)])

export const angle = (min: number, max: number) => z.number().min(min).max(max)

/** injected or shared by every template; laterality comes from the exercise record, not media.params */
export const common = {
  laterality: Laterality.default('bilateral'),
  side: WorkingSide.default('right'),
  tempo: Tempo.optional(),
}

