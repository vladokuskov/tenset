# Motion template params

Frozen param vocabulary for `media.params` of every template id in `data/backlog.csv`. Source of truth is
`src/motion/templates/schemas.ts` (zod, strict: unknown keys fail); the per-template tables below are generated
from it. All 106 exercise records were normalized onto this vocabulary on 2026-09-27 (the one-pass mapping is
summarized below; the script and its dry-run output are retired). `src/motion/params.test.ts` checks every record's
`media.params` against its strict schema, and motion QA (`pipeline/motion/qa.ts`) reads the records directly.

## Conventions

- Angles in degrees. Joint angles use 0 = straight / anatomical neutral, flexion positive.
- World axes: X = figure's left, Y = up, Z = forward (same as the figure and glTF). Metres.
- `gripWidth`: hand-centre distance as a multiple of skeleton `shoulderWidth` (distance between the shoulder
  joint centres; 0.454 m on body.glb). 1.0 = hands directly above/below the shoulder joints. Literature quotes
  biacromial breadth (BAD), which is narrower; assuming BAD of about 0.40 m, BAD 1.4x is roughly gripWidth 1.25.
- `benchAngle`: back pad angle from horizontal. 0 flat, positive incline, negative decline, 90 upright seat back.
- `torsoAngle`: trunk angle from vertical. 0 upright, 90 horizontal.
- `kneeAngle`, `hipAngle`: joint flexion, 0 = straight.
- `laterality` comes from the exercise record (`parseParams(id, params, record.laterality)`), never from
  `media.params`. `side` is the working side for unilateral work (alternating starts with it).
- `tempo`: optional override, Wilk notation in seconds `[eccentric, pause lengthened, concentric, pause shortened]`,
  default `[2, 0.2, 1, 0.5]`. Loops start mid shortened-end pause.

## Shared vocabulary

| key | values | meaning |
|---|---|---|
| implement | barbell, dumbbell, ez_bar, cable, machine, smith, bodyweight | what is moved; each template accepts a subset |
| machine | leg_press, leg_extension, leg_curl_seated, leg_curl_lying, lat_pulldown, chest_press_machine, shoulder_press_machine, pec_deck, hip_abduction, hip_adduction, back_extension, assisted_pullup, calf_machine, seated_calf | equipment ids from `data/equipment.json`; when `implement: machine` omits it, the template's usual machine is filled in |
| grip | pronated, supinated, neutral, mixed | at the start position with arms hanging: pronated = palms back, neutral = palms in, supinated = palms forward. EZ bar "semi-supinated" is `supinated` + `implement: ez_bar` |
| gripWidth | 0.5..2.6 | see conventions |
| benchAngle | -30..90 | see conventions |
| cableHeight | low, mid, high | pulley: low = floor/ankle, mid = working height of the movement (elbow, chest or shoulder), high = above the head |
| attachment | rope, straight_bar, ez_bar, v_bar, single_handle, long_bar, ankle_strap | cable attachment |
| posture | standing, seated, lying_prone, lying_supine, kneeling, hanging, side_lying | body support. Incline bench curls: `seated` or `lying_prone` + `benchAngle` |
| stance | narrow, hip, shoulder, wide, split, single_leg | foot placement; narrow = 0.8x hip width, hip, shoulder = shoulderWidth, wide = 1.4x shoulderWidth (midfoot centres) |
| hold | hands, sides, goblet, front_rack, back_high, back_low, front_of_thighs, overhead, chest, opposite_hand, two_hand | where the load sits (replaces barPosition) |
| depth | quarter, parallel, full | squat depth: knee flexion 60 / 100 / 118 at the bottom |
| support | none, bench, chest_pad, wall, upright, thigh, elbow_pads, floor | what the body leans on besides the feet |
| toeOut | 0..45 | foot turn-out per foot |
| elbowFlare | 0..90 | upper-arm abduction from the torso (bottom of presses, finish of rows) |
| shoulderFlexion | -60..180 | upper-arm angle relative to the torso in the sagittal plane |

## Legacy to canonical (applied once, 2026-09-27)

