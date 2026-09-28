# Template families: parallel motion authoring

Nine family agents author the remaining 25 motion templates in parallel. The owner said the first 24 loops "look perfect", so every new exercise keeps that motion language. This guide covers the family map, what each family owns, the extension points, the rules for shared files, the definition of done, camera and framing, how to add an implement, prop or grip, and every command.

## Motion language (keep it)

- **Figure**: the same body (`public/models/body.glb`, `data/motion-templates/skeleton.json`), materials, atlas and white studio. Don't touch `RENDER` in `pipeline/render/media.ts`, `material.ts`, `Studio.tsx` or the body assets.
- **Tempo**: `DEFAULT_TEMPO = [2, 0.2, 1, 0.5]` s (eccentric, bottom pause, concentric, top pause), minimum-jerk easing per phase, loop cut mid top pause (`src/motion/timing.ts`). Leave `params.tempo` unset unless the lead decides otherwise.
- **Highlight**: primary and secondary groups come from the record, the concentric pulse is automatic (`compose.ts pulseAt`), and unilateral work highlights the working side only.
- **Camera**: elevated three-quarter hero view, framing margin >= 6 %, equipment bases in frame (see Camera and framing).
- **Props**: generic, in the approved style: light powder-coated frames (`frame`, `frameDark`), black pads and rubber (`pad`, `rubber`), steel and knurl, the dark gray `mat`. No logos, no brand silhouettes, no third-party assets or motion data.
- **Research**: joint-angle ranges per template and the literature behind them are in the motion-authoring research (the workflow output JSON, `result.research[]` entry with key `"motion-authoring"`). Key ranges go in template comments where they drive keyframes, and into unit tests.

## Family map

Checked against `data/exercises/*.json` by `src/motion/families.test.ts`: every id's `media.template` matches, and no record of a family template is left out. The map is also in code (`src/motion/families.ts`), so tools take `--family F1` or `--family press-horizontal`.

| Code | Family | Templates (exercise ids) |
|---|---|---|
| F1 | press-horizontal | horizontal-press (101, 107, 108, 707), incline-press (102, 103, 109) |
| F2 | press-vertical-bodyweight | vertical-press (201, 202, 208, 212), dip (104, 718), push-up (106, 113, 114, 115) |
| F3 | chest-shoulder-isolation | fly (105, 110, 111, 112), front-raise (207, 209), rear-raise (205, 210, 213), external-rotation (211, 215) |
| F4 | back | row (206, 304, 305, 306, 307, 312, 313, 315), shrug (308, 314) |
| F5 | legs-knee | lunge (403, 409, 410, 411), leg-extension (404, 412), leg-curl (503, 504, 512) |
| F6 | legs-hip-calf | hip-abduction (506, 507, 514, 515), calf-raise (601, 602, 603, 604, 605, 606) |
| F7 | hinge | hinge (501, 508, 509, 510, 513), hip-thrust (502, 511), back-extension (505) |
| F8 | arms | triceps-extension (704, 705, 706, 715, 716, 717), wrist-curl (708, 709) |
| F9 | core | crunch (801, 805), leg-raise (802, 806, 807), hold (803, 804, 808), rotation (809) |

The approved S1 templates (squat, lateral-raise, vertical-pull, curl) belong to no family. Their 24 loops are the reference and must not change.

## What a family owns

For family `<family>` with templates `<t>`:

| File | What goes there |
|---|---|
| `src/motion/templates/<t>.ts` | the template (setup, sample, `implemented: true`), its joint-limit and tolerance overrides |
| `src/motion/templates/<t>.test.ts` (new) | unit tests for the template |
| `src/features/figure/motion/scenes/<t>.ts` | camera, grip choice, highlight tweak, template-specific equipment |
| `src/motion/implements/<family>.ts` | implement factories (ImplementSpec geometry), new kinds |
| `src/features/figure/props/families/<family>.ts` (+ new files under `props/families/<family>/`) | prop builders, sockets, layouts, collision primitives |
| `src/features/figure/grips/<family>.ts` | extra hand shapes |
| `data/exercises/<id>-*.json` for your ids | `media.params` within the strict schema (not `media.status`, not `qa.motion`) |
| generated for your ids | `src/features/figure/motion/baked/<id>-*.json`, `public/media/{loops,posters}/<id>-*`, their manifest entries |
| `qa/out/<code>/` | your QA output (use `--out` / `--qa`, see Commands) |

