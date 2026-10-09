# Catalog v2: the remaining 194 exercises

Approved by the owner (2026-10-03). Growing the catalog from 106 to 300 (decision in `docs/PLAN.md`, "Catalog v2"). Nothing below exists as a record yet. Once you approve, Phase 2 writes the records as cards (`media.status: "card"`, `media.template: null`). Ids are permanent once merged, so this is the moment to cut, rename or swap.

## How to read it

- **Template** is the planned motion template. It goes in the backlog `plannedTemplate` column and has no effect until the motion waves.
- **Tier** says how much motion work an exercise needs:
  - **A:** an existing template, and its param schema already covers this exercise. Phase 3a confirms the template code implements it, since some param combinations still throw "variant not implemented yet" and would drop to B.
  - **B:** an existing template that needs new params, a new implement (band, kettlebell, plate) or a new hold kind.
  - **C:** needs a new prop (rings, landmine, trap bar, T-bar, hack, pendulum and belt squat, GHD, preacher bench, ab wheel), a pose the template cannot reach yet, or one of 5 new templates.
- Totals: A 65, B 75, C 54.
- Wave 3a (2026-10-08) animated 48 of the 65 A rows. The other 17 (116, 117, 122, 135, 233, 319, 421, 732, 735, 737, 739, 740, 745, 748, 826, 827, 831) move to 3b/3c; reasons are in `docs/PLAN.md` "Wave 3a".
- Wave 3b (2026-10-09) animated 75 of 79 (the B tier plus 135, 421, 732 and 827). Deferred: 318, 532, 535 and 730 (PLAN.md "Wave 3b"). The other 3a leftovers wait for 3c.

## New templates (tier C)

| template | exercises |
|---|---|
| rollout | 810 Ab Wheel Rollout, 811 Kneeling Ab Wheel Rollout, 812 Ab Wheel Oblique Rollout |
| floor-core | 813 Dead Bug, 814 Bird Dog, 816 Mountain Climber, 820 Bicycle Crunch, 837 V-Up, 839 Dragon Flag, 842 Superman Hold |
| pullover | 325 Straight-Arm Cable Pulldown, 326 Dumbbell Pullover, 327 Band Straight-Arm Pulldown |
| swing | 518 Kettlebell Swing |
| hip-kickback | 528 Reverse Hyperextension, 534 Cable Glute Kickback |

`floor-core` is one template with kinds (dead bug, bird dog, mountain climber, bicycle, V-up, dragon flag, superman), not seven. Everything else extends one of the 29 existing templates.

## Split by family

| family | now | new | target | A | B | C |
|---|---|---|---|---|---|---|
| chest | 15 | 21 | 36 | 12 | 6 | 3 |
| shoulders | 15 | 21 | 36 | 7 | 11 | 3 |
| back | 15 | 27 | 42 | 9 | 8 | 10 |
| squat | 12 | 24 | 36 | 7 | 8 | 9 |
| hinge | 15 | 27 | 42 | 7 | 11 | 9 |
| calves | 6 | 6 | 12 | 3 | 2 | 1 |
| arms | 19 | 35 | 54 | 16 | 14 | 5 |
| core | 9 | 33 | 42 | 4 | 15 | 14 |
| **total** | 106 | 194 | 300 | 65 | 75 | 54 |

## Checks the list was built against

- No id, slug or name clashes with the 106 existing records. Every equipment id is in `data/equipment.json`, and every pattern is in the schema enum.
- Every new equipment id has at least 3 exercises, except pendulum squat and belt squat (1 each). Those are single-purpose machines, and padding them with filler variants would not help anyone.
- Band exercises close the bodyweight gaps. Gaps are now computed from the catalog (`src/app/knownGaps.ts`), and `data/known-gaps.json` is gone:
  - side delt: 225 Band Lateral Raise
  - rear delt: 228 Band Pull-Apart
  - upper traps: 341 Band Shrug
  - forearms: 750 Band Wrist Extension
