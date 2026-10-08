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
- **Weekly builder**: Mon..Sun. Phone: multi-add sheet from a day (primary), drag handle to reorder within a day, move/copy between days from the entry menu (also the non-drag path WCAG 2.5.7 requires). Drag between days only on the desktop board. Per entry: hard sets (stepper, default 3), rep range (preset chips), optional rest between sets (0-600 s, step 15) and RIR target (0-5), and an optional superset with the entry above. Rest and RIR are planned targets only; nothing is recorded. Each training day shows a session estimate ("about 55 min", `src/domain/session.ts`: rep midpoint x 3 s or seconds as given, doubled for unilateral, rest defaults compound 120 s / isolation 75 s / custom 90 s, 60 s setup per exercise, supersets share setup and rest; rounded to 5 minutes). Duplicate/clear day, rest days, per-day free-text note (never counted). Destructive actions show an Undo toast (one-step snapshot undo), not a confirm dialog.
- **Programs**: several named programs, one active. Templates, imports and share links always create a new program, never overwrite.
- **Split templates**: Full Body 3x, Upper/Lower 4x, PPL 6x, PPL 3x, Bro 5x. Each is ordered sessions of slots (pattern + target group + sets + ranked options, e.g. BB bench > DB bench > push-up) plus a default weekday pattern. Loading fills each slot with the first option the user's equipment allows.
- **First run** (`/welcome`, 3 skippable steps): template or blank, training days, equipment (preset as a starting point: full gym / basic gym / home gym / dumbbells + bench / bodyweight, then adjust items by group). Lands on a filled, colored week.
- **Body map**: front + back, head-level, shaded by effective sets. Scope: Week or one day. Shading: Groups or Heads. Tap opens a muscle sheet: weekly sets (big number), band as a neutral text pill with "why?", Mon..Sun strip, head rows, contributing exercises with visible math ("Incline DB press · Mon · 3 x 1.0 = 3"), "Add exercise for this muscle".
- **Coverage**: per-group table with bands; "not trained" chips with equipment-aware suggestions; balance insights as plain numbers.
- **Recovery (info only)**: plain facts in secondary text ("Chest: also Sun, 1 day earlier, 8 sets"; "Trained Mon, Thu, Sat · gaps 3, 2, 2 days"). No red/amber, no "!" badges, no readiness %, none of "too soon / risk / overtrained / recover". Never in toasts, never blocks. (Chest on consecutive days is fine at moderate volume per the research; the strip just makes overlap visible.)
- **Custom exercises** (yes in v1, small): name, equipment, laterality, group roles picked on the body map, generic card, "custom, your mapping". Max 30, embedded in share links. Without this, anyone entering their real program hits a catalog gap and gets a wrong map.
- **Settings**: goal (hypertrophy default / strength / general), equipment, counting mode (fractional / primary only), week start (from locale), list/reset overrides, per-muscle ranges (Normal / More / Less / Skip / Custom). The cited bands stay the default; a personal range is labeled "your range 15-25" wherever the target shows, the "why?" keeps the research range, and Skip drops the band and leaves the group out of coverage counts.
- **Local-first**: localStorage with zod-validated versioned migrations; share link (versioned binary codec in the URL fragment) opening a read-only `/shared` preview with "Save to my programs"; QR; JSON export/import; print view; PNG image of a day or the week; .ics weekly calendar events. Offline PWA. Install nudge card only in a Safari tab after the first edit.
- **Languages**: English and Ukrainian, everything included (UI, exercise names, cues, muscle and equipment names, templates, print). Starts in the browser language, switch always visible (EN / УКР in the main headers, desktop rail, Settings, first welcome step), choice saved in prefs. Text the user saves (program names, day labels from a template) stays in the language it was written in. The API, manifest and `llms.txt` stay English. Details: `docs/I18N.md`.
- **Pages**: `/credits`, `/privacy`, `/about`. Not-medical-advice line in first run, exercise detail footer, coverage footer, print footer.

