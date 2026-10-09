# Handoff (2026-10-01)

## Project
Tenset (repo `gym-builder`): no-backend, phone-first PWA for planning a weekly gym program, with a head-level body map, and every exercise animated by our own procedural 3D figure (illustration style: gray muscular figure, red/orange muscle highlights, white background).
- Repo: ~/projects/gym-builder (its own git repo; `~` is a separate repo). Remote: private github.com/vladokuskov/gym-builder.
- Deployed on Vercel from `main` (every push deploys): https://gym-builder-nine.vercel.app
- Source of truth: `docs/PLAN.md` (scope and every decision), `docs/FAMILIES.md` (motion families, extension points, gates, definition of done), `CLAUDE.md` (hard rules), `README.md` (commands and deploy).

## Owner decisions that must hold
- All media generated in-house and license-clean (banned-source list in CLAUDE.md).
- The approved motion language holds for every exercise (the owner called the first 24 loops "perfect"): tempo, highlight pulse, cameras, framing >= 6%.
- Recovery info is neutral, never warnings. v1 = planner + split templates, no logging.
- Sign-off rule: exercises rated "ok" after an adversarial review are auto-approved (qa.motion "approved", media.status "loop"); "minor" and "needs work" go to the owner on /dev/review. Production shows animations only for approved exercises.
- The owner delegated decisions: accept the recommended option and record it in docs/PLAN.md.

## State
- Polish pass (2026-10-09, branch feat/polish): new QA gates, all 298 animated loops pass. 316, 427 and 730 are animated and pending owner review; 532 and 535 stay cards. Catalog review applied with 12 verified citations.
- 2026-10-09: the owner approved every pending loop from waves 3b and 3c, so 295 of 300 exercises are animated and live. The 5 cards are 316, 427, 532, 535 and 730.
- Wave 3c (2026-10-09, branch feat/motion-3c): 66 more animated (295 of 300). 30 approved, 36 pending owner review on /dev/review. Cards left: 316, 427, 532, 535, 730.
- Wave 3b (2026-10-09, branch feat/motion-3b): 75 more animated (229 of 300). 34 are approved and live, and 41 are pending owner review on /dev/review. The remaining 71 cards are 13 3a leftovers needing props, 4 3b deferrals and the 54 tier-C exercises.
- Wave 3a (2026-10-08, branch feat/motion-3a): 48 of the 65 tier-A v2 exercises animated, so 154 of 300 have motion. All 48 are approved and live: 19 rated ok by the review, plus 29 rated minor that the owner approved in bulk. The findings stay in each qa.note. The other 146 are still cards: 17 deferred from tier A plus all of B and C (see PLAN.md "Wave 3a").
- All 106 exercises have a compact motion, a baked loop and a poster. Motion QA 106/106, media fresh, unit tests 1067/1067, e2e 71 passed (11 skipped by design), typecheck and lint clean, cue and license checks pass, precache 3.8 of 8 MiB.
- Approved and live: 57 (22 from before plus 35 from the 2026-10-01 family review). Pending owner review: 49 (5 needs work: 313, 502, 508, 707, 801; 42 minor; plus 402 and 407). Each pending record's qa.note holds the findings.
- Family review (2026-10-01): one reviewer plus two independent skeptics (biomechanics, visual) per family, one repair round, global regression. All decisions are in PLAN.md under "Family review decisions". New gates: shoulder horizontal abduction and lateral balance.
- List cards show the poster where the motion may show. `vercel.json` sets CSP, caching and the SPA rewrite (verified on the live site). The privacy page names Vercel as the hosting processor.
- Release pass: Lighthouse accessibility and best practices 100 on Plan, Exercises and detail; performance 90 and 88 on Plan and Exercises. The detail page scores 38 in headless Lighthouse only because it renders WebGL in software; on the Metal GPU the worst main-thread task is 90 ms (300 ms at 4x CPU throttle).

## Owner-only
- Review the 49 pending exercises on /dev/review (`pnpm dev --host`, filter "pending").
- Real-phone test: iPhone Safari tab and Home Screen (Low Power on and off), a mid-range Android. Pass: detail figure >= 55 fps, map and mini maps without jank, airplane-mode offline works.
- Employment-contract IP clause; trademark knockout on the product name (USPTO / EUIPO / UKIPO).
- Operator name and contact for /privacy (set `OPERATOR` in `src/routes/privacy.tsx`; production shows a neutral line until then).
- Add a LICENSE file (MIT code, CC BY 4.0 data and media) before the repo or app goes public under that license.
- Vercel Hobby is non-commercial.

## v1.x backlog (from the review)
- Flat-palm and toes collision capsules, so the hand and forefoot allowances can shrink to a few mm.
- The 5 needs-work exercises were reworked on 2026-10-08 (PLAN.md "v1.x motion fixes"); approved 2026-10-08. The press grip idea was measured and dropped.

## Working notes
- Long agent commands must stream progress (the harness kills agents silent for 3 minutes). Account session limits can stop workflows; resume from the journal.
- Parallel agents: own disjoint paths, use scratch `--outDir` for builds and separate ports, never `git stash`.
- Rendering needs Playwright Chromium with `--use-angle=metal` (default headless uses SwiftShader).
- In zsh, never name a shell variable `path` (it is tied to PATH).