- Still out of scope: Olympic lifts, kettlebell flows, kipping, carries. 824 Suitcase Hold is a static hold, not a carry.
- Some rows are cheap variants on purpose, as v1 had (single-leg, single-arm, grip changes), because people program them as separate exercises: 132, 330, 429, 435, 539, 734, 737.

## Things worth a second look

- **No lateral-flexion pattern.** Side bends are left out for that reason.
- **227 Cable Upright Row** is planned on the `shrug` template, but it really needs its own arm path. It might be cheaper to drop it.
- **The C tier is the long pole:** 54 exercises, and about 15 of them need props. Some can stay as cards long term, with the full mapping and cues but no loop, if the motion work does not pay off.

## Chest (21)

| id | name | equipment | pattern | template | tier |
|---|---|---|---|---|---|
| 116 | Decline Barbell Bench Press | barbell, adjustable_bench, rack | horizontal_push | horizontal-press | A |
| 117 | Decline Dumbbell Press | dumbbell, adjustable_bench | horizontal_push | horizontal-press | A |
| 118 | Dumbbell Floor Press | dumbbell | horizontal_push | horizontal-press | B |
| 119 | Kettlebell Floor Press | kettlebell | horizontal_push | horizontal-press | B |
| 120 | Smith Machine Bench Press | smith, flat_bench | horizontal_push | horizontal-press | A |
| 121 | Neutral-Grip Dumbbell Press | dumbbell, flat_bench | horizontal_push | horizontal-press | A |
| 122 | Incline Machine Chest Press | chest_press_machine | incline_push | incline-press | A |
| 123 | Low-Incline Dumbbell Press | dumbbell, adjustable_bench | incline_push | incline-press | A |
| 124 | Standing Cable Chest Press | cable | horizontal_push | horizontal-press | B |
| 125 | Band Push-Up | band | horizontal_push | push-up | B |
| 126 | Ring Push-Up | rings | horizontal_push | push-up | C |
| 127 | Ring Dip | rings | dip | dip | C |
| 128 | Band Chest Press | band | horizontal_push | horizontal-press | B |
| 129 | Mid-Cable Fly | cable | shoulder_horizontal_adduction | fly | A |
| 130 | Incline Dumbbell Fly | dumbbell, adjustable_bench | shoulder_horizontal_adduction | fly | A |
| 131 | Seated Cable Fly | cable, adjustable_bench | shoulder_horizontal_adduction | fly | A |
| 132 | Single-Arm Cable Fly | cable | shoulder_horizontal_adduction | fly | A |
| 133 | Band Fly | band | shoulder_horizontal_adduction | fly | B |
| 134 | Kneeling Push-Up | none | horizontal_push | push-up | A |
| 135 | Dumbbell Squeeze Press | dumbbell, flat_bench | horizontal_push | horizontal-press | A |
| 136 | Landmine Chest Press | landmine, barbell | incline_push | incline-press | C |

## Shoulders (21)

