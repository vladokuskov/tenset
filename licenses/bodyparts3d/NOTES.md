# BodyParts3D license evidence

Used for: the head-level body map (`public/anatomy/front.svg`, `back.svg`, `front.groups.svg`, `back.groups.svg`, `front.ids.bin`, `back.ids.bin`), baked by `pipeline/anatomy/bake-map.ts`.

## Credit (verbatim, as the licensor asks)

BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International

- Source: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/ (data: https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/)
- License: CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ (legal code: https://creativecommons.org/licenses/by/4.0/legalcode.en)
- Licensor's license page: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html ("Last updated: 2025/02/27")
- Modifications: orthographic projection of selected muscle meshes, per-view visibility rules, clipping, merging into our own muscle regions, smoothing and tracing to 2D paths, plus two hand-drawn regions (latissimus dorsi, rectus abdominis) that BodyParts3D does not model. Every shipped SVG carries `<!--! BodyParts3D, © The Database Center for Life Science, CC BY 4.0, modified -->`.

## Saved pages (fetched 2026-09-26)

| File | From | sha256 |
|---|---|---|
| `lic.html` | https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html | `008bb75dd472492f36c20922349199afb1669d8da39d864ddc3a907715701f3a` |
| `README_e.html` | https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/README_e.html (dated 2025/02/27, section 3 "License") | `f9a90b4d945ad0fe50db45c712e931aa54e52667187b30d7085b6cc394f40107` |

Wayback captures:
- lic.html: http://web.archive.org/web/20260905143812/https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
- README_e.html: http://web.archive.org/web/20260823185401/https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/README_e.html
- LATEST directory listing: http://web.archive.org/web/20251216023207/https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/
- The zip itself: http://web.archive.org/web/20251024110942/https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_BP3D_4.0_obj_99.zip

## Data files (downloaded 2026-09-26, 17:52 UTC)

| File | Bytes | sha256 |
|---|---|---|
| `isa_BP3D_4.0_obj_99.zip` (Release 4.0, IS-A tree, 99% polygon reduction, 2234 OBJs) | 142903898 | `40665852c49f218326590e204db91064a1ecfc3c6f8cbd7bbbcaac62c7cd409e` |
| `isa_element_parts.txt` | 1142159 | `a3de74423f943b0d724ae8f59b3a817f87c423a544f8db98113b1980817cbeaf` |
| `isa_parts_list_e.txt` | 128086 | `ab7796deedd49205e77f3609a1cb8c53e2bbee14ecb5c9a6ca05227469780513` |

Provenance of the zip: DBCLS throttled to about 10 KB/s after the first 47,210,496 bytes, so the rest was fetched from the Wayback capture of the same URL (2025-10-24). Checks that the assembled file equals the DBCLS file: total length matches the DBCLS `Content-Length`; `unzip -t` passes CRCs for all 2234 entries; a 5 MB Wayback prefix matched the DBCLS bytes; three 64 KB ranges fetched fresh from DBCLS (at 80 MB, 120 MB and the final 64 KB, which holds the central directory with every entry's CRC) are byte-identical. `pipeline/anatomy/fetch-bodyparts3d.ts` re-downloads and verifies these hashes.

## Rules

- Raw OBJs and the zip live only in the gitignored `pipeline/.cache/bodyparts3d/`; never commit them. Their headers still carry the pre-2025 "CC Attribution-Share Alike 2.1 Japan" notice; the README update history shows the license page changed on 2025/02/27 and both lic.html and README_e.html now state CC BY 4.0.
- Keep the credit comment in every shipped SVG and the credit line on `/credits` (ATTRIBUTION.md).
