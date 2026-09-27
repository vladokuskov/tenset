MPFB2 pin for public/models/body-a.glb and public/models/body-b.glb

- Project: https://github.com/makehumancommunity/mpfb2
- Tag: v2.0.17 (released 2026-07-22)
- Commit: 80919fa4682335c41847f761a4d79dcad4124732
- Source tarball: https://codeload.github.com/makehumancommunity/mpfb2/tar.gz/80919fa4682335c41847f761a4d79dcad4124732
- Tarball sha256: ab42cbf9827abe58a26c051ec001bdad71642673441ae8cbdc457d7036ad2740
- Retrieved: 2026-09-26
- Tool: Blender 5.2.2 LTS (build tool only, headless)

Assets used (all bundled with MPFB2 at this commit, CC0 1.0 per LICENSE.md section C):
- src/mpfb/data/3dobjs/base.obj: the base mesh, its UV layout, and two of its built-in proxy helpers: `helper-tights` (cut into the shorts) and `helper-l-eye` / `helper-r-eye` (eyeballs)
- src/mpfb/data/targets/macrodetails/** (gender, age, muscle, weight, height, proportions)
- src/mpfb/data/targets/{torso,stomach,pelvis,neck,arms,legs}/: athletic definition (vshape, pectoral, dorsi, stomach tone, bulge-decr, neck width, upper/lower arm and leg muscle and fat)
- src/mpfb/data/targets/expression/units/caucasian/eye-{left,right}-closure (relaxed lids, both heads)
- stylized head only: src/mpfb/data/targets/{nose,mouth,chin,eyes,ears,cheek}/ (smaller nose and nostrils, thinner lips, flatter ears, no eye bags)
- src/mpfb/data/rigs/standard/rig.default_no_toes.json and weights.default.json (rig and skin weights)
- src/mpfb/data/mesh_metadata/basemesh_vertex_groups.json (helper, ears, lips and nipple groups)

Not bundled at this commit, therefore not used: hair, eyebrow, eyelash and clothes proxies (the only MHCLO under the tree is a test fixture in test/testdata, which we do not use). The hair is our own shell generated from the scalp; eyebrows are a baked vertex tint.

No makehumancommunity.org asset packs or community assets are used.
MPFB2 code (GPLv3) runs only as a build tool inside Blender and is not copied or ported.
Everything after create_human/add_builtin_rig in pipeline/body/ is our own code: helper extraction, partial subdivision, face stylization, hair and shorts generation, weight processing, DQS mix, AO bake, corrective morphs and export post-processing.