| id | name | equipment | pattern | template | tier |
|---|---|---|---|---|---|
| 216 | Arnold Press | dumbbell, adjustable_bench | vertical_push | vertical-press | B |
| 217 | Standing Dumbbell Shoulder Press | dumbbell | vertical_push | vertical-press | A |
| 218 | Half-Kneeling Landmine Press | landmine, barbell | vertical_push | vertical-press | C |
| 219 | Standing Landmine Press | landmine, barbell | vertical_push | vertical-press | C |
| 220 | Kettlebell Overhead Press | kettlebell | vertical_push | vertical-press | B |
| 221 | Seated Barbell Overhead Press | barbell, adjustable_bench, rack | vertical_push | vertical-press | A |
| 222 | Band Overhead Press | band | vertical_push | vertical-press | B |
| 223 | Pike Push-Up | none | vertical_push | push-up | B |
| 224 | Seated Dumbbell Lateral Raise | dumbbell, flat_bench | shoulder_abduction | lateral-raise | A |
| 225 | Band Lateral Raise | band | shoulder_abduction | lateral-raise | B |
| 226 | Cable Y-Raise | cable | shoulder_abduction | lateral-raise | B |
| 227 | Cable Upright Row | cable | shoulder_abduction | shrug | C |
| 228 | Band Pull-Apart | band | shoulder_horizontal_abduction | rear-raise | B |
| 229 | Band Face Pull | band | shoulder_horizontal_abduction | row | B |
| 230 | Incline Prone Rear Delt Raise | dumbbell, adjustable_bench | shoulder_horizontal_abduction | rear-raise | A |
| 231 | Prone T-Raise | dumbbell, adjustable_bench | shoulder_horizontal_abduction | rear-raise | A |
| 232 | Band External Rotation | band | shoulder_external_rotation | external-rotation | B |
| 233 | Cable Front Raise | cable | shoulder_flexion | front-raise | A |
| 234 | Plate Front Raise | plate | shoulder_flexion | front-raise | B |
| 235 | Dumbbell Z Press | dumbbell | vertical_push | vertical-press | B |
| 236 | Dumbbell Scaption Raise | dumbbell | shoulder_flexion | front-raise | A |

## Back (27)

| id | name | equipment | pattern | template | tier |
|---|---|---|---|---|---|
| 316 | T-Bar Row | t_bar | horizontal_pull | row | C |
| 317 | Landmine Meadows Row | landmine, barbell | horizontal_pull | row | C |
| 318 | Pendlay Row | barbell | horizontal_pull | row | B |
| 319 | Seal Row | barbell, flat_bench | horizontal_pull | row | A |
| 320 | Underhand Barbell Row | barbell | horizontal_pull | row | A |
| 321 | Kettlebell Row | kettlebell, flat_bench | horizontal_pull | row | B |
| 322 | Ring Row | rings | horizontal_pull | row | C |
| 323 | Band Seated Row | band | horizontal_pull | row | B |
| 324 | Smith Machine Row | smith | horizontal_pull | row | A |
| 325 | Straight-Arm Cable Pulldown | cable | shoulder_extension | pullover | C |
| 326 | Dumbbell Pullover | dumbbell, flat_bench | shoulder_extension | pullover | C |
| 327 | Band Straight-Arm Pulldown | band | shoulder_extension | pullover | C |
| 328 | Wide-Grip Pull-Up | pullup_bar | vertical_pull | vertical-pull | A |
| 329 | Underhand Lat Pulldown | lat_pulldown | vertical_pull | vertical-pull | A |
| 330 | Single-Arm Cable Pulldown | cable | vertical_pull | vertical-pull | A |
| 331 | Neutral-Grip Lat Pulldown | lat_pulldown | vertical_pull | vertical-pull | A |
| 332 | Band Lat Pulldown | band | vertical_pull | vertical-pull | B |
| 333 | Ring Pull-Up | rings | vertical_pull | vertical-pull | C |
| 334 | Band-Assisted Pull-Up | pullup_bar, band | vertical_pull | vertical-pull | B |
| 335 | Trap-Bar Shrug | trap_bar | scapular_elevation | shrug | B |
| 336 | Cable Shrug | cable | scapular_elevation | shrug | A |
| 337 | Smith Machine Shrug | smith | scapular_elevation | shrug | A |
| 338 | Chest-Supported T-Bar Row | t_bar | horizontal_pull | row | C |
| 339 | Wide-Grip Chest-Supported T-Bar Row | t_bar | horizontal_pull | row | C |
| 340 | Renegade Row | dumbbell | horizontal_pull | row | C |
| 341 | Band Shrug | band | scapular_elevation | shrug | B |
| 342 | Scapular Pull-Up | pullup_bar | vertical_pull | vertical-pull | B |

## Squat (24)

