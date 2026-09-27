# Figure body build

`node pipeline/body/build-body.ts` runs Blender 5.2.2 headless with MPFB2 2.0.17 (pinned in `licenses/mpfb2/PIN.md`) once per head variant, then post-processes with gltf-transform. About 30 s. `node pipeline/body/uv-check.ts [glb] [--out dir]` verifies the UVs and writes layout images.

## Outputs

| File | Head | Size budget |
|---|---|---|
| `public/models/body-a.glb` | realistic, calm (MakeHuman face, lids relaxed 18%) | <= 900 KB |
| `public/models/body-b.glb` | stylized (bundled nose/mouth/ear targets, then smoothed) | <= 900 KB |

Two GLBs, not one with two heads: each file is self-contained and the runtime picks one (`<Figure variant="a" | "b">`, `bodyUrl()`). `build-body.ts` asserts they are interchangeable: one skin with the same joints and inverse binds, and identical body UVs, joints and topology, hair and shorts. Only face vertex positions, eyes and AO differ.

Each GLB holds four skinned meshes on one skin (76 bones, `_L`/`_R` names). Materials are placeholders and are matched by name at runtime (`src/features/figure/material.ts`):

| Node / material | Source |
|---|---|
| `body` / `skin` | MakeHuman base mesh, one Catmull-Clark level except hands, feet, ears and skin fully under the shorts |
| `hair` / `hair` | our own shell, grown from the body's scalp faces inside a procedural hairline and offset 1-6 mm |
| `shorts` / `shorts` | cut from the bundled CC0 `helper-tights` proxy, loosened towards the hem, skinned from the body |
| `eyes` / `eyes` | the bundled eyeball helpers |

## UVs (TEXCOORD_0, 14-bit)

- **body**: the MakeHuman default atlas (body, head, hands, feet, ears and scalp islands), carried through the subdivision with boundary-preserving UV smoothing. Non-overlapping, 62% coverage, 0 flipped triangles (`uv-check.ts` at 1024 px). Bake body textures into this layout.
- **hair**: the body's scalp UVs for the same faces, so it shares that atlas region.
- **shorts**: the tights proxy UVs rescaled to fill the square; the inward hem strips are degenerate.
- **eyes**: planar per eyeball, pupil at (0.5, 0.5), eyeball radius 0.5. The shader draws iris and pupil from it.

## COLOR_0 (baked data, not albedo)

- `r`: ambient occlusion (body occluded by itself, hair and eyes; shorts by themselves and the body).
- `g`: hair tint on the skin (brows, fade below the hairline).
- `b`: DQS amount per vertex. **Skinning reads it** (`dqs.ts`): linear blend around the shoulders and upper torso, where dual quaternions balloon the lats on raised arms, full DQS at hips, knees, elbows and wrists. Keep this channel if COLOR_0 is repacked.

## Corrective morphs

Generated in code (`correctives.py`), no sculpting: pose the rig, skin exactly like the runtime (`skinning.py` mirrors `dqs.ts`), relax the joint region with delta mush (plus a pull towards the joint for lowered arms), map back to rest space through each vertex's inverse skin transform. Morph normals are the relaxed posed normals rotated back to rest space. The shorts follow the body and are pushed out of the corrected body at each key pose.

| Target (`_L`, `_R`) | Driver | On from, full at (deg) |
|---|---|---|
| `cor_shoulder_up` | shoulder elevation, arm raised to the side | 95, 163 |
| `cor_shoulder_fwd` | shoulder elevation, arm raised forward | 95, 156 |
| `cor_shoulder_down` | shoulder elevation, arm lowered below rest | 34, 19 |
| `cor_hip` | hip flexion in the pelvis's sagittal plane | 40, 85 |
| `cor_knee` | knee flexion | 75, 146 |

Weights are `smoothstep(start, end, angle)`, with the two raised-arm keys cross-faded by the plane of elevation. The table is written to the `body` node's extras (`correctives`) and read by `src/features/figure/correctives.ts`, which updates the morphs every frame and on `setPose`. Angles use only bone positions and long axes, so Blender and three.js agree (checked: identical weights on all stress poses).
