# Figure body build

`node pipeline/body/build-body.ts` runs Blender 5.2.2 headless with MPFB2 2.0.17 (pinned in `licenses/mpfb2/PIN.md`), then post-processes with gltf-transform. About 10 s. `node pipeline/body/uv-check.ts [glb] [--out dir]` verifies the UVs and writes layout images.

## Output

`public/models/body.glb` (`BODY_URL`), stylized head (bundled nose/mouth/ear targets, then smoothed with the lips kept), budget 700 KB (currently about 600 KB). The build fails over budget and removes the old `body-a.glb` / `body-b.glb`.

It holds four skinned meshes on one skin (76 bones, `_L`/`_R` names). Materials are placeholders and are matched by name at runtime (`src/features/figure/material.ts`):

| Node / material | Source |
|---|---|
| `body` / `skin` | MakeHuman base mesh, one Catmull-Clark level except hands, feet, ears and skin fully under the shorts, then simplified (below) |
| `hair` / `hair` | our own short crop: the body's scalp faces inside a procedural hairline, subdivided once, offset 1-11 mm (volume on top, tapered sides and nape, combed clumps) |
| `shorts` / `shorts` | cut from the bundled CC0 `helper-tights` proxy, loosened towards the hem, skinned from the body (weights diffused between the legs) |
| `eyes` / `eyes` | the bundled eyeball helpers, front halves only |

## Size

After the Blender export, `build-body.ts` simplifies the body with meshopt (`simplifyWithAttributes`, error under 1 mm): collapses must keep position, normal, UV, per-bone-group skin weight shares and corrective delta magnitudes near linear, UV seams and borders stay, and the face, hands and feet are locked (no relief texture there). Relief lives in the atlas textures, so the subdivision surface does not need its full density. Corrective deltas under 0.3 mm are zeroed, all-zero targets are dropped per mesh, and unused UVs (hair, shorts) are removed. Then quantization (14-bit positions and UVs, 8-bit normals) and meshopt compression.

## UVs (TEXCOORD_0, 14-bit)

- **body**: the MakeHuman default atlas (body, head, hands, feet, ears and scalp islands), carried through the subdivision with boundary-preserving UV smoothing. Non-overlapping, 62% coverage, 0 flipped triangles (`uv-check.ts` at 1024 px). Bake body textures into this layout.
- **eyes**: planar per eyeball, pupil at (0.5, 0.5), eyeball radius 0.5, gaze 4 degrees above straight ahead. The shader draws iris and pupil from it.
- hair and shorts carry none (their shaders do not sample textures).

## COLOR_0 (baked data, not albedo)

- `r`: ambient occlusion (body occluded by itself, hair and eyes; shorts by themselves and the body).
- `g`: on the skin, hair tint (brows, stubble shade below the hairline, longer where the sides taper); on the hair shell, its edge fade (1 at the edge; crisp at the front hairline, a long gradient on the sides and nape).
- `b`: DQS amount per vertex. **Skinning reads it** (`dqs.ts`): linear blend around the shoulders and upper torso, where dual quaternions balloon the lats on raised arms, full DQS at hips, knees, elbows and wrists. Keep this channel if COLOR_0 is repacked.

## Corrective morphs

Generated in code (`correctives.py`), no hand sculpting: pose the rig, skin exactly like the runtime (`skinning.py` mirrors `dqs.ts`), relax the joint region with delta mush (plus a pull towards the joint for lowered arms), map back to rest space through each vertex's inverse skin transform. Morph normals are the relaxed posed normals rotated back to rest space. The shorts follow the body and are pushed out of the corrected body at each key pose (each side's key keeps its half). In hip keys the fabric right between the legs skips the body's delta, which crumples it when seated, and is only pushed out, with 4 mm extra clearance around the crotch so the inner thighs stay covered in seated stances other than the key's.

Raised-arm keys also re-skin the armpit with sharpened arm/torso weights (inner upper arm on the arm, side wall on the ribcage, so the lat reads as a band instead of a sail) and push soft blobs along the normal: the deltoid bunches into a rounded cap, the stretched lat and front of the armpit thin out overhead.

| Target (`_L`, `_R`) | Driver | On from, full at, off again at (deg) |
|---|---|---|
| `cor_shoulder_side` | shoulder elevation, arm raised to the side | 20, 93, 163 |
| `cor_shoulder_up` | shoulder elevation, arm raised to the side, overhead | 93, 163 |
| `cor_shoulder_flex` | shoulder elevation, arm raised forward | 20, 107, 156 |
| `cor_shoulder_fwd` | shoulder elevation, arm raised forward, overhead | 107, 156 |
| `cor_shoulder_down` | shoulder elevation, arm lowered below rest | 34, 19 |
| `cor_hip` | hip flexion in the pelvis's sagittal plane | 40, 85 |
| `cor_knee` | knee flexion | 75, 146 |

Weights are `smoothstep(start, end, angle)`, times `1 - smoothstep(end, fade, angle)` for keys with a `fade` (each plane's 90 degree and overhead keys sum to one), with the side and front keys cross-faded by the plane of elevation. The table is written to the `body` node's extras (`correctives`) and read by `src/features/figure/correctives.ts`, which updates the morphs every frame and on `setPose`. Angles use only bone positions and long axes, so Blender and three.js agree (checked: identical weights on all stress poses).
