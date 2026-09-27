# Credits and licenses

## This project
Code: MIT. Data and media (exercise records, muscle mappings, cues, motion templates,
body.glb, posters, loops, body-map SVGs): CC BY 4.0, © 2026 Vladyslav Okuskov, except the
third-party material below. Exercise and equipment names are used descriptively; there is no
affiliation with or endorsement by any equipment maker, database or author named here.

## BodyParts3D (body map shapes)
BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International
- Source: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/ (Release 4.0,
  isa_BP3D_4.0_obj_99.zip, downloaded 2026-09-26,
  sha256 40665852c49f218326590e204db91064a1ecfc3c6f8cbd7bbbcaac62c7cd409e)
- License: https://creativecommons.org/licenses/by/4.0/ (licensor's license page updated
  2025-02-27; archived copy in licenses/bodyparts3d/)
- Changes: superficial muscles rendered orthographically front and back, traced to 2D
  outlines, simplified, merged or split into our region ids, and restyled. The latissimus
  dorsi and rectus abdominis outlines are our own (they are not in BodyParts3D).
- Files: public/anatomy/*.svg, public/anatomy/*.ids.bin
- The 2013 OBJ files still carry an older CC BY-SA 2.1 JP header; the licensor has since
  licensed the database under CC BY 4.0.
- No endorsement by DBCLS is implied.

## MakeHuman / MPFB2 (3D figure)
Base mesh, targets, rig and weights from MPFB2 (https://github.com/makehumancommunity/mpfb2,
tag v2.0.17, commit 80919fa4682335c41847f761a4d79dcad4124732), released under CC0 1.0 by the
MakeHuman Team. No attribution is required; credited with thanks. MPFB2 code (GPL-3.0) is a
build tool only and is not part of this app.

## Open-source software
Bundled libraries (React, three.js, React Three Fiber, drei, TanStack Router and Virtual,
Zustand, zod, MiniSearch, dnd-kit, Workbox, uqr and their dependencies) are under MIT, ISC,
BSD or Apache-2.0. Full notices: THIRD_PARTY_NOTICES.txt.
Build-only tools, not distributed: Blender, MPFB2, FFmpeg/x264, TypeScript, Vite, oxlint,
Vitest, Playwright. Their licenses do not cover the files they produce.

## Research
Muscle roles and volume bands cite published studies (shown per item in the app).
Facts and numbers only; no text or figures are reproduced.

## Contact
Missing or wrong credit, or a licensing concern: open an issue on the project repository.
We will fix or remove the material promptly.