Every registry already imports every module statically: `src/motion/templates/index.ts` (29 templates), `scenes/index.ts` (29 scenes), `props/families/index.ts`, `grips/index.ts` and `src/motion/implements/index.ts` (9 families plus `shared`). A family never needs to edit a registry.

## Extension points

| Need | Where | Picked up by |
|---|---|---|
| Motion | `templates/<t>.ts`: replace `pendingTemplate(...)` with a `Template` (see `squat.ts`, `curl.ts`), set `implemented: true` in the module | `TEMPLATES`, QA, bake, live preview |
| Joint-limit exception | `setup.limits` in the template (`{ 'wrist_l.flex': [-90, 75] }`, as the front-rack squat does). Pass the same wrist/forearm entries to `attachHand(..., { limits })` when the IK must respect them | the joint-limit gate and the hand solver. Never edit `skeleton.ts` |
| Intended resting contact | `setup.rests` (`{ implement, regions, tol }`), negative tol = required clearance | the body-prop gate |
| QA tolerance exception | `setup.tolerances = { body: { 'forearm / head': 8 }, floor: 8 }`, keyed by the pair label the gate prints | the penetration gates. Each one is a lead decision |
| Balance | `setup.balance` (com or implement over midfoot or sites) | the balance gate |
| Camera, grips, highlight | `scenes/<t>.ts` `SceneSpec`: `camera(params, mapView)`, `grip(ctx)`, `highlight(base, ex, params)` | `compose.ts` |
| Template-only equipment | `SceneSpec.layouts(b)` returning `MachineLayout[]` | composer (drawn) and QA (collided) |
| Implement geometry | `src/motion/implements/<family>.ts`: factories, `KINDS` (new kinds), `MOVING` (kinds held and moved by the hands) | `ImplementKind`, the equipment-equipment gate, framing |
| Drawn props | `props/families/<family>.ts`: `layouts(b)` plus builders and sockets | composer (drawn) and QA (collided), from the same objects |
| Hand shapes | `grips/<family>.ts`: `GRIPS = { name: { diameter, wrap } \| { diameter, posed } }` | `hands.ts` (`GripName`, solver) |

Shared supports are ready (`src/motion/implements/shared.ts`, drawn by `props/families/shared.ts`, shown in the props gallery `?scene=props-shared`):

- `plyoBox({ height })`: 20, 30 or 45 cm, 60 x 45 cm footprint, rubber tread (padded), sites `top`, `front` and `back` (top edges, axis along the edge). Local origin on the floor under the top centre, +Z front.
- `floorMat()`: 1.8 x 0.6 m, 1 cm, dark gray, padded, site `top`, length along Z.
- `wallSection()`: 1.0 x 2.1 m panel with a skirting board, face in the plane z = 0 facing +Z, site `face` (1 m up).
- `flatBench({ seatHeight })`: the adjustable bench with the back pad flat. The composer draws it as the adjustable bench (`Bench.tsx`, back 0).

Put an implement of one of these kinds in `setup.implements` and pose it every frame. The composer draws it and the gates collide with it; nothing else is needed.

## Shared files: rules