| id | name | equipment | pattern | template | tier |
|---|---|---|---|---|---|
| 413 | Hack Squat | hack_squat | squat | squat | C |
| 414 | Pendulum Squat | pendulum_squat | squat | squat | C |
| 415 | Belt Squat | belt_squat | squat | squat | C |
| 416 | Reverse Hack Squat | hack_squat | squat | squat | C |
| 417 | Kettlebell Goblet Squat | kettlebell | squat | squat | B |
| 418 | Double Kettlebell Front Squat | kettlebell | squat | squat | B |
| 419 | Landmine Squat | landmine, barbell | squat | squat | C |
| 420 | Heel-Elevated Goblet Squat | dumbbell, plate | squat | squat | B |
| 421 | Dumbbell Sumo Squat | dumbbell | squat | squat | A |
| 422 | Box Squat | barbell, rack, step | squat | squat | B |
| 423 | Smith Machine Split Squat | smith | lunge | lunge | A |
| 424 | Barbell Reverse Lunge | barbell, rack | lunge | lunge | A |
| 425 | Dumbbell Forward Lunge | dumbbell | lunge | lunge | A |
| 426 | Dumbbell Lateral Lunge | dumbbell | lunge | lunge | B |
| 427 | Cossack Squat | none | lunge | lunge | C |
| 428 | Sissy Squat | none | knee_extension | squat | C |
| 429 | Single-Leg Leg Press | leg_press | squat | squat | A |
| 430 | Bodyweight Split Squat | none | lunge | lunge | A |
| 431 | Kettlebell Goblet Reverse Lunge | kettlebell | lunge | lunge | B |
| 432 | Box Pistol Squat | step | squat | squat | C |
| 433 | Dumbbell Curtsy Lunge | dumbbell | lunge | lunge | B |
| 434 | Front-Foot-Elevated Split Squat | dumbbell, step | lunge | lunge | B |
| 435 | Single-Leg Leg Extension | leg_extension | knee_extension | leg-extension | A |
| 436 | Band Spanish Squat | band | squat | squat | C |

## Hinge (27)

| id | name | equipment | pattern | template | tier |
|---|---|---|---|---|---|
| 516 | Trap-Bar Deadlift | trap_bar | hinge | hinge | C |
| 517 | Trap-Bar Romanian Deadlift | trap_bar | hinge | hinge | C |
| 518 | Kettlebell Swing | kettlebell | hinge | swing | C |
| 519 | Kettlebell Romanian Deadlift | kettlebell | hinge | hinge | B |
| 520 | Kettlebell Sumo Deadlift | kettlebell | hinge | hinge | B |
| 521 | Sumo Deadlift | barbell | hinge | hinge | A |
| 522 | Good Morning | barbell, rack | hinge | hinge | B |
| 523 | Rack Pull | barbell, rack | hinge | hinge | B |
| 524 | B-Stance Dumbbell Romanian Deadlift | dumbbell | hinge | hinge | B |
| 525 | Stiff-Leg Deadlift | barbell | hinge | hinge | A |
| 526 | Glute-Ham Raise | ghd | knee_flexion | leg-curl | C |
| 527 | GHD Back Extension | ghd | hip_extension | back-extension | C |
| 528 | Reverse Hyperextension | flat_bench | hip_extension | hip-kickback | C |
| 529 | Single-Leg Hip Thrust | flat_bench | hip_extension | hip-thrust | B |
| 530 | Dumbbell Hip Thrust | dumbbell, flat_bench | hip_extension | hip-thrust | A |
| 531 | Smith Machine Hip Thrust | smith, flat_bench | hip_extension | hip-thrust | B |
| 532 | Frog Pump | none | hip_extension | hip-thrust | B |
| 533 | Single-Leg Glute Bridge | none | hip_extension | hip-thrust | B |
| 534 | Cable Glute Kickback | cable | hip_extension | hip-kickback | C |
| 535 | Band Seated Hip Abduction | band | hip_abduction | hip-abduction | B |
| 536 | Side-Lying Hip Abduction | none | hip_abduction | hip-abduction | A |
| 537 | Band Lateral Walk | band | hip_abduction | hip-abduction | C |
| 538 | Copenhagen Plank | flat_bench | hip_adduction | hold | C |
| 539 | Single-Leg Lying Leg Curl | leg_curl_lying | knee_flexion | leg-curl | A |
| 540 | Standing Cable Leg Curl | cable | knee_flexion | leg-curl | A |
| 541 | Dumbbell Lying Leg Curl | dumbbell, flat_bench | knee_flexion | leg-curl | A |
| 542 | Kettlebell Single-Leg Romanian Deadlift | kettlebell | hinge | hinge | B |