- `stance: standing|seated`, `seated: true`, `prone: true` become `posture`; `stance: parallel` becomes `hip`.
- `handle` becomes `attachment` (`v-bar` to `v_bar`, `long-bar` to `long_bar`, `single` to `single_handle`).
- `gripWidth: close|shoulder|medium|wide` becomes 0.8 / 1.0 / template default / 1.8; `handWidth` becomes `gripWidth`.
- `barPosition: high_back|low_back|front_rack` becomes `hold: back_high|back_low|front_rack`; `hold: two_hand_overhead` becomes `two_hand`.
- `cableHeight: elbow|chest|shoulder` becomes `mid`; `implement: none` becomes `bodyweight`.
- `kneeBend: soft` becomes `kneeAngle: 20`; `shinAngle: vertical` becomes `kneeAngle: 90`; `kneeFlexion` becomes `kneeAngle`; `hipFlexionTop` becomes `topHipAngle`.
- `torsoAngle` values measured from horizontal (records 104, 210, 305, 306, 307, 312, 315) become `90 - value`.
- Dropped (implied by template or equipment): `armPath` (front-raise `y` becomes `plane: 45, topElevation: 160`), `facing`, `feet`, `anchor`, `kneePad`, hip-thrust `benchHeight`.
- Template specifics: assisted pull-up becomes `implement: machine, machine: assisted_pullup, posture: kneeling`; cable pulldowns get `posture: seated`; chest-supported row becomes `support: chest_pad, posture: lying_prone, benchAngle`; step-up becomes `direction: step_up` with `platformHeight`; Nordic curl becomes `posture: kneeling`; hold's `hold` becomes `kind`.

## Templates

### horizontal-press

Driver: implement.

| key | values | default |
|---|---|---|
| implement | barbell, dumbbell, machine, smith | barbell |
| machine | chest_press_machine | (optional) |
| posture | lying_supine, seated | lying_supine |
| benchAngle | -30..15 | 0 |
| grip | pronated, neutral | pronated |
| gripWidth | 0.5..2.6 | 1.4 |
| elbowFlare | 0..90 | 55 |

### incline-press

Driver: implement.

| key | values | default |
|---|---|---|
| implement | barbell, dumbbell, machine, smith | barbell |
| machine | chest_press_machine | (optional) |
| posture | lying_supine, seated | lying_supine |
| benchAngle | 10..60 | 30 |
| grip | pronated, neutral | pronated |
| gripWidth | 0.5..2.6 | 1.4 |
| elbowFlare | 0..90 | 55 |

### vertical-press

Driver: implement.

| key | values | default |
|---|---|---|
| implement | barbell, dumbbell, machine, smith | barbell |
| machine | shoulder_press_machine | (optional) |
| posture | standing, seated | standing |
| benchAngle | -30..90 | 90 |
| grip | pronated, neutral | pronated |
| gripWidth | 0.5..2.6 | 1.1 |

### dip

Driver: root.

| key | values | default |
|---|---|---|
| implement | bodyweight, machine | bodyweight |
| torsoAngle | 0..60 | 20 |
| grip | neutral, pronated | neutral |
| kneeAngle | 0..120 | 70 |

### push-up

Driver: root.

| key | values | default |
|---|---|---|
| implement | bodyweight | bodyweight |
| elevation | floor, hands, feet | floor |
| plus | boolean | false |
| gripWidth | 0.5..2.6 | 1.2 |
| kneeling | boolean | false |

### fly

Driver: joint.

| key | values | default |
|---|---|---|
| implement | dumbbell, cable, machine | dumbbell |
| machine | pec_deck | (optional) |
| posture | lying_supine, standing, seated | lying_supine |
| benchAngle | -30..90 | 0 |
| cableHeight | low, mid, high | mid |
| stance | hip, split | hip |
| grip | neutral, pronated | neutral |
| elbowAngle | 0..60 | 20 |

### lateral-raise

Driver: joint. **sample() implemented.**

| key | values | default |
|---|---|---|
| implement | dumbbell, cable, machine | dumbbell |
| posture | standing, seated | standing |
| cableHeight | low, mid, high | low |
| grip | neutral, pronated | neutral |
| plane | -10..60 | 20 |
| topElevation | 60..120 | 85 |
| elbowAngle | 0..45 | 15 |
| leanAngle | 0..40 | 0 |
| support | none, upright, bench | none |

### front-raise

Driver: joint.

| key | values | default |
|---|---|---|
| implement | dumbbell, cable, barbell | dumbbell |
| posture | standing, seated, lying_prone | standing |
| benchAngle | -30..90 | 45 |
| grip | pronated, neutral | pronated |
| plane | 20..100 | 90 |
| topElevation | 60..180 | 90 |
| elbowAngle | 0..45 | 10 |

### rear-raise

Driver: joint.

