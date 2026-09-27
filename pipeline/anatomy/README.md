# Body map bake (BodyParts3D 4.0 -> SVG + ID rasters)

Build-time only. Output goes to `public/anatomy/` and is committed; the source meshes are not.

```sh
node pipeline/anatomy/fetch-bodyparts3d.ts   # download + sha256 check + unzip into pipeline/.cache/bodyparts3d
node pipeline/anatomy/build-fma-map.ts       # fma-spec.ts + parts lists -> fma-map.json
node pipeline/anatomy/bake-map.ts [--debug]  # -> public/anatomy/*, debug PNGs in qa/out/s2
node pipeline/anatomy/qa-map.ts              # Playwright screenshots -> qa/out/s2/{front,back,overview,groups}.png
```

Everything is deterministic (software rasterizer, no GPU). A full bake takes about 6 s.

## Files

| File | What |
|---|---|
| `fma-spec.ts` | Hand-authored: taxonomy region -> BodyParts3D concept names (right side), per-part clips and rules, occluder concepts. |
| `fma-map.json` | Generated: every region with FMA ids and element files for `l` and `r`, view visibility, clips; occluder file list. |
| `hand-regions.json` | Our own polygons, in body millimetres: the two muscles BodyParts3D lacks (latissimus dorsi, rectus abdominis) and the back-view medial thigh strip of `adductor_longus` (gracilis). |
| `bake-map.ts` | Rasterize, clean, trace, write SVGs and ID rasters. |
| `../lib/{obj,raster,mask,trace}.ts` | OBJ reader, z-buffer rasterizer, morphology, contour tracing. |

## How the bake works

1. Frame: orthographic, 2048 px tall, shared by both views (`viewBox="0 0 816 2048"`). BodyParts3D axes: +x subject left, +y posterior, +z up, mm. Front looks from anterior (viewer's left = subject's right); back mirrors x.
2. ID pass, antialiasing off: every region part is rasterized with its region-instance label when the region is visible in that view (taxonomy `view` flag), otherwise as neutral. All other bones, cartilages and muscles are rasterized as neutral occluders, so deep muscles never show through (platysma and serratus posterior are excluded, see `fma-spec.ts`).
3. Region rules:
   - Deep heads draw on their visible parent (rhomboids -> middle trap, teres minor and supraspinatus -> infraspinatus, BF short -> BF long, vastus intermedius -> rectus femoris, glute min -> glute med). The triceps medial head is left neutral.
   - Clips (body mm): forearm muscles end at the wrist, tibialis/soleus/fibularis at the ankle, rectus femoris at the patella, iliopsoas below the inguinal ligament, erectors below a line rising toward the spine (back).
   - The trapezius is re-split: BodyParts3D's "ascending part" also holds the T1-T3 fibres, so its part above a T4 line becomes `trap_middle`.
   - External oblique: pixels where the mesh is thinner than 4 mm along the view axis are aponeurosis and count as uncovered skin.
   - Serratus anterior wins over the external oblique where their projections overlap (the meshes overlap there instead of interdigitating).
4. Clean: per label, morphological open (5x5), drop pieces under 0.05% of body area.
5. Hand regions: lats and rectus abdominis fill uncovered skin (plus the posterior oblique, for the lats) inside their polygons; the rectus gets a linea alba and three tendinous intersections. In the back view the gracilis is seen edge-on behind the hamstrings, so `adductor_longus` (view `FB`) gets an 8 mm medial thigh strip from the gluteal fold to the knee: uncovered skin plus the medial edge of the semimembranosus. Then the same clean pass.
6. Trace: each region mask is dilated 1 px (clipped to the silhouette), Gaussian-blurred (sigma 2 px) and traced at the 0.5 level with d3-contour, then simplified with simplify-js.

## Outputs (`public/anatomy/`)

`front.svg`, `back.svg` (full map, same viewBox):

```xml
<svg viewBox="0 0 816 2048">
  <!--! BodyParts3D, © The Database Center for Life Science, CC BY 4.0, modified -->
  <g id="silhouette"><path d="..." fill-rule="evenodd"/></g>
  <g id="regions">
    <path data-head="pec_clavicular" data-group="chest" data-side="r" d="..."/>
    <path data-untracked="sartorius" data-side="l" d="..."/>
  </g>
</svg>
```

- One path per region instance. `data-side` is the subject's anatomical side, not the screen side.
- No fills or styles; paths with holes or several pieces carry `fill-rule="evenodd"`.
- Adjacent regions overlap by about 1 px so no seams show; real gaps between muscles show the silhouette.

`front.groups.svg`, `back.groups.svg` (mini maps): same viewBox and silhouette, `<g id="groups">` with one `<path data-group data-side>` per group and side, coarser and integer coordinates.

`front.ids.bin`, `back.ids.bin`: group-index raster for tap hit-testing, decoded by `src/domain/idRaster.ts`.

### ID raster format, version 1

Little-endian. The raster covers the full SVG viewBox: cell (cx, cy) spans viewBox x in `[cx, cx + 1) * vbWidth / width`, same for y.

| Offset | Type | Field |
|---|---|---|
| 0 | 4 bytes | magic `GBID` |
| 4 | u8 | version = 1 |
| 5 | u8 | groupCount (max 31) |
| 6 | u16 | width (cells) |
| 8 | u16 | height (cells) |
| 10 | u16 | vbWidth (SVG viewBox width) |
| 12 | u16 | vbHeight (SVG viewBox height) |
| 14 | table | groupCount entries: u8 byte length + ASCII group id. Entry i (0-based) is group index i + 1. |
| ... | runs | Row-major run-length data until width x height cells are filled. |

Each run starts with one byte `b`: value = `b >> 3` (0 = no group, else group index), `n = b & 7`. If `n > 0` the run is `n` cells long; if `n = 0` it is `8 + varint` cells, where the varint (unsigned LEB128) follows. The decoder rejects bad magic, unknown versions, out-of-range indices, overflowing runs and trailing bytes.

Cells take the most common label among the source pixels they cover; untracked muscles and neutral skin are 0. Current files: 192 x 480 cells, about 5.5 KB each.

`hitTest(raster, x, y, radiusPx)` counts group cells inside the disc (empty cells don't count) and returns candidates ranked by cell count with their share; `pickGroup` returns the top group when its share is at least 0.7, else null (show the chooser).