## Screens and navigation (390x844 design target)
- Bottom tabs: **Plan, Body, Exercises**. Plan header ⋯ menu: Share/QR, Export/Import, Print, Settings, Credits; tap program name to switch programs.
- Routes: `/`, `/day/:dow`, `/body`, `/exercises`, `/exercise/:slug`, `/welcome`, `/shared`, `/settings`, `/credits`, `/privacy`, `/about`. Sheets live in the URL (`?sheet=add&day=mon`) so back closes them; native `<dialog>` styled as a bottom sheet. Visible back button on every pushed screen (Home Screen mode has no browser chrome); safe-area insets; 44 px min targets; nothing hover-only.
- **Plan**: coverage card on top (week mini map front+back, "15 of 19 groups trained", not-trained chips, total sets), then 7 day rows (label, "5 exercises · 17 sets · about 55 min", group mini map, chevron; rest rows compact).
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
| Hosting | Vercel static (moved from the planned Cloudflare Workers assets, 2026-09-28): `vercel.json` holds the CSP, cache headers and the SPA rewrite. Hobby plan terms are non-commercial |
| Compliance | CI license allowlist (MIT, ISC, BSD, 0BSD, Apache-2.0, CC0, OFL, BlueOak) + generated `THIRD_PARTY_NOTICES.txt` |

