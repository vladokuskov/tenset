# Gym Program Builder: implementation plan

Working name / dir: `~/projects/gym-builder` (own `git init`; `~` is itself a repo with no commits, so check `git rev-parse --show-toplevel` before committing).

## Context
Greenfield. A static, no-backend web app where the user:
1. browses a catalog of gym exercises, each with a high-quality looping animation,
2. builds a weekly program (Mon..Sun), from a split template or blank,
3. sees a very detailed front/back body map of which muscles each day and the whole week load, so the week covers everything they need.

Owner decisions (2026-09-26): public from day one; **all media generated in-house by the agent**, license-clean; phone-first offline PWA (desktop secondary); v1 = planner + split templates, no workout logging; recovery is informational only (no warnings, no blocking).

Research basis: 3 workflows (11 scouts, adversarial license checks on primary sources, completeness critic, 4-lens plan review). Facts that shape the plan:
- No free exercise media is both animated and clean for public release. ExerciseDB GIF ownership is disputed; free-exercise-db images AND instruction text are copied from Bodybuilding.com; wger/Everkinetic are CC BY-SA line art.
- No bundleable dataset tags muscles at head level, so the mapping is our own original work.
- Nobody ships a detailed body map that fills in live while *planning* a week (competitors map logged workouts at 11-21 coarse groups). That is the product gap.

## Can we generate all media ourselves?
Yes, procedurally. The agent can't produce raster images or video from a diffusion model, but it can author a 3D figure, props and motions as code/data, render them, and inspect screenshots. 3D beats a hand-drawn 2D rig here: hand-writing organic anatomy as SVG coordinates is the agent's weakest skill, a CC0 body gives anatomy for free, and the depth buffer solves occlusion.
- **Body**: MakeHuman base mesh + rig (CC0), faceless smoothed mannequin head, stylized clay look.
- **Motion**: ~25 parametric movement templates as JSON, solved with IK/constraints into exact looping reps. Variants (grip, angle, implement) are tiny records.
- **Highlights on the moving figure**: primary/secondary muscles tinted live, pulsing on the concentric phase.
- **Ceiling**: clean, consistent "studio clay mannequin". Above clip-art GIF libraries, below mocap-driven 3D or real video.
- Proof it works: blwsk/exercise-animations (8 exercises, 2026-09-25). No license: view its demo/README only, never load its code into an agent's context.
- Fallback if S1 fails the look test: same motion data on a 2D rig. Last resort: RepDB Standard ($499, read its paid license first).

## v1 product scope
- **Catalog ~100 curated exercises** (breakdown in Appendix A). Every visible muscle head gets at least one primary exercise. Out of v1: Olympic lifts, kettlebell flows, kipping, carries. Grows to ~300 in v2.
- **Exercise detail**: 3D loop, primary/secondary muscles on the figure and a mini map, equipment, pattern, 3-5 original cues, alternatives (same pattern, your equipment), "Edit how this counts" (per-exercise group-role override, shown with a "custom" badge).
- **Weekly builder**: Mon..Sun. Phone: multi-add sheet from a day (primary), drag handle to reorder within a day, move/copy between days from the entry menu (also the non-drag path WCAG 2.5.7 requires). Drag between days only on the desktop board. Per entry: hard sets (stepper, default 3), rep range (preset chips). Duplicate/clear day, rest days, per-day free-text note (never counted). Destructive actions show an Undo toast (one-step snapshot undo), not a confirm dialog.
- **Programs**: several named programs, one active. Templates, imports and share links always create a new program, never overwrite.
- **Split templates**: Full Body 3x, Upper/Lower 4x, PPL 6x, PPL 3x, Bro 5x. Each is ordered sessions of slots (pattern + target group + sets + ranked options, e.g. BB bench > DB bench > push-up) plus a default weekday pattern. Loading fills each slot with the first option the user's equipment allows.
- **First run** (`/welcome`, 3 skippable steps): template or blank, training days, equipment preset (full gym / dumbbells + bench / bodyweight / custom). Lands on a filled, colored week.
- **Body map**: front + back, head-level, shaded by effective sets. Scope: Week or one day. Shading: Groups or Heads. Tap opens a muscle sheet: weekly sets (big number), band as a neutral text pill with "why?", Mon..Sun strip, head rows, contributing exercises with visible math ("Incline DB press · Mon · 3 x 1.0 = 3"), "Add exercise for this muscle".
- **Coverage**: per-group table with bands; "not trained" chips with equipment-aware suggestions; balance insights as plain numbers.
- **Recovery (info only)**: plain facts in secondary text ("Chest: also Sun, 1 day earlier, 8 sets"; "Trained Mon, Thu, Sat · gaps 3, 2, 2 days"). No red/amber, no "!" badges, no readiness %, none of "too soon / risk / overtrained / recover". Never in toasts, never blocks. (Chest on consecutive days is fine at moderate volume per the research; the strip just makes overlap visible.)
- **Custom exercises** (yes in v1, small): name, equipment, laterality, group roles picked on the body map, generic card, "custom, your mapping". Max 30, embedded in share links. Without this, anyone entering their real program hits a catalog gap and gets a wrong map.
- **Settings**: goal (hypertrophy default / strength / general), equipment, counting mode (fractional / primary only), week start (from locale), list/reset overrides.
- **Local-first**: localStorage with zod-validated versioned migrations; share link (versioned binary codec in the URL fragment) opening a read-only `/shared` preview with "Save to my programs"; QR; JSON export/import; print view. Offline PWA. Install nudge card only in a Safari tab after the first edit.
- **Pages**: `/credits`, `/privacy`, `/about`. Not-medical-advice line in first run, exercise detail footer, coverage footer, print footer.