| key | values | default |
|---|---|---|
| implement | dumbbell, cable, machine | dumbbell |
| machine | pec_deck | (optional) |
| posture | standing, seated, lying_prone | standing |
| torsoAngle | 0..90 | 75 |
| benchAngle | -30..90 | (optional) |
| grip | neutral, pronated | neutral |
| cableHeight | low, mid, high | mid |
| crossed | boolean | false |
| elbowAngle | 0..45 | 15 |

### external-rotation

Driver: joint.

| key | values | default |
|---|---|---|
| implement | cable, dumbbell | cable |
| posture | standing, side_lying | standing |
| armPosition | side, abducted | side |
| cableHeight | low, mid, high | mid |
| support | none, bench | none |

### row

Driver: implement.

| key | values | default |
|---|---|---|
| implement | barbell, dumbbell, cable, machine, bodyweight, smith | barbell |
| posture | standing, seated, lying_prone, lying_supine, kneeling | standing |
| support | none, bench, chest_pad | none |
| torsoAngle | 0..90 | 45 |
| benchAngle | -30..90 | (optional) |
| grip | pronated, supinated, neutral, mixed | pronated |
| gripWidth | 0.5..2.6 | 1.3 |
| attachment | rope, straight_bar, ez_bar, v_bar, single_handle, long_bar, ankle_strap | (optional) |
| cableHeight | low, mid, high | mid |
| elbowFlare | 0..90 | 30 |
| finish | none, external_rotation | none |
| barHeight | low, mid, high | mid |
| stance | hip, shoulder, split | hip |

### vertical-pull

Driver: root. **sample() implemented.**

| key | values | default |
|---|---|---|
| implement | bodyweight, cable, machine | bodyweight |
| machine | lat_pulldown, assisted_pullup | (optional) |
| posture | hanging, seated, kneeling | hanging |
| grip | pronated, supinated, neutral | pronated |
| gripWidth | 0.5..2.6 | 1.5 |
| attachment | long_bar, v_bar, straight_bar, single_handle | (optional) |
| legs | straight, bent, crossed | bent |

### shrug

Driver: joint.

| key | values | default |
|---|---|---|
| implement | barbell, dumbbell, cable, smith, machine | dumbbell |
| posture | standing, seated | standing |
| grip | pronated, neutral, mixed | neutral |
| gripWidth | 0.5..2.6 | 1.1 |

### squat

Driver: implement. **sample() implemented.**

| key | values | default |
|---|---|---|
| implement | barbell, dumbbell, smith, machine, bodyweight | barbell |
| machine | leg_press | (optional) |
| hold | back_high, back_low, front_rack, goblet, sides, hands | back_high |
| posture | standing, seated, lying_supine | standing |
| stance | narrow, hip, shoulder, wide | shoulder |
| toeOut | 0..45 | 15 |
| depth | quarter, parallel, full | full |
| gripWidth | 0.5..2.6 | 2.1 |
| sledAngle | 0..90 | 45 |
| footPosition | low, mid, high, forward | mid |
| armPosition | forward, crossed, hips | forward |

### lunge

Driver: root.

| key | values | default |
|---|---|---|
| implement | dumbbell, barbell, bodyweight, smith | dumbbell |
| hold | sides, goblet, back_high, front_rack, hands | sides |
| direction | forward, reverse, in_place, step_up | reverse |
| rearFootElevated | boolean | false |
| travel | boolean | false |
| platformHeight | low, mid, knee | knee |
| stepLength | 0.5..1.6 | 1 |
| torsoAngle | 0..45 | 10 |

### leg-extension

Driver: joint.

| key | values | default |
|---|---|---|
| implement | machine, cable | machine |
| machine | leg_extension | leg_extension |
| posture | seated | seated |
| hipAngle | 0..120 | 90 |

### hinge

Driver: implement.

| key | values | default |
|---|---|---|
| implement | barbell, dumbbell, cable, bodyweight | barbell |
| hold | hands, front_of_thighs, opposite_hand, sides | hands |
| grip | pronated, supinated, neutral, mixed | pronated |
| gripWidth | 0.5..2.6 | 1.1 |
| stance | narrow, hip, shoulder, wide, single_leg | hip |
| toeOut | 0..45 | 10 |
| kneeAngle | 0..90 | 20 |
| start | hang, floor | hang |
| attachment | rope, single_handle, straight_bar | (optional) |
| cableHeight | low, mid, high | low |

### hip-thrust

Driver: root.

| key | values | default |
|---|---|---|
| implement | barbell, bodyweight, dumbbell, machine | barbell |
| support | bench, floor | bench |
| stance | narrow, hip, shoulder, wide | hip |
| kneeAngle | 45..120 | 90 |