## Calves (6)

| id | name | equipment | pattern | template | tier |
|---|---|---|---|---|---|
| 607 | Smith Machine Calf Raise | smith, step | plantarflexion | calf-raise | A |
| 608 | Hack Squat Calf Raise | hack_squat | plantarflexion | calf-raise | C |
| 609 | Donkey Calf Raise | step | plantarflexion | calf-raise | B |
| 610 | Seated Dumbbell Calf Raise | dumbbell, flat_bench | plantarflexion | calf-raise | A |
| 611 | Band Tibialis Raise | band | dorsiflexion | calf-raise | B |
| 612 | Barbell Standing Calf Raise | barbell, rack, step | plantarflexion | calf-raise | A |

## Arms (35)

| id | name | equipment | pattern | template | tier |
|---|---|---|---|---|---|
| 720 | EZ-Bar Preacher Curl | ez_bar, preacher_bench | elbow_flexion | curl | C |
| 721 | Dumbbell Preacher Curl | dumbbell, preacher_bench | elbow_flexion | curl | C |
| 722 | Bayesian Cable Curl | cable | elbow_flexion | curl | A |
| 723 | Barbell Drag Curl | barbell | elbow_flexion | curl | B |
| 724 | Concentration Curl | dumbbell, flat_bench | elbow_flexion | curl | B |
| 725 | Zottman Curl | dumbbell | elbow_flexion | curl | B |
| 726 | Cross-Body Hammer Curl | dumbbell | elbow_flexion | curl | B |
| 727 | Band Curl | band | elbow_flexion | curl | B |
| 728 | EZ-Bar Reverse Preacher Curl | ez_bar, preacher_bench | elbow_flexion | curl | C |
| 729 | High Cable Curl | cable | elbow_flexion | curl | B |
| 730 | Waiter Curl | dumbbell | elbow_flexion | curl | B |
| 731 | JM Press | barbell, flat_bench, rack | elbow_extension | triceps-extension | C |
| 732 | Diamond Push-Up | none | elbow_extension | push-up | A |
| 733 | Bench Dip | flat_bench | elbow_extension | dip | B |
| 734 | Single-Arm Cable Pushdown | cable | elbow_extension | triceps-extension | A |
| 735 | V-Bar Pushdown | cable | elbow_extension | triceps-extension | A |
| 736 | Reverse-Grip Pushdown | cable | elbow_extension | triceps-extension | A |
| 737 | Single-Arm Overhead Cable Extension | cable | elbow_extension | triceps-extension | A |
| 738 | Dumbbell Skull Crusher | dumbbell, flat_bench | elbow_extension | triceps-extension | A |
| 739 | Incline Dumbbell Skull Crusher | dumbbell, adjustable_bench | elbow_extension | triceps-extension | A |
| 740 | Cable Kickback | cable | elbow_extension | triceps-extension | A |
| 741 | Band Pushdown | band | elbow_extension | triceps-extension | B |
| 742 | Band Overhead Triceps Extension | band | elbow_extension | triceps-extension | B |
| 743 | Ring Triceps Extension | rings | elbow_extension | triceps-extension | C |
| 744 | Tate Press | dumbbell, flat_bench | elbow_extension | triceps-extension | B |
| 745 | Seated EZ-Bar Overhead Extension | ez_bar, adjustable_bench | elbow_extension | triceps-extension | A |
| 746 | Barbell Wrist Curl | barbell, flat_bench | wrist_flexion | wrist-curl | A |
| 747 | Barbell Reverse Wrist Curl | barbell, flat_bench | wrist_extension | wrist-curl | A |
| 748 | Cable Wrist Curl | cable | wrist_flexion | wrist-curl | A |
| 749 | Behind-the-Back Barbell Wrist Curl | barbell | wrist_flexion | wrist-curl | B |
| 750 | Band Wrist Extension | band | wrist_extension | wrist-curl | B |
| 751 | Reverse Cable Curl | cable | elbow_flexion | curl | A |
| 752 | Band Hammer Curl | band | elbow_flexion | curl | B |
| 753 | Close-Grip EZ-Bar Curl | ez_bar | elbow_flexion | curl | A |
| 754 | Wide-Grip Barbell Curl | barbell | elbow_flexion | curl | A |