## Screens and navigation (390x844 design target)
- Bottom tabs: **Plan, Body, Exercises**. Plan header ⋯ menu: Share/QR, Export/Import, Print, Settings, Credits; tap program name to switch programs.
- Routes: `/`, `/day/:dow`, `/body`, `/exercises`, `/exercise/:slug`, `/welcome`, `/shared`, `/settings`, `/credits`, `/privacy`, `/about`. Sheets live in the URL (`?sheet=add&day=mon`) so back closes them; native `<dialog>` styled as a bottom sheet. Visible back button on every pushed screen (Home Screen mode has no browser chrome); safe-area insets; 44 px min targets; nothing hover-only.
- **Plan**: coverage card on top (week mini map front+back, "15 of 19 groups trained", not-trained chips, total sets), then 7 day rows (label, "5 exercises · 17 sets", group mini map, chevron; rest rows compact).
- **Day**: Mon..Sun chips (no swipe between days, it fights iOS edge-back), collapsible "This day" card (small map, top groups, neutral recovery line), entry list, sticky "Add exercise". Entry row: poster, name, primary muscles, sets stepper, reps chip, handle, ⋯ (Swap, Move, Copy, Remove). After each change the affected regions pulse and a toast shows the delta ("Chest 8 -> 11") with Undo.
- **Add sheet**: "Add to Monday", search (no autofocus), chips Suggested (fills gaps first) / Muscle / Equipment (default "Mine") / Pattern. Rows show static posters only. "+" adds 3 sets and keeps the sheet open ("Done (3)"). Row expands in place to show its mini map and the week delta.
- **Map tapping**: a tap selects a *group* (bands are group-level); heads are picked inside the muscle sheet. Hit-testing samples a baked ID raster (`{front,back}.ids.bin`, ~5-10 KB) in a 12 px radius: >= 70% one group opens it, otherwise a "Which muscle?" chooser (max 4 rows). Zoom button renders one view at 2x in a native scroll box. The coverage list is the accessible equivalent.
- **Exercise detail**: full-screen route. Poster shows instantly, crossfades to the live figure once the lazy 3D chunk loads. On touch, no OrbitControls (it sets `touch-action: none` and traps scrolling): Front/Side/Back presets + horizontal-drag rotate with `touch-action: pan-y`. Play/pause, 0.5x/1x, scrub. Reduced motion: paused mid-rep. Sticky "Add to plan" opens a multi-select day picker.
- **Catalog**: 2-column grid, "Filter by muscle" via the map, search with aliases ("RDL", "OHP").
- **Empty states**: an empty training day is not a rest day; blank program shows a grey silhouette + "Use a template"; no-results names the active filters with one-tap clear.
- **Desktop >= 1280 px**: nav rail, 7-column week board (drag between days), sticky ~400 px map panel, catalog drawer to drag from; hover an entry to highlight its muscles and vice versa. 1024-1279: map panel becomes a toggled overlay. < 1024: phone layout, max width 640 px.
- **Color**: volume is the only data color. One colour-blind-safe single-hue scale in 6 steps matching the bands, legend under the map, retuned for dark mode. Bands are text pills, never colors, so "high" never reads as danger.

## Architecture

