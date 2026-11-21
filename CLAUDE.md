# Tenset

No-backend, phone-first PWA: an exercise library with search, muscle / movement / equipment filters, a language picker and baked demo loops. On 2026-11-21 the planner (programs, body page, settings, share/export, welcome flow) and the `api/` MCP endpoint were removed; `docs/PLAN.md` still holds content, motion and media rules, but its planner scope is historical.

## Stack
Vite 8, React 19, TypeScript 6, Tailwind 4, TanStack Router (file routes in `src/routes`), Zustand + zod, three/R3F (lazy chunk only), Vitest, Playwright. pnpm. Node 24 runs `pipeline/*.ts` directly (type stripping, so no enums or namespaces).

## Layout rules
- `src/domain/` is pure TS, no React, no DOM. All volume/coverage math lives here with tests.
- `data/` is the content source of truth: `taxonomy.json` (frozen, changes by PR only), `exercises/<id>-<slug>.json`, `splits/*.json`, `backlog.csv` (the only work queue), `sources.json` (citation ids used in `basis`).
- `pipeline/` is build-time only and never imported by `src/`. GPL tools (Blender, MPFB2, ffmpeg) may be used there as tools; never port their code.
- Contracts: `src/domain/schema.ts`. Don't change a schema another lane depends on without updating all users.

## Content rules (hard)
- Never use or copy: free-exercise-db (images, text or muscle tags), ExerciseDB / Gym visual GIFs, wger content, Z-Anatomy / fitmitwith, Mixamo, SMPL/AMASS/Fit3D, HY-Motion, ExRx / MuscleWiki / Liftosaur mappings, mannequin.js, blwsk/exercise-animations code, 3D marketplace models, brand names or logos.
- Allowed third-party assets: MakeHuman/MPFB2 CC0 assets (pinned commit), BodyParts3D CC BY 4.0 (with credit). Code deps must be MIT/ISC/BSD/Apache/OFL.
- Exercise cues are original, 3-5 short imperative lines. Never paste third-party instruction text into prompts or files.
- Every string has English and Ukrainian. UI copy lives in `messages.ts` next to each feature; content translations in `data/i18n/uk/` keyed by source ids (cues: same count as English, translated from our own cues only). Rules and glossary: `docs/I18N.md`.
- Muscle roles: `groups` (primary 1.0 / secondary 0.5) drive bands; `heads` is emphasis inside listed groups. Every exercise cites `basis` ids from `data/sources.json`; use `confidence: low` when no study backs a call.
- Copy tone: neutral. Recovery is information only: no warning colors, no "risk", "too soon", "overtrained". ("No warning colors" is about recovery and volume states; categorical movement-group pastels on exercise surfaces are fine, see `DESIGN.md`.)
- No runtime requests to third-party origins (no CDN fonts, drei presets, matcaps, Draco CDN).

## Style
- Comments minimal, only where genuinely needed. No em-dashes in user-facing copy.
- Match surrounding code. Small focused modules.

## Commands
`pnpm dev`, `pnpm test` (fast unit suite), `pnpm test:motion` (re-bakes and judges every animation loop, minutes of CPU; run it when touching `src/motion`, figure motion, `pipeline/motion` or exercise `media`), `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm e2e`.