## Core (33)

| id | name | equipment | pattern | template | tier |
|---|---|---|---|---|---|
| 810 | Ab Wheel Rollout | ab_wheel | anti_extension | rollout | C |
| 811 | Kneeling Ab Wheel Rollout | ab_wheel | anti_extension | rollout | C |
| 812 | Ab Wheel Oblique Rollout | ab_wheel | anti_rotation | rollout | C |
| 813 | Dead Bug | none | anti_extension | floor-core | C |
| 814 | Bird Dog | none | anti_rotation | floor-core | C |
| 815 | Hollow Body Hold | none | anti_extension | hold | B |
| 816 | Mountain Climber | none | hip_flexion | floor-core | C |
| 817 | GHD Sit-Up | ghd | spinal_flexion | crunch | C |
| 818 | Decline Sit-Up | adjustable_bench | spinal_flexion | crunch | B |
| 819 | Reverse Crunch | none | spinal_flexion | leg-raise | B |
| 820 | Bicycle Crunch | none | rotation | floor-core | C |
| 821 | Russian Twist | plate | rotation | rotation | B |
| 822 | Landmine Rotation | landmine, barbell | rotation | rotation | C |
| 823 | Band Pallof Press | band | anti_rotation | hold | B |
| 824 | Suitcase Hold | dumbbell | anti_lateral_flexion | hold | B |
| 825 | Hanging Oblique Knee Raise | pullup_bar | rotation | leg-raise | B |
| 826 | Captain's Chair Knee Raise | dip_station | hip_flexion | leg-raise | A |
| 827 | Toes-to-Bar | pullup_bar | hip_flexion | leg-raise | A |
| 828 | Plank Shoulder Tap | none | anti_rotation | hold | B |
| 829 | Long-Lever Plank | none | anti_extension | hold | B |
| 830 | Side Plank Hip Dip | none | anti_lateral_flexion | hold | B |
| 831 | Half-Kneeling Cable Chop | cable | rotation | rotation | A |
| 832 | Low-to-High Cable Lift | cable | rotation | rotation | A |
| 833 | Band Woodchop | band | rotation | rotation | B |
| 834 | Weighted Crunch | plate | spinal_flexion | crunch | B |
| 835 | L-Sit Hold | dip_station | hip_flexion | hold | C |
| 836 | Flutter Kick | none | hip_flexion | leg-raise | C |
| 837 | V-Up | none | spinal_flexion | floor-core | C |
| 838 | Sit-Up | none | spinal_flexion | crunch | B |
| 839 | Dragon Flag | flat_bench | anti_extension | floor-core | C |
| 840 | Standing Cable Crunch | cable | spinal_flexion | crunch | B |
| 841 | Bear Plank | none | anti_extension | hold | B |
| 842 | Superman Hold | none | spinal_extension | floor-core | C |