### Stack (npm-verified 2026-09-26)
| Layer | Pick |
|---|---|
| Build / UI | Vite 8.3 + React 19.3 + TypeScript 7.0 (`tsc --noEmit`) + oxlint (typescript-eslint doesn't support TS 7 yet) |
| Styling | Tailwind 4.3, theme tokens, dark mode. Fonts: `system-ui` (or Inter / Atkinson Hyperlegible Next, OFL, self-hosted), `tabular-nums`. Icons: lucide-react |
| Routing | TanStack Router 1.170 (typed search params) |
| State | Zustand 5 + persist (localStorage), zod 4 schema + migration chain |
| 3D | three 0.186 + @react-three/fiber + drei, lazy chunk. `useGLTF(url, false, true)` (meshopt, no Draco CDN) |
| Search / lists / DnD | MiniSearch 7.2; @tanstack/react-virtual; @dnd-kit/react 0.5.0 exact pin behind an adapter |
| PWA | vite-plugin-pwa 1.3 `injectManifest`, own `sw.ts`, `injectRegister: 'script'` |
| Share | custom binary codec, base64url `#fragment`, version byte; uqr for QR |
| Tests | Vitest 5 + Playwright 1.63 (+ axe) |
| Hosting | Cloudflare Workers static assets, assets-only (no Worker script). Free: unlimited static requests, 20k files, 25 MiB/file |
| Compliance | CI license allowlist (MIT, ISC, BSD, 0BSD, Apache-2.0, CC0, OFL, BlueOak) + generated `THIRD_PARTY_NOTICES.txt` |

**Zero third-party runtime requests** (license, privacy and offline): banned drei helpers `MatcapTexture`, `NormalTexture`, `Environment preset=`, `Cloud`, detect-gpu tiering, `<Text>` without a local font. Enforced by a strict CSP in `public/_headers` (`default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`, `connect-src 'self'`, etc.) and an e2e test that fails on any non-app request.

### Repo layout
```
gym-builder/
  pipeline/                  build-time only, never shipped
    .cache/                  gitignored: MPFB2 data, BodyParts3D zip (sha256-pinned)
    body/                    build-body (Blender+MPFB2 headless or Node loader), atlas.ts
    anatomy/bake-map.ts      BodyParts3D -> front/back SVG + ID rasters
    motion/                  skeleton, FK, 2-bone IK (+swivel), constraints, min-jerk timing, baker
    qa/                      numeric gates, contact sheets, report
    render/                  Playwright (Metal) renderAt(t) -> WebP posters, H.264 loops
  data/
    taxonomy.json  sources.json  backlog.csv  known-gaps.json
    motion-templates/*.json  exercises/*.json  splits/*.json
  licenses/                  evidence (not shipped): mpfb2/, bodyparts3d/
  src/
    domain/                  pure TS: muscles, volume, recovery, coverage, program, codec
    features/                catalog, builder, bodymap, figure, programs, welcome, share, export, settings, review (dev-only)
    store/  routes/  sw/  ui/ (Sheet.tsx ...)  styles/
  public/models/body.glb  public/anatomy/  public/media/{cards,posters,loops}/  public/_headers
  ATTRIBUTION.md  e2e/
```

### Muscle taxonomy (`data/taxonomy.json`, frozen end of week 1, changes by PR only)
- **19 banded groups**: chest, lats, upper back (mid/lower traps + rhomboids), upper traps, front delt, side delt, rear delt, biceps (+ brachialis), triceps, forearms (brachioradialis + wrist flexors/extensors), abs, obliques, lower back (erectors + QL), glute max, glute med (+ TFL, glute min), quads, hamstrings, adductors, calves.
- **4 tracked, unbanded**: hip flexors, rotator cuff, serratus anterior, tibialis anterior (number shown, never a band or nag). Neck not tracked in v1.
- **38 visible heads (~46 region instances)**: pec clavicular, pec sternal, delt anterior/lateral/posterior, biceps brachii (one region; head split lacks evidence), brachialis, brachioradialis, wrist flexors, wrist extensors, triceps long/lateral, traps upper/middle/lower, lats, teres major, infraspinatus, serratus, rectus abdominis, external oblique, erectors, glute max, glute med, TFL, iliopsoas, rectus femoris, vastus lateralis/medialis, adductors, adductor magnus, biceps femoris, semitendinosus, semimembranosus, gastrocnemius medial/lateral, soleus, tibialis anterior.
- **Deep heads draw on a visible parent** (max, never sum) and appear in list views: rhomboids > middle trap, triceps medial > lateral, vastus intermedius > rectus femoris, BF short head > biceps femoris, glute min > glute med, supraspinatus/subscapularis/teres minor > infraspinatus, QL > erectors, internal oblique > external oblique.
- Drawn but untracked (neutral, not tappable): SCM, sartorius, fibularis. Head record: id, group, view (F/B/FB), parent, Terminologia Anatomica name.

### Exercise record (sketch)
```json
{ "id": 42, "slug": "incline-db-press-30", "name": "Incline Dumbbell Press",
  "aliases": ["incline db bench"], "family": "incline-press",
  "equipment": ["dumbbell", "adjustable-bench"], "pattern": "incline-push", "mechanic": "compound",
  "laterality": "bilateral", "level": 1, "unit": "reps",
  "defaults": { "sets": 3, "reps": "8-12", "strengthReps": "5-8" },
  "groups": { "chest": "primary", "front_delt": "secondary", "triceps": "secondary" },
  "heads": { "pec_clavicular": 1, "pec_sternal": 0.75 },
  "stabilizers": ["forearms"], "alternatives": [41, 17, 88],
  "media": { "status": "card", "template": "horizontal-press", "params": { "benchAngle": 30, "implement": "dumbbell" }, "mapView": "front" },
  "cues": ["..."], "basis": ["rodriguez-ridao-2020", "chaves-2020"], "confidence": "high",
  "status": "active", "replacedBy": null, "qa": { "data": "approved", "motion": "pending" } }
```
Rules: `groups` alone drives bands. `heads` is optional emphasis inside a listed group (most-loaded head = 1; omitted heads of a listed group = 1; a head from an unlisted group is a CI error). `media.status`: `card | still | loop`. u16 ids are permanent and never reused; retired ids keep `replacedBy` so old share links decode. User overrides edit `groups` only.

### Volume and coverage engine (`src/domain`, pure, heavily tested)
- **Fractional sets** at group level: primary 1.0, secondary 0.5, stabilizer 0 (Pelland et al. 2026, Sports Med). `E[g][d] = sum(sets * w)`, `W[g] = sum over days`. Unilateral sets are per side, counted once. Duplicate exercises in a day sum. No supersets in v1.
- **Bands** (weekly W, hypertrophy): `0` not trained / `(0,4)` light / `[4,10)` moderate / `[10,20]` target range / `(20,30]` high (diminishing returns) / `>30` very high. No "optimal", "under" or "maintenance" in copy. Sources: Pelland tiers, ACSM 2026 (>=10), Baz-Valle 2022 (12-20). Overrides labeled "expert opinion (RP 2023-24)": hamstrings target 8-16; front delts light <2, target 6-16; side delts target 10-24; rear delts 8-18. Optional groups (abs, obliques, forearms, upper traps, lower back, glute med, adductors) show "target 6-16", never "light", and sit in a collapsed row at 0. Strength goal adds ">= 2 sessions/wk" per main pattern. General goal reads `[4,10)` as "good for general fitness". 3-day templates land mostly in "moderate" by arithmetic, and their descriptions say so.
- **Head shading**: `H[h] = sum(sets * roleWeight(group(h)) * emphasis[h])`, not normalized, same scale as groups; deep heads draw as `max(parent, deep)`. Head coverage hint when `H[h] / W[group] < 0.6` (heuristic). Heads never get bands.
- **Intensity**: week `min(1, sqrt(W)/sqrt(30))` (Pelland's square-root fit); single day `min(1, sqrt(E)/sqrt(10))`; legend says which scale is on.
- **Recovery info**: per group, days with `E >= 2` and gaps, cyclic (days stored 0-6, 0 = Monday; display start from settings). Displayed, never warned.
- **Balance insights** ("heuristic" tooltip): untrained banded groups; missing patterns (no horizontal pull, vertical pull, knee flexion, hip hinge, direct rear delt); push vs pull and quad vs hamstring as side-by-side numbers, never pass/fail. No injury wording.
- Every output carries a `sourceId` for the "why?" popover.
- **Rule table** (verified corrections): overhead triceps extension = all heads 1, pushdown long head 0.75 (Maeo 2023); soleus equal standing/seated (Kinoshita 2023); seated leg curl BF long/ST/SM 1, lying 0.75, BF short equal (Maeo 2021); Nordic: ST > BF short; leg-extension rectus femoris depends on hip angle (Larsen 2025); incline 30-45 deg favors clavicular pec (Rodriguez-Ridao 2020, Albarello 2022); OHP: side delt secondary (single-head group, so no in-group emphasis; Campos 2020); deep squat adductor magnus primary, rectus femoris 0.5 (Kubo 2019); hip thrust and squat same glute max role (Plotkin 2023); isometric grip = stabilizer.
- **Lead decisions (2026-09-26, after week-1 data review)**:
  - Scapular upward rotators: upper_traps secondary on overhead presses, lateral raises (DB and cable identical) and the prone Y-raise; serratus secondary only on overhead presses and push-ups (primary on push-up plus).
  - Forearms count only when elbow flexion is primary (curls, hammer/reverse curls) or for wrist work. On rows, pulldowns and pull-ups forearms are stabilizers.
  - Chest dip: triceps primary (same as close-grip bench). High-to-low cable fly: no front delt. Front raise: no chest.
  - Chest-supported row is the upper-back variant: elbows flared ~60-70 deg, lats secondary.
  - Face pull: rear delt, upper back and rotator cuff primary, no biceps (light load, not a row pattern).
  - Lower back: heavy hinges (deadlift, RDLs) secondary; 45-degree back extension primary; rows and squats stabilizer.
  - `mechanic: compound` means "loaded like a main lift" (hip thrust, glute bridge, back extension stay compound).
  - Head emphasis 0 is allowed for heads of a listed group that do no work (e.g. wrist extensors on a wrist curl).
  - Reclined leg extension (412, hip ~40 deg) is the rectus femoris primary exercise (Larsen 2025).
  - Media params are not normalized yet; lane C freezes one param schema per template before motion work, then all records are normalized in one pass.

### Media pipeline (build-time, all in-house)
1. **Body**: CC0 assets only from MPFB2 at a pinned commit (base.obj, macrodetail targets, `default_no_toes` rig + weights; MPFB2's license explicitly covers rigs, the MakeHuman 1.x repo's doesn't). Route: Blender 5.2 headless + MPFB2 v2.0.17 (`create_human` with athletic macros, `add_builtin_rig("default_no_toes")`, glTF export). Timebox 0.5 day for 5.2 compatibility; fallback is a Node loader written from the file formats (never porting MPFB2/MakeHuman code, which is GPL/AGPL). Post-process: smooth the face, merge face bones into `head`, strip helper geometry, keep clavicles and all spine bones, keep split limb bones as twist bones, gltf-transform meshopt. Target <= 600 KB.
2. **Look** (owner direction 2026-09-26, replaces the clay mannequin): industry-standard exercise-illustration style. Lean, visibly muscular athletic male with clearly separated muscle bellies and subtle fiber texture, neutral light-gray skin rendering, worked muscles in saturated red-orange (primary) and lighter orange (secondary), short dark hair, calm neutral face (A/B test realistic vs stylized head), dark shorts, bare feet; equipment clean white/light-gray with dark pads; white background, soft contact shadow, elevated three-quarter camera. Match the style only: no third-party illustration is traced, stored or used as a pipeline reference. This pulls the head-level 3D muscle atlas (BodyParts3D registered onto the body, per-texel region ids + baked muscle-relief normal map) from v2 into v1.
   Previous clay notes: soft contact shadow, self-hosted environment. Highlight shader: per-vertex group id -> LUT (primary/secondary/off), concentric pulse. MVP atlas: ~22 group regions seeded by dominant bone weight x normal direction, refined with landmark planes. v2: BodyParts3D heads on the figure.
3. **Props**: parametric, generic (no logos or brand silhouettes), with grip/contact sockets: barbell, plates, dumbbell, EZ bar, bench (0/30/45/-15), rack, cable stack + handles, pull-up/dip station, and ~12 machines in priority order: cable stack, leg press, leg extension/curl, lat pulldown/row, hip abduction/adduction, 45-degree back extension, chest press, pec deck, assisted pull-up, smith, calf. If lane C slips, v1 ships the first 4 and the rest move to v1.x.
4. **Motion**: ~25 templates (squat, hinge, lunge, horizontal press, incline press, vertical press, row, vertical pull, curl, triceps extension, lateral/front/rear raise, fly, calf raise, hip thrust, leg extension, leg curl, crunch, leg raise, dip, push-up, shrug, wrist curl, hip abduction/adduction, back extension, holds). Driver types: joint-space, implement-space (bar path keyed, arms by IK), root-space (hands/feet fixed). Balance solver keeps bar over midfoot. Tempo `[2, 0.2, 1, 0.5]` s, minimum-jerk easing, loop cut mid top-pause. Renderer-agnostic data (2D escape hatch).
5. **QA harness**: numeric gates on every frame (foot slip <= 5 mm, grip error <= 5 mm, joint limits, penetration, loop seam, IK-flip detector); orthographic side/front/top contact sheets + onion skins + hand/foot crops; fresh-context reviewer agent with a per-template checklist; owner approval in `qa.motion`.
6. **Rendering**: Playwright Chromium with `--use-angle=metal`, aborting unless the WebGL renderer string contains `Metal` (default headless uses SwiftShader). Deterministic `renderAt(t)`, `preserveDrawingBuffer`. Posters via `canvas.toBlob('image/webp')` with alpha (local ffmpeg has no libwebp). Loops via ffmpeg libx264 `yuv420p +faststart` on one fixed "media well" color shared by both themes. Bakes run locally, get content-hash names (body version + template + params + renderer version), and are committed; CI never renders.
7. **Delivery**: detail view renders live. Grid and add sheet show posters; grid loops (max 6 playing, IntersectionObserver, tap-to-play fallback for iOS Low Power Mode) come after M1. Whole catalog ~5-10 MB, precached.
8. **Body map** (`bake-map.ts`): BodyParts3D 4.0 (CC BY 4.0) `isa` OBJs (143 MB zip, cached). Resolve FMA ids via the parts lists; render a whitelist of visible heads per side + skin silhouette, orthographic, flat ID colors, 2048 px, antialiasing off. Morphological open, drop slivers < 0.05% of body area, trace with d3-contour (marching squares) + simplify-js, dilate 1 px over the filled silhouette. Lats and rectus abdominis (absent from BodyParts3D) = uncovered skin inside our own hand-drawn polygon, traced in the same pass. Day-1 check: if arms hide serratus/obliques, rotate arm parts out ~15 deg. Also emit the ID rasters for hit-testing. Flat/gradient fills over a neutral silhouette, heat via CSS variables; mini maps use group regions via `<symbol>/<use>`.
9. **M1 cards**: each exercise's card = the mini map (the view showing its primaries) tinted primary/secondary + an equipment glyph. No 3D needed.

### Licensing and compliance rules
- **Allowed**: CC0 MakeHuman assets from pinned MPFB2 (copy LICENSE.md sections C/D + SHA to `licenses/mpfb2/`); CC BY 4.0 BodyParts3D with the verbatim credit "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International" + source URL + license URL + modification note, evidence (lic.html, README, Wayback URL, date, zip sha256) in `licenses/bodyparts3d/`, raw OBJs never committed (headers still show the old SA notice), `<!--! ... -->` credit comment in every shipped SVG; MIT/ISC/BSD/Apache/OFL code.
- **Build-only GPL tools** (Blender, MPFB2, FFmpeg/x264, resvg) are fine in `pipeline/`; their output isn't covered. Nothing GPL ships in `src/` or `public/`. Never ship an encoder.
- **Banned**: free-exercise-db images/text/tags; ExerciseDB/Gym visual GIFs; wger content; Z-Anatomy/fitmitwith (except an owner-approved S2 fallback, as separate SVGs with their license); Mixamo; SMPL/AMASS/Fit3D; HY-Motion; ExRx/MuscleWiki/Liftosaur mappings and any ExRx scraping; mannequin.js; blwsk code; MakeHuman community-site assets; 3D marketplace models, manufacturer CAD, logos; pose extraction from third-party videos; RepDB clips as motion reference; third-party anatomy images as tracing references (Gray's 1918 plates are fine).
- **Names**: generic primary names ("Nordic hamstring curl", "Reverse hyperextension", "Machine chest fly (pec deck)"); marks like Pendlay/Reverse Hyper/Nordic curl are search aliases only; no brand names. `/credits` says names are descriptive, no affiliation.
- **Cues**: 3-5 short imperative lines, LLM-drafted only inside our closed taxonomy, never prompted with third-party text. `pnpm test:cues` fails on any word 7-gram shared with free-exercise-db or wger text (fetched to gitignored `.cache/`, never in prompts) and on known boilerplate ("this will be your starting position").
- **Privacy**: no consent banner (localStorage + SW cache are strictly functional and stay on-device; ePrivacy 5(3) exemption, EDPB 2/2023). `/privacy` names the operator, Cloudflare as processor, what's stored locally, and that share links live in the URL fragment. Adding analytics later means revisiting this.
- **Medical**: never claim injury prevention, rehab or treatment (keeps it well-being software, outside the EU MDR). No liability-waiver wording.
- **Own license**: code MIT; data/media CC BY 4.0. Before launch: check your employment contract's IP clause covers side projects, and run a trademark knockout on the product name (USPTO/EUIPO/UKIPO) before buying a domain.
- `ATTRIBUTION.md` at repo root (draft from the licensing review: this project, BodyParts3D, MakeHuman/MPFB2, fonts, OSS notices, research, contact), rendered at `/credits`.

## Phases
**Lanes** (parallel agents; the owner is the only serial resource):
- A app: scaffold, domain + tests, store, catalog, builder, map UI, PWA.
- B data: taxonomy (frozen end of week 1), then ~100 exercise records, then 5 splits. No media dependency.
- C figure: S1, then solver, props, QA, then template families. **Critical path.**
- D map: S2, then the map component and M1 cards.
Critical path: S1 look approval > first template family approved > remaining families > owner motion review. Owner review for lane C always goes before polish in A/B.

**Status 2026-09-27**: S2 map approved by owner. S1 look approved by owner in the illustration style (look v2) with head B (stylized); remaining polish: raised-arm shoulders, serratus/flank relief, hands/grips, hair, B lips/eyes, shader cost. M1 planner complete and green (not deployed; owner deploys once the first animated families exist). Motion core + 4 worst-case templates built.

**Phase 0: spikes (week 1)**
- S1 figure, in kill order. Day 1: GLB + clay shader, one 390 px still to the owner (look iteration 1). Day 2: FK-only stress poses (arms overhead, 90 deg abduction, full pronation/supination, deep squat, dead hang); kill if deformation fails after code-only fixes (weight smoothing, angle-keyed corrective morphs). Then IK, QA harness, 4 motions (back squat, DB lateral raise, pull-up, supinating curl). Pass: foot/grip <= 5 mm; harness catches an injected 1-frame IK flip and a 10 mm foot slide; owner rates "premium" at 390 px within 6 iterations; bake asserts Metal; GLB <= 600 KB; 3rd motion <= 1 agent-day. Kill: 2D rig on the same motion data.
- S2 map (parallel from day 1): bake front/back from BodyParts3D. Pass: owner reads regions correctly; <= 150 KB gz per view. Kill: coarser ~25-region map drawn over our own MakeHuman renders; fitmitwith only with owner sign-off.
- S3 devices (starts once the S1 GLB exists): iPhone (Safari tab + Home Screen, Low Power on/off) + mid-range Android. Pass: detail figure >= 55 fps, map + 7 mini maps without jank, airplane-mode offline works.
- S4 UX (2-3 days): clickable 390x844 prototype (Plan, Day, add sheet, map tap + chooser, muscle sheet, detail with poster). Pass: owner builds a PPL week from blank on their phone in < 5 min unaided; >= 90% of 20 scripted map taps hit the right group or the chooser; no scroll trap.

**M1 walking skeleton (end of week 3-4, deployed publicly)**
The full planner over all ~100 data records with M1 cards: catalog, builder, programs, 5 splits, first run, body map, coverage, custom exercises, share/export/print, offline PWA, credits/privacy/about. Detail view shows the card and "demo coming". Independent of S1 passing.

**Phase 2: media pipeline foundation (weeks 2-6, lane C)**
Harden S1 into the full solver, prop library, QA harness, render/bake scripts, `/review` route.

**Phase 3: animation families (weeks 5-14)**
Pressing, pulling, squat/hinge, arms, delts, leg machines, core. Per family: template + variants, QA gates, reviewer agent, owner batch review; one deploy per family flipping `media.status` to `loop`. Grid loops land here.

**Phase 4: release hardening**
a11y (axe), perf and precache budget, Lighthouse PWA, CSP, license allowlist, trademark/IP checks, custom domain.

**Agent work contract**
- `data/backlog.csv`: one row per exercise (id, slug, family, template, equipment, used-by-splits, priority, status for data/cues/motion/qa/owner). The only queue agents pull from; one family per agent.
- Done (data record): passes zod, muscle ids exist, every primary has `basis` or `confidence: low`, 3-5 cues passing `test:cues`, family invariants pass.
- Done (animated): `qa:motion` passes; card, poster, loop baked on Metal within size budget; reviewer checklist passes; owner marked approved.
- `/review` (dev-only, excluded from the build): contact sheet, loop, mapping, cues side by side with approve/reject + note, written through a Vite dev endpoint. Weekly owner batches.

**v2 backlog**: BodyParts3D heads on the moving figure, female figure (same topology), ~300 exercises, secondary motion (breathing, head), optional fatigue-decay visual, workout logging.

## Verification
- **Unit** (`pnpm test`): engine band edges at exactly 4/10/20/30 and fractional values; head shading; recovery gaps with cyclic wrap; overrides; primary-only mode; unilateral and duplicate entries; codec round-trip, retired-id decode, custom-exercise encoding; migrations. Taxonomy: each visible head has a path in every view its flag names, each deep head has a visible parent, each head belongs to exactly one group; every map group reachable by the ID-raster hit test.
- **Data**: every visible head has >= 1 active exercise where its group is primary and emphasis 1; every banded group has a primary exercise per equipment preset or is in `known-gaps.json`; `alternatives` share pattern + primary group; every template x equipment preset fills every slot or drops it with a note.
- **Golden fixtures**: W and band per group for all 5 splits (acceptance: every banded major group >= 4 in every template; chest, lats, upper back, quads, glutes, hamstrings >= 8 in 4+ day templates; nothing > 20 unless intended); frozen v1 share strings that must decode forever.
- **Motion**: `pnpm qa:motion` gates for every animated exercise (pure Node, runs in CI); stale-media guard fails when data changes leave a baked file out of date.
- **E2E** (Playwright, desktop + iPhone 13 touch profile): first run > template > filled Plan; 3 adds in one sheet session; move an entry via the menu; back closes a sheet; share link opens `/shared` and leaves existing programs untouched; offline reload in airplane mode (Chromium); print; axe; fails on any non-app network request.
- **CI** (GitHub Actions): tsc, oxlint, vitest, qa:motion, data integrity, test:cues, e2e on the built app, bundle + precache budget, license allowlist.
- **Manual**: `pnpm dev`, drive with Playwright MCP at 390 px and desktop, screenshot Plan/Day/Body/detail; real devices per S3 before release.

## Honest risks and pushback
- **"All possible exercises" isn't realistic for v1.** Each needs a motion, a mapping and review. ~100 good ones, then ~300.
- **Form correctness**: the agent can produce plausible-but-wrong form. Gates catch geometry, not coaching. You review every exercise; ideally a coach spot-checks the compounds. It's a public fitness app.
- **Effort**: M1 (usable planner) in 3-4 weeks. Fully animated v1 in 10-16 weeks. Expect 30-50% of motions to bounce once at review. Your time: ~35-45 h (look dev, map test, data review ~3 min/record, motion review with one rework round).
- **Band edges** rest partly on Pelland's paywalled Table 3 tiers. Confirm from the full text before release or anchor to ACSM 2026 + Baz-Valle only.
- **Head-level precision is thin evidence** for some heads (e.g. biceps). Show roles and confidence, never activation percentages.
- **Safari storage eviction** (7 days without visits in a Safari tab): export/import and share links are required; install nudge.
- **Tooling churn**: vite-plugin-pwa heading to maintenance (own `sw.ts` keeps it portable); @dnd-kit/react pre-1.0 (pinned + adapter).

## Appendix A: v1 catalog by family (must-haves first)
- Chest 14: BB bench, incline DB 30, incline BB 30, chest dip, high-to-low cable fly, push-up plus (serratus); DB bench, machine chest press, smith incline, pec deck, low-to-high fly, DB fly, push-up, hands-elevated push-up.
- Shoulders 11: BB OHP, seated DB press, DB lateral raise, cable lateral raise, reverse pec deck, face pull (rear delt, infraspinatus), prone Y-raise (lower trap); machine shoulder press, DB front raise, bent-over rear-delt fly, cable external rotation.
- Back 14: pull-up, assisted pull-up, lat pulldown, BB row, seated cable row, chest-supported DB row (mid trap, rhomboids), 1-arm DB row, DB shrug; chin-up, neutral-grip pull-up, close-grip pulldown, wide-grip cable row, inverted row, BB shrug.
- Squat/lunge 10: back squat, leg press, Bulgarian split squat, leg extension, goblet squat; front squat, smith squat, bodyweight squat, DB reverse lunge, DB step-up.
- Hinge/hips 12: BB RDL, BB hip thrust, seated leg curl, lying leg curl, 45-degree back extension, hip abduction machine, hip adduction machine; deadlift, DB RDL, single-leg RDL, glute bridge, Nordic hamstring curl.
- Calves/shin 4: standing calf raise, seated calf raise, tibialis raise; single-leg DB calf raise.
- Arms 18: EZ curl, incline DB curl, hammer curl, rope pushdown, overhead cable extension, EZ skull crusher, close-grip bench, DB wrist curl, DB reverse wrist curl; BB curl, DB curl, spider curl, cable curl, EZ reverse curl, bar pushdown, seated overhead DB extension, DB kickback, upright dip.
- Core 9: cable crunch, hanging leg raise, side plank, plank; crunch, hanging knee raise, lying leg raise, Pallof press, cable woodchop (only if a rotation template fits).
- = 92, plus ~8 cheap param variants (smith OHP, feet-elevated push-up, leg-press calf raise, single-arm cable row, ...) to reach ~100. Split defaults (16-22 hard sets/session, 2-4 per exercise) live in `data/splits/*.json`, drafted from the domain review.