- Prefer your own files. When you must touch a shared file, re-read it immediately before a small targeted Edit, keep the edit additive, and never reformat. Never rewrite a shared file wholesale with Write.
- Never edit `package.json`, `pnpm-lock.yaml`, `data/taxonomy.json`, `src/domain/schema.ts`, `CLAUDE.md` or `docs/PLAN.md`.
- Ask the lead first (then a small additive edit): `src/motion/templates/schemas.ts` / `params.ts` (param schema), `pipeline/motion/gates.ts` (thresholds; use `setup.tolerances` instead), `src/features/figure/props/materials.ts` (a new material), core grips in `hands.ts`, `compose.ts`, `collision.ts`, `views.ts`, and camera changes to approved templates.
- Shared helpers (`standing.ts`, `arms.ts`, `constraints.ts`, `ik.ts`, `fk.ts`, `collide.ts`, `skeleton.ts` helpers): additive only. Prove the approved 24 are untouched with `node pipeline/motion/bake-motion.ts --check` (all fresh), `node pipeline/motion/qa.ts --out qa/out/<code>/s1` (24/24) and, if the change reaches rendering, `node pipeline/render/verify-posters.ts` (all identical).
- `data/backlog.csv`: only your rows, one targeted Edit at a time.
- Never write the shared `dist/` (`pnpm vite build --outDir <scratch>`). No git commit, stash or checkout. Never kill processes you did not start. `still.ts` and `bake-loops.ts` start their own dev server on the first free port from 5190 / 5191, so each run gets its own port.
- Never run `BAKE_MOTION=1 pnpm vitest ...` (it re-bakes and deletes across families) or `bake-loops.ts` without `--only` / `--family` (a full run prunes, lead only).
- `pnpm test` also sees other families' work in progress: `bake.test.ts` wants a baked file for every implemented template's records, and `compose.test.ts` frames every baked loop. A red caused by another family's ids is theirs. Run your own tests plus the suites that touch your files.

## Definition of done (per exercise)

1. **Template implemented**: `implemented: true`, every record of the template samples (unsupported variants throw `variant not implemented yet` with a reason).
2. **Params parse**: the record's `media.params` pass the strict schema (`pnpm vitest run src/motion/params.test.ts`).
3. **QA gates green, penetration included**: `node pipeline/motion/qa.ts --only <id> --out qa/out/<code>/motion` passes every gate (contacts, limits, flips, seam, symmetry, balance, size, penetration body-body, body-prop, body-machine, equipment-equipment, body-floor, shipped bake).
4. **Compact motion baked**: `node pipeline/motion/bake-motion.ts --only <id>`, and QA's "shipped bake matches template" passes.
5. **480 px figure sheet reviewed**: `node pipeline/render/still.ts --out qa/out/<code>/figure --motion <id>` (hero) plus one `--view side` or `--view front` sheet. Checklist: same figure and studio, tempo reads (slow eccentric, quick concentric), pulse on the primaries, camera shows the primaries and the grips, margin >= 6 % with equipment bases in frame, hands closed on handles, feet flat and still, no visible penetration, bar or handle path plausible.
6. **Unit tests**: `src/motion/templates/<t>.test.ts` in the style of `squat.test.ts` and `curl.test.ts`: key angles at top and bottom inside the research ranges, contacts held, every family record covered, unsupported variants throw.
7. **Loops** (when the lead says so): `node pipeline/render/bake-loops.ts --family <code> --qa qa/out/<code>/loops`, then `node pipeline/render/check-media.ts --family <code>` fresh. Manifest writes merge under a lock, so families can bake in parallel.

Leave `media.status` and `qa.motion` alone: the lead flips them after the adversarial review (sign-off rule in `docs/PLAN.md`). Report any tolerance override, schema change, new material or camera exception as a lead decision with your recommended option.

## Camera and framing

- Axes: the lifter faces +Z, +X is the lifter's left, the floor is y = 0.
- `CameraPreset.az`: degrees round the figure, 0 = in front, negative = towards the lifter's right, 180 = behind. `elev`: vertical component of the view direction (0.2 is about 12 deg, 0.3 about 17 deg).
- Default (pending scenes): mapView F gives `{ az: -35, elev: 0.3 }` (front three-quarter), B gives `{ az: -145, elev: 0.2 }` (rear three-quarter).
- Approved, don't change: curls -35 (cable -60), lateral raises -14, pull-ups and chin-ups -145 (neutral grip -125), pulldowns -118, squats -128 rear three-quarter (goblet -115, Smith -163, front squat -40, leg press -112).
- Pick the view where the primaries read and the equipment does not hide the hands or feet. Put the reason for any non-default camera in a one-line comment in the scene module.
- Framing: `MotionStage` fits the frame points with a 6.5 % margin (`frameFitMargin`), and `compose.test.ts` checks >= 6 % for every baked loop. Frame points are the body capsules over the loop, held implements, template implement pads, pull-up bars, benches and sleds. Drawn machines add their floor parts (below 0.25 m) and plates. A layout with `whole: true` is framed base to top (stations you hang from or reach up to).