**Zero third-party runtime requests** (license, privacy and offline): banned drei helpers `MatcapTexture`, `NormalTexture`, `Environment preset=`, `Cloud`, detect-gpu tiering, `<Text>` without a local font. Enforced by a strict CSP in `vercel.json` (`default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`, `connect-src 'self'`, etc.) and an e2e test that fails on any non-app request.

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
    taxonomy.json  sources.json  backlog.csv
    motion-templates/*.json  exercises/*.json  splits/*.json
  licenses/                  evidence (not shipped): mpfb2/, bodyparts3d/
  src/
    domain/                  pure TS: muscles, volume, recovery, coverage, program, codec
    features/                catalog, builder, bodymap, figure, programs, welcome, share, export, settings, review (dev-only)
    store/  routes/  sw/  ui/ (Sheet.tsx ...)  styles/
  api/                       stateless MCP endpoint (mcp.ts) and plain HTTP mirror for agents (agent/[tool].ts), logic in _lib/; builds share links, stores nothing
  public/models/body.glb  public/anatomy/  public/media/{cards,posters,loops}/  vercel.json
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
  "equipment": ["dumbbell", "adjustable_bench"], "pattern": "incline-push", "mechanic": "compound",
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
- **Fractional sets** at group level: primary 1.0, secondary 0.5, stabilizer 0 (Pelland et al. 2026, Sports Med). `E[g][d] = sum(sets * w)`, `W[g] = sum over days`. Unilateral sets are per side, counted once. Duplicate exercises in a day sum. Supersets are pairs of adjacent entries in one day (the second carries `withPrev`), shown A1/A2, B1/B2; they have no effect on set counting and only shorten the session estimate.
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
  - Media params were normalized to strict per-template schemas on 2026-09-27 (src/motion/templates/schemas.ts).
- **Motion decisions (2026-09-27, after the biomechanics review)**:
  - A body-vs-body and body-vs-prop penetration gate (segment capsules measured from the mesh) is required in pipeline/motion QA before any new template family.
  - Front rack: wrist extension limit raised to 90 deg only for hold front_rack (real lifters exceed 70).
  - Add an elbow carrying angle (~12 deg) to the rig instead of abducting the shoulder as a stand-in.
  - Add scapular upward rotation (shoulder01 bone) driven by the scapulohumeral rhythm rule, alongside clavicle elevation.
  - Standing arm exercises may keep the centre of mass within 3.5 cm of midfoot; unloaded squats may shift it toward the heel (more upright trunk).
  - Cable pull direction and load enter the balance solve (lifter leans against the cable).
  - 711 dumbbell curl stays palms-forward (no supination); the supinating variant is 711 only if its cues change.
  - QA reads exercise records directly; data/motion-templates/variants.json is retired.
- **Animation decisions (2026-09-27, after the first 24 loops)**:
  - Production shows the live figure / loop only when media.status is "loop" (owner-approved); dev shows everything.
  - Fix body proportions: the upper arm is ~20% short for a 1.84 m figure; lengthen it toward anthropometric ratios (upper arm ~0.186H) with MPFB2 CC0 targets, then re-register the atlas, re-extract the skeleton, re-run QA and re-bake. The front squat stays in v1.
  - Squats use a rear three-quarter camera so glutes and quads both read. Frames keep a >= 6% margin and never clip equipment bases.
  - Loop seam: encode first/last frames at higher quality (accept ~22% larger loops).
  - Bar curls: gripWidth 1.1 (701 EZ, 713 cable), 1.15 (710 barbell). Goblet squat (405): cupped two-hand grip, dumbbell vertical against the chest.
  - Accepted: 60 mm thigh-belly and 20 mm armpit soft-tissue tolerances, 112 deg leg press hip cap, 90 deg forearm supination limit, cable loads 15 kg (curls) / 6 kg (raises), wrist deviation -22..+12 deg, leg press camera behind the right shoulder, 32 mm post on 214.
  - The penetration gate also covers drawn machine frames, rails, stacks and plates.
- **Owner sign-off (2026-09-27)**: the first 24 loops "look perfect" (keep this motion language for later families). Sign-off rule: after the v1.1 adversarial check, exercises rated "ok" are approved automatically (qa.motion approved, media.status loop); "minor" or "needs work" ones go to the owner on /dev/review. Squats use the rear three-quarter camera (owner confirmed).
- **v1.1 decisions (2026-09-28, lead, owner delegated overnight)**: body arm proportions accepted at upper arm 0.176H / forearm 0.143H (joint-to-joint; the 0.186H reference is from the acromion). Camera exceptions: cable curls az -60, goblet -115, Smith squat -163, front squat front three-quarter (rack must read). Glutes hidden by shorts on squats: tint the shorts in the highlight color over highlighted glutes. Goblet: toe-out 30 so elbows finish inside the knees. Seam: spend up to the accepted +22% on seam quality. Bar curls: >= 10 mm thigh clearance. Penetration gate also checks equipment vs equipment. 310: clearer neutral handles. Hand length stays (grip code depends on it).
- **Approvals (2026-09-28)**: 16 exercises auto-approved per the sign-off rule (402, 301, 302, 303, 309, 311, 203, 204, 214, 701, 702, 703, 710, 711, 712, 714). 401 and 408 rated ok but wait for the glute tint; 405, 406, 407, 713, 719, 310 rated minor and wait for the owner on /dev/review. Update after the v1.1 leftovers step: glute tint on shorts kept at the current strength (62% mix); seam budget counted across all loops (+21.5% total); 407 clipped uprights accepted (bases in frame); 401, 405, 406, 408, 310, 713, 719 auto-approved (rated ok); 402 back to pending for an owner re-check (tint strip at the seat edge); 407 waits for the owner.
- **Families lead decisions (2026-09-28, stabilize step, owner delegated)**: a declared `setup.rests` entry sets the tolerance of its regions on rigid parts and may only raise it on padded ones, and the body-machine gate honours a rest whose implement id matches the drawn layout key (the fist capsule models a closed hand, so flat palms read as a ~36 mm sink). Push-up floor sink accepted (HAND_SINK 45 mm, FOOT_SINK 65 mm; palm capsules measured within a few mm of the support, no visible penetration). 114 hands-elevated push-up uses a 0.9 m wide box so the 1.5x grip lands fully on it, hands placed for 84 deg wrist extension at the top or 66 at the bottom (whichever needs more), palms resting on the box with the same 45 mm allowance. Test timeouts raised where the work is inherent (template setup solves 120 s, scene composer 60 s); the compose framing check now covers every baked motion. v1.x: a flat-palm and a toes collision capsule so these allowances can shrink to a few mm.
- **Lead gates (2026-09-28, owner delegated)**: new QA gate "shoulder horizontal abduction": the upper arm may go at most 45 deg behind the thorax frontal plane (normal passive range, AAOS / Norkin & White), judged only at 60-120 deg of arm elevation (below that it is shoulder extension, which approved 702 and 401 use legitimately); override `tolerances.horizontalAbduction`. New gate "balance (lateral)": the centre of pressure, cable forces included, stays inside the supporting feet (tolerance 0; override `tolerances.lateral`, force or skip with `balance.lateral`); not judged for hand-supported setups on fixed equipment, body rests, non-standing setups or airborne stepping frames (grab handles and walls count as light touch). The composer frames the drawn bench's floor stabilisers (306, 307, 716 now at >= 6.5%). The approved 24 pass both gates with byte-identical posters.
- **Family review decisions (2026-10-01, lead, owner delegated; reviewer plus two skeptics per family)**:
  - Capsule-model allowances (fist capsule vs flat palms, rigid forefoot vs turned-under toes; close-ups show no visible sink; a v1.x flat-palm and toes capsule shrinks all of them): 409/411 lunge rear foot floor 65 mm, 410 step-up trailing foot 35 mm, 804 plank forefoot 65 mm (push-up precedent), 809 woodchop pivot foot 22 mm, 115 forefoot on the box edge 30 mm, 306 row feet floor 50 mm, 512 hand on mat 42 mm, 403 foot-on-bench rest 55 mm with rear ankle plantar flexion to -70, step and leg-press forefoot rest 42 mm, standing-calf yoke rest 50 mm (pads padded again).
  - Soft tissue: 803 side plank stacked thighs 42 mm, 802 hanging leg raise thighs together 42 mm, 508 deadlift floor start FLOOR_START_TOL (thigh/trunk 36, belly 72, forearm/thigh 20, forearm/shank 16 mm). 215 needs no override after the curled clamshell pose.
  - Highlight: the shorts tint also covers hip_flexors (802, 806, 807), as it does the glutes.
  - Motion: 715 barHold holds the humerus direction with humeral rotation, gripWidth 1.1. 704 no body rock. 103/109 elbowFlare 38 plus forearm hold. Standing calf stretch DF 25. Tibialis raise -13.5 to +19 deg. 514 stretch at 24 deg hip flexion. 511 kneeAngle 70. 313 top elbow ~141 deg. 315 wrist deviation band [-22, 20] on the D-handle. 410 rebuilt as a true step-up. 409/411 right leg leads each loop; 411 walking lunge shown in place. 513 keeps the wide rope. 403 keeps its own split bench.
  - Cues changed to match the loops: 304, 306 (45 degree bench), 411, 708 (wrist bend instead of the finger roll), 716, 809 (finish outside the far hip).
  - Cameras (reason commented in each scene module): push-ups az -45 elev 0.12; 201 -48/0.22; F3 209 -55, 213 180/0.36, 207 15/0.45, 215 -60/0.62, 210 elev 0.36, 112 -30/0.55; F4 304 -120/0.24, 306 42/0.38, 307 -105/0.22, 206 -118/0.22, shrugs -140/0.34, 313 -50/0.15 with the rack framed whole; lunges -115/0.24; 512 -135; 503 keeps -100/0.08; F6 506 -52/0.45, 507 -24/0.36, 514 -150/0.18, 515 26/0.22, 601 -128/0.16, 602 -130/0.24, 603 -68/0.18; 510 -155/0.22; 706 -95/0.35. Tall stacks, walls and Smith tops may clip with the bases in frame (407 precedent).
  - Loop bake (2026-10-01): all 106 loops and posters baked on Metal (loops 6.4 MB, posters 0.86 MB). Seam treatment costs +23.2% on the 82 new loops and about +22.8% across all 106, a little over the accepted +22%; accepted (about 40 KB in total, and seam quality is what the owner approved). 410 step-up has no still frames at the cut, so its seam gets no frame reuse; the motion QA seam gate passes.
  - Accepted for v1, fix in v1.x: press elbow depth from the mid-palm grip site (a low-in-the-palm press grip for every press family); 105/111/213 figure ~45% of the frame so both towers fit.
- **Approvals (2026-10-01)**: 35 family exercises auto-approved per the sign-off rule (rated ok by the family reviewer and both skeptics): 104, 110, 112, 113, 114, 202, 205, 206, 207, 209, 210, 304, 305, 307, 312, 315, 403, 404, 409, 412, 501, 504, 507, 509, 512, 601, 604, 606, 704, 705, 708, 715, 718, 803, 805. 57 of 106 are now approved. For the owner on /dev/review, with the findings in qa.note: needs work 313, 502, 508, 707, 801; minor 101, 102, 103, 105, 106, 107, 108, 109, 111, 115, 201, 208, 211, 212, 213, 215, 306, 308, 314, 410, 411, 503, 505, 506, 510, 511, 513, 514, 515, 602, 603, 605, 706, 709, 716, 717, 802, 804, 806, 807, 808, 809; plus 402 and 407 from before.
- **Owner bulk approval (2026-10-01)**: the owner approved every remaining exercise, so all 106 are approved and live. The 5 rated needs work (313, 502, 508, 707, 801) and the minor findings stay in each record's qa.note as the v1.x fix list. Lead follow-ups: the figure model and atlas (~1.1 MB) are now precached so the live demos work offline (precache 4.8 of 8 MiB), and the production build strips qa.note from the bundled records.

### Media pipeline (build-time, all in-house)
1. **Body**: CC0 assets only from MPFB2 at a pinned commit (base.obj, macrodetail targets, `default_no_toes` rig + weights; MPFB2's license explicitly covers rigs, the MakeHuman 1.x repo's doesn't). Route: Blender 5.2 headless + MPFB2 v2.0.17 (`create_human` with athletic macros, `add_builtin_rig("default_no_toes")`, glTF export). Timebox 0.5 day for 5.2 compatibility; fallback is a Node loader written from the file formats (never porting MPFB2/MakeHuman code, which is GPL/AGPL). Post-process: smooth the face, merge face bones into `head`, strip helper geometry, keep clavicles and all spine bones, keep split limb bones as twist bones, gltf-transform meshopt. Target <= 600 KB.
2. **Look** (owner direction 2026-09-26, replaces the clay mannequin): industry-standard exercise-illustration style. Lean, visibly muscular athletic male with clearly separated muscle bellies and subtle fiber texture, neutral light-gray skin rendering, worked muscles in saturated red-orange (primary) and lighter orange (secondary), short dark hair, calm neutral face (A/B test realistic vs stylized head), dark shorts, bare feet; equipment clean white/light-gray with dark pads; white background, soft contact shadow, elevated three-quarter camera. Match the style only: no third-party illustration is traced, stored or used as a pipeline reference. This pulls the head-level 3D muscle atlas (BodyParts3D registered onto the body, per-texel region ids + baked muscle-relief normal map) from v2 into v1.
   Previous clay notes: soft contact shadow, self-hosted environment. Highlight shader: per-vertex group id -> LUT (primary/secondary/off), concentric pulse. MVP atlas: ~22 group regions seeded by dominant bone weight x normal direction, refined with landmark planes. v2: BodyParts3D heads on the figure.
3. **Props**: parametric, generic (no logos or brand silhouettes), with grip/contact sockets: barbell, plates, dumbbell, EZ bar, bench (0/30/45/-15), rack, cable stack + handles, pull-up/dip station, and ~12 machines in priority order: cable stack, leg press, leg extension/curl, lat pulldown/row, hip abduction/adduction, 45-degree back extension, chest press, pec deck, assisted pull-up, smith, calf. If lane C slips, v1 ships the first 4 and the rest move to v1.x.
4. **Motion**: ~25 templates (squat, hinge, lunge, horizontal press, incline press, vertical press, row, vertical pull, curl, triceps extension, lateral/front/rear raise, fly, calf raise, hip thrust, leg extension, leg curl, crunch, leg raise, dip, push-up, shrug, wrist curl, hip abduction/adduction, back extension, holds). Driver types: joint-space, implement-space (bar path keyed, arms by IK), root-space (hands/feet fixed). Balance solver keeps bar over midfoot. Tempo `[2, 0.2, 1, 0.5]` s, minimum-jerk easing, loop cut mid top-pause. Renderer-agnostic data (2D escape hatch).
5. **QA harness**: numeric gates on every frame (foot slip <= 5 mm, grip error <= 5 mm, joint limits, penetration, loop seam, IK-flip detector); orthographic side/front/top contact sheets + onion skins + hand/foot crops; fresh-context reviewer agent with a per-template checklist; owner approval in `qa.motion`.
6. **Rendering**: Playwright Chromium with `--use-angle=metal`, aborting unless the WebGL renderer string contains `Metal` (default headless uses SwiftShader). Deterministic `renderAt(t)`, `preserveDrawingBuffer`. Posters via `canvas.toBlob('image/webp')` with alpha (local ffmpeg has no libwebp). Loops via ffmpeg libx264 `yuv420p +faststart` on one fixed "media well" color shared by both themes. Bakes run locally, get content-hash names (body version + template + params + renderer version), and are committed; CI never renders.
7. **Delivery**: detail view renders live. Grid and add sheet show posters; grid loops (max 6 playing, IntersectionObserver, tap-to-play fallback for iOS Low Power Mode) come after M1. Loops and posters are cached on first use, not precached (catalog v2).
8. **Body map** (`bake-map.ts`): BodyParts3D 4.0 (CC BY 4.0) `isa` OBJs (143 MB zip, cached). Resolve FMA ids via the parts lists; render a whitelist of visible heads per side + skin silhouette, orthographic, flat ID colors, 2048 px, antialiasing off. Morphological open, drop slivers < 0.05% of body area, trace with d3-contour (marching squares) + simplify-js, dilate 1 px over the filled silhouette. Lats and rectus abdominis (absent from BodyParts3D) = uncovered skin inside our own hand-drawn polygon, traced in the same pass. Day-1 check: if arms hide serratus/obliques, rotate arm parts out ~15 deg. Also emit the ID rasters for hit-testing. Flat/gradient fills over a neutral silhouette, heat via CSS variables; mini maps use group regions via `<symbol>/<use>`.
9. **M1 cards**: each exercise's card = the mini map (the view showing its primaries) tinted primary/secondary + an equipment glyph. No 3D needed.

### Licensing and compliance rules
- **Allowed**: CC0 MakeHuman assets from pinned MPFB2 (copy LICENSE.md sections C/D + SHA to `licenses/mpfb2/`); CC BY 4.0 BodyParts3D with the verbatim credit "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International" + source URL + license URL + modification note, evidence (lic.html, README, Wayback URL, date, zip sha256) in `licenses/bodyparts3d/`, raw OBJs never committed (headers still show the old SA notice), `<!--! ... -->` credit comment in every shipped SVG; MIT/ISC/BSD/Apache/OFL code.
- **Build-only GPL tools** (Blender, MPFB2, FFmpeg/x264, resvg) are fine in `pipeline/`; their output isn't covered. Nothing GPL ships in `src/` or `public/`. Never ship an encoder.
- **Banned**: free-exercise-db images/text/tags; ExerciseDB/Gym visual GIFs; wger content; Z-Anatomy/fitmitwith (except an owner-approved S2 fallback, as separate SVGs with their license); Mixamo; SMPL/AMASS/Fit3D; HY-Motion; ExRx/MuscleWiki/Liftosaur mappings and any ExRx scraping; mannequin.js; blwsk code; MakeHuman community-site assets; 3D marketplace models, manufacturer CAD, logos; pose extraction from third-party videos; RepDB clips as motion reference; third-party anatomy images as tracing references (Gray's 1918 plates are fine).
- **Names**: generic primary names ("Nordic hamstring curl", "Reverse hyperextension", "Machine chest fly (pec deck)"); marks like Pendlay/Reverse Hyper/Nordic curl are search aliases only; no brand names. `/credits` says names are descriptive, no affiliation.
- **Cues**: 3-5 short imperative lines, LLM-drafted only inside our closed taxonomy, never prompted with third-party text. `pnpm test:cues` fails on any word 7-gram shared with free-exercise-db or wger text (fetched to gitignored `.cache/`, never in prompts) and on known boilerplate ("this will be your starting position").
- **Privacy**: no consent banner (localStorage + SW cache are strictly functional and stay on-device; ePrivacy 5(3) exemption, EDPB 2/2023). `/privacy` names the operator, Vercel as processor, what's stored locally, and that share links live in the URL fragment. Adding analytics later means revisiting this.
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

**Catalog v2 (owner, 2026-10-03)**: grow from 106 to ~300 (+194). Data first: new records ship as cards (`media.status: "card"`, `media.template: null`, intended template in the backlog `plannedTemplate` column), loops follow in family waves (tier A existing template and params, B new params or implement, C new template or prop). The 5 needs-work loops and the shared press grip fix land before any new loop. New equipment (appended to `CODEC_EQUIPMENT_V1`, never reordered): kettlebell, band, trap_bar, landmine, preacher_bench, rings, ab_wheel, ghd, t_bar, hack_squat, pendulum_squat, belt_squat. Presets: basic gym + kettlebell, band, trap bar, landmine, preacher bench, ab wheel; home gym + kettlebell, band, ab wheel, rings; bodyweight becomes "Bodyweight + small gear" (+ band, ab wheel, rings). Posters leave the precache and are cached on first view (an unseen one offline falls back to the map card); precache 4.1 of 8 MiB after the change. API search limit 400. Still out: Olympic lifts, kettlebell flows, kipping, carries. Target split: chest 36, shoulders 36, back 42, squat 36, hinge 42, calves 12, arms 54, core 42; the exact list lives in `docs/CATALOG-V2.md` and the owner approves it before records are written.

**v1.x motion fixes (lead, 2026-10-08)**: the 5 needs-work loops reworked; the owner re-approves them on /dev/review (qa.motion back to pending with a note each). Decisions:
- Press grip dropped (owner agreed): a bar seated lower in the palm (a derived grip site) raised the elbows a few cm but tilted the forearms 5-10 deg more and barely moved the bottom elbow angle. The press elbow depth stays as is.
- 707 close grip (gripWidth <= 1.1 on a flat barbell bench): touch on the low sternum (TOUCH_Y.close -0.10), wrist extension solved within 15-20 deg for a vertical forearm at the touch, holdArm adds front-view weight (CLOSE_FRONT 2). The press keeps the J, so mid-press forearm lean matches 101 (~37 deg). A path that held the forearms vertical made the bar rise straight then swing to the head, the reverse of a real J (skeptic), so it was dropped.
- 508 floor start: calibrated on the bar resting against the shins with the shoulders 3 deg (~4 cm) ahead of the bar (FLOOR_ARM 3, blended in after the bar passes the knees), not on the arms resting on the legs. Knee 64, ankle 8, knees over the bar; grip 1.2 -> 1.35 clears the knees from the arms. Hip flexion ~120 and the trunk ~18 deg above horizontal are set by the figure's arm length.
- 801: the spreading rope of the pushdowns (strands 0.45 m, leaving the fists 8 cm past the grip centre so they clear the thumbs); the crunch scene closes the hands on the fist pieces. The rope renderer now draws strands at their spec length and bends on to the fist when the exit is longer.
- 313 camera az -30 elev 0.2 (feet end), the half rack framed by its base; back.test checks the head as well as the hands for upright occlusion. 502 bench camera az -30 elev 0.12: glute_max reads at the bottom of the rep; at lockout it faces the bench. Owner call: accept, or a 502-only glute highlight boost (overrides the locked shorts tint).
- Owner approval (2026-10-08): all five approved, delegated to the lead; 502 keeps the new camera with no highlight override.
- Media hash includes the hero camera (pipeline/render/media.ts): media is served immutable, so a camera-only change kept its old URL and returning users kept the old loop. All 106 files renamed once; untouched loops render byte-identical.

**Wave 3a (lead, 2026-10-08)**: tier A motion for the v2 catalog. 48 of 65 animated (19 rated ok and live, 29 minor and pending on /dev/review with notes); 17 moved to tier B because they need a new prop, pose or schema change: 116, 117 (decline bench with leg hooks), 122 (incline machine lever arc), 135 (dumbbells pressed together), 233 (low-pulley rope between the legs), 319 (raised seal-row bench), 421 (one dumbbell held by its head), 732 (diamond hands: gripWidth below the 0.5 schema min), 735 (angled V-bar), 737, 740 (free-standing single-arm cable solves), 739 (incline skull crusher bench fit), 745 (EZ inner grip overhead), 748 (kneel-sit cable wrist curl), 826 (captain's chair station), 827 (topHipAngle cap 130), 831 (half-kneeling rope chop). Run as 5 lane authors plus one adversarial reviewer each and one repair round (no skeptic pair). Owner approval (2026-10-08): the 29 minor ones approved in bulk, so all 48 are live; findings stay in each qa.note for follow-up. No approved loop changed (bake --check fresh, media fresh, posters identical). Decisions, recommended option accepted:
- Tolerances, new variants only: hinge sumo (521) trunk/upper arm 16 mm at lockout and thigh/upper arm 28 mm at the floor; seated dumbbell calf raise (610) floor 42 mm (the existing forefoot rest value).
- Joint limit: reverse-grip pushdown (736) forearm supination to -94 (needs ~92.5 at the stretch; adult range 80-90+), scoped to straight bar + supinated.
- Poses: kneeling push-up (134) toes tucked with ankle df at its 40 deg stop; Bayesian curl (722) split stance; prone rear raises (230, 231) on a 45 deg bench (30-40 puts the thighs into the seat); prone neutral grip = T-raise (thumbs up). 429 resting leg tucked. 320 grip 1.25 (1.0 penetrates the trunk). Sumo stance 1.65 x shoulder width (ankle limit above that).
- Workarounds until a schema `attachment` param exists: cable shrug (336) column `bar_stack`, standing cable leg curl (540) `curl_stack` with an ankle strap in the legs-knee props, wide parallel pulldown bar (331) as `v_bar` + gripWidth > 1. Add the param in 3b and move these back to the shared stack.
- New camera branches for new variants only: rear-raise lying prone az 20 / 0.5, row and shrug Smith az -165 / 0.32, lunge Smith az -65 / 0.24, calf-raise Smith az -163 / 0.1, leg-curl standing cable az -125 / 0.2, hip-abduction side lying az -170 / 0.42, hinge sumo az -40 / 0.22.
- Follow-ups for 3b: TOUCH_Y steps from flat to incline at any benchAngle > 0 (a 15 deg bench gets the full incline touch, 123); 121 neutral press bake is slow (~30 s, lockout root over the wrist schedule; runtime ships the bake); EZ curls inherit full supination on the angled grip (701, 753); 747 bar sits 14-21 deg skewed in the fists; no gate checks that a declared resting hand touches its pad (330 free hand). Cue rewording: 423 "front foot slightly ahead of the bar" no longer matches the long Smith stance; 324 and 832 cues were reworded in EN and UK (UK unreviewed).

**v2 backlog**: BodyParts3D heads on the moving figure, female figure (same topology), ~300 exercises, secondary motion (breathing, head), optional fatigue-decay visual, workout logging, A/B day rotation (alternating sessions on the same weekday).

## Verification
- **Unit** (`pnpm test`): engine band edges at exactly 4/10/20/30 and fractional values; head shading; recovery gaps with cyclic wrap; overrides; primary-only mode; unilateral and duplicate entries; codec round-trip, retired-id decode, custom-exercise encoding; migrations. Taxonomy: each visible head has a path in every view its flag names, each deep head has a visible parent, each head belongs to exactly one group; every map group reachable by the ID-raster hit test.
- **Data**: every visible head has >= 1 active exercise where its group is primary and emphasis 1; every required banded group has an exercise in every equipment preset (gaps for smaller custom selections are computed from the catalog in `src/app/knownGaps.ts`); `alternatives` share pattern + primary group; every template x equipment preset fills every slot or drops it with a note.
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