### leg-curl

Driver: joint.

| key | values | default |
|---|---|---|
| implement | machine, bodyweight, dumbbell, cable | machine |
| machine | leg_curl_seated, leg_curl_lying | (optional) |
| posture | seated, lying_prone, kneeling, standing | seated |
| hipAngle | -10..120 | 90 |

### back-extension

Driver: root.

| key | values | default |
|---|---|---|
| implement | bodyweight, dumbbell, barbell | bodyweight |
| benchAngle | 0..45 | 45 |
| armPosition | crossed, behind_head, extended | crossed |
| spine | neutral, flexion | neutral |

### hip-abduction

Driver: joint.

| key | values | default |
|---|---|---|
| implement | machine, cable, bodyweight | machine |
| machine | hip_abduction, hip_adduction | (optional) |
| direction | abduction, adduction | abduction |
| posture | seated, standing, side_lying | seated |
| hipAngle | 0..110 | 90 |
| attachment | ankle_strap | (optional) |
| cableHeight | low, mid, high | low |

### calf-raise

Driver: root.

| key | values | default |
|---|---|---|
| implement | machine, dumbbell, bodyweight, smith, barbell | machine |
| machine | calf_machine, seated_calf, leg_press | (optional) |
| direction | plantarflexion, dorsiflexion | plantarflexion |
| posture | standing, seated | standing |
| kneeAngle | 0..110 | 0 |
| stance | hip, single_leg | hip |
| support | none, wall | none |
| platform | floor, step | step |

### curl

Driver: joint. **sample() implemented.**

| key | values | default |
|---|---|---|
| implement | dumbbell, barbell, ez_bar, cable | dumbbell |
| grip | supinated, neutral, pronated | supinated |
| supinate | boolean | false |
| gripWidth | 0.5..2.6 | 1 |
| posture | standing, seated, lying_prone | standing |
| benchAngle | -30..90 | (optional) |
| shoulderFlexion | -60..100 | (optional) |
| attachment | rope, straight_bar, ez_bar, single_handle | (optional) |
| cableHeight | low, mid, high | low |

### triceps-extension

Driver: joint.

| key | values | default |
|---|---|---|
| implement | cable, dumbbell, ez_bar, barbell | cable |
| attachment | rope, straight_bar, v_bar, single_handle, ez_bar | (optional) |
| cableHeight | low, mid, high | high |
| grip | neutral, pronated, supinated | neutral |
| gripWidth | 0.5..2.6 | 0.8 |
| posture | standing, seated, lying_supine | standing |
| benchAngle | -30..90 | (optional) |
| torsoAngle | 0..90 | 10 |
| stance | hip, split | hip |
| shoulderFlexion | -60..180 | 0 |
| hold | hands, two_hand | hands |
| support | none, bench | none |

### wrist-curl

Driver: joint.

| key | values | default |
|---|---|---|
| implement | dumbbell, barbell, cable | dumbbell |
| grip | supinated, pronated | supinated |
| posture | kneeling, seated | kneeling |
| support | bench, thigh | bench |

### crunch

Driver: joint.

| key | values | default |
|---|---|---|
| implement | bodyweight, cable, machine | bodyweight |
| attachment | rope | (optional) |
| cableHeight | low, mid, high | high |
| posture | kneeling, lying_supine | lying_supine |
| kneeAngle | 0..130 | 90 |

### leg-raise

Driver: joint.

| key | values | default |
|---|---|---|
| implement | bodyweight | bodyweight |
| posture | hanging, lying_supine | hanging |
| support | none, elbow_pads | none |
| kneeAngle | 0..120 | 0 |
| topHipAngle | 45..130 | 100 |

### hold

Driver: root.

| key | values | default |
|---|---|---|
| kind | front_plank, side_plank, pallof_press | front_plank |
| implement | bodyweight, cable | bodyweight |
| support | forearm, hand | forearm |
| legs | stacked, staggered | stacked |
| attachment | single_handle | (optional) |
| cableHeight | low, mid, high | mid |
| stance | hip, shoulder, split | hip |
| pressOut | boolean | false |

### rotation

Driver: joint.

| key | values | default |
|---|---|---|
| implement | cable, bodyweight, dumbbell | cable |
| attachment | single_handle, rope | (optional) |
| cableHeight | low, mid, high | high |
| direction | high_to_low, low_to_high, horizontal | high_to_low |
| stance | hip, shoulder, wide, split | wide |
| posture | standing, kneeling | standing |