## How to add

**An implement** (`src/motion/implements/<family>.ts`): return an `ImplementSpec` with parts (cylinders and boxes, `pad: true` for padded surfaces), sites (`axis` along a handle for grips, little finger to index; `normal` for surfaces) and a kind. Add new kinds to `KINDS`, and kinds the hands carry to `MOVING`. Contact surfaces must match the drawn prop exactly, so share the dimensions as exported constants (as `PLYO_BOX` and `SKIRTING` do).

```ts
export const KINDS = ['dip_station'] as const
export const MOVING: readonly string[] = []
export function dipStation(o: { id?: string; width: number; height: number }): ImplementSpec { ... }
```

**A prop** (`src/features/figure/props/families/<family>.ts`): build it with `Kit` (`box`, `tube`, `rod`, `plate`, `wheel`, `knob`, ...) in the props materials, return sockets (`GripSocket`, `SurfaceSocket`), and add a layout. Collision primitives come from the pieces by material (frame, rail, stack, plate, pad; flat rubber faces count as pads). Give `colliders` explicitly only when the pieces are a poor fit. Check it in the gallery (`still.ts --scene x=props-<name>`) if you add a gallery scene (an additive edit to `props/scenes.ts`), or in the figure sheet.

```ts
export const layouts: LayoutSource = (b) => {
  const pose = firstPose(b, 'station')
  return pose ? [fixedLayout('dip-station', poseMatrix4(pose), buildDipStation().pieces, { holds: ['station'], whole: true })] : []
}
```

For moving parts use a full `MachineLayout` (`fixed: false`, `build(poses)`, `solid(poses)` without the held handles, `holds`), as `collision.ts machineLayouts` does for the cable stack.

**A grip** (`src/features/figure/grips/<family>.ts`): a wrap closes every finger onto a handle; a posed shape (flat palm, cupped palm, fist) rests on or against something. Names are global, and a test fails on duplicates.

```ts
export const GRIPS = {
  'flat-palm': { diameter: 0.033, posed: { mcp: [-6, -6, -6, -6], pip: [4, 4, 4, 4], dip: [2, 2, 2, 2], spread: 0.5, thumb: { bone: 'finger2-1', at: 0.3, radial: 0.02, palmar: 0 } } },
} satisfies Record<string, GripDef>
```

Then choose it in the scene module: `grip: (ctx) => (ctx.spec.kind === 'dip_station' ? 'neutral' : undefined)`. Without a hook the composer's rule applies (front rack hook, goblet cup, rope, D-handle, the params' grip).

## Commands

| What | Command |
|---|---|
| QA (gates, clearances, angle plots, stick sheets) | `node pipeline/motion/qa.ts --family F1 --sheet --out qa/out/F1/motion` (or `--only 101,107`; works before `implemented` is flipped; merges into `report.json`) |
| Stick sheets only | `node pipeline/motion/stick-sheet.ts --family F1 --out qa/out/F1/motion` |
| Bake compact motion | `node pipeline/motion/bake-motion.ts --only 101,107` (`--check` compares only) |
| 480 px figure sheets | `node pipeline/render/still.ts --out qa/out/F1/figure --motion F1 --live` (`--live` bakes in the browser from the current templates; `--view side`, `--yaw 20`, `--mfocus wrist_R:0.3`) |
| Props gallery still | `node pipeline/render/still.ts --out qa/out/F1/props --viewport 390x480 --scene shared=props-shared` |
| Loops and posters | `node pipeline/render/bake-loops.ts --family F1 --qa qa/out/F1/loops` |
| Stale media | `node pipeline/render/check-media.ts --family F1` (no flag: all exercises, lead) |
| Approved renders untouched | `node pipeline/render/verify-posters.ts` (re-renders poster frames, byte compare) |
| Unit tests | `pnpm vitest run src/motion/templates/<t>.test.ts src/motion/families.test.ts src/features/figure/motion` |
| Types, lint | `pnpm typecheck`, `pnpm lint` |
| Build check | `pnpm vite build --outDir <scratch dir>` |
