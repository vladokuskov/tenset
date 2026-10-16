# Movement Colors in Tenset

## Context
The owner picked the "Movement Colors" direction from the style preview (`docs/redesign/movement-colors.html`). The idea: each exercise is colored by its movement group (push, pull, shoulders, arms, legs and hips, core, from `PATTERN_GROUPS` in `src/features/catalog/patterns.ts`), so a day or week shows its balance at a glance. Volume keeps the cobalt scale and stays the only color on the body map.

Decisions already made:
- Merge the Instrument graphite palette, colors only.
- Keep the system fonts.
- Cover both the app screens and the exports.
- Custom exercises (which have no pattern) get a neutral "Other" tile.

The work runs as a multi-agent Workflow (the user asked for one), on a local branch. Nothing gets pushed, because `main` auto-deploys to Vercel.

## Branch and setup
- New worktree at `/private/tmp/claude-501/tenset-wt/movement`, on branch `feat/movement-colors`, cut from `main` (3c22ca1).
- The uncommitted `e2e/a11y.spec.ts` change on main is the owner's. Leave it alone and don't carry it over.
- Surface agents get their own task branches (`mv/<lane>`) in sibling worktrees. The integrator merges them into `feat/movement-colors`.

## Stage 1. Foundation (one agent, sequential, everything else builds on it)
1. **Instrument colors, without its fonts.** From 13dadcd, port:
   - the color tokens in `src/styles/app.css` (`@theme` plus both dark blocks)
   - the theme colors in `index.html` and the manifest in `vite.config.ts`
   - the `font-num` class swaps in MuscleSheet, CoverageCard and SharedPreview, resolved by hand against main's reworked files

   Skip the `@fontsource` packages, font imports and font license text. `--font-num` falls back to the system stack, with `font-variant-numeric: tabular-nums` and `font-stretch: condensed`.
2. **Movement tokens.**
   - Light values go in `@theme static` after `--color-role-secondary`: `--color-mv-push`, `-pull`, `-shoulders`, `-arms`, `-legs`, `-core`, `-other` (neutral), plus `--color-mv-ink`. Dark ink stays dark in both themes, which keeps axe color-contrast passing.
   - Toned-down dark values go in **both** dark blocks, and the two blocks must stay identical.
   - Values come from the preview (`#C7B8FF`, `#8EDDB6`, `#93D3F2`, `#FFADC8`, `#FFB680`, `#FFDF78`; dark set `#B9A8FA` and so on). Convert them to oklch to match the file's style.
3. **Domain mapping.**
   - Move the pattern to group table into `src/domain/movement.ts`: `MOVEMENT_GROUPS`, `movementGroupOf(pattern: Pattern | null): MovementGroupId | 'other'`, and `movementMix(entries)` giving sets per group.
   - `src/features/catalog/patterns.ts` re-exports these, so the CatalogPage and AddSheet users keep working.
   - Move the existing catalog test that checks every pattern is in exactly one group to the domain, and add tests for the mix.
4. **Week data.** Add `mix: Record<MovementGroupId | 'other', number>` to `DaySummary` in `src/app/useWeek.ts` (from `week.entries` grouped by day), plus a week-level mix.
5. **Shared UI pieces** (in `src/ui/`, so features import them without crossing a boundary):
   - `MovementMix`: a stacked bar with `size: 'thin' | 'big'` and an optional legend with counts. The legend makes it accessible: an `aria-label` reads "Push 12 sets, Pull 11 ...". Text labels mean color is never the only cue.
   - `MovementSwatch`: a dot or square with a label.
   - Group labels for "Other" and the legend go in messages, en and uk (`movementOther`, `movementMix`, `byMovement`).
6. **Docs.** Rewrite the One Data Hue and No Alarm rules as: "Volume is the only color on the body map and volume legends. Movement groups get categorical pastels on exercise surfaces only, always with `mv-ink` text and a text label, never on volume data. No warning semantics."
   - Files: `DESIGN.md`, `.impeccable/design.json` (colorMeta, rules, donts), `PRODUCT.md`, `docs/PLAN.md:54`, `docs/UI-CONTRACTS.md` (token list, color rules), and one line in `CLAUDE.md` saying "no warning colors" is about recovery.
   - `DESIGN.md` and `PRODUCT.md` are untracked on main. Add them on this branch.
7. Gate: `pnpm typecheck && pnpm lint && pnpm test` green, then commit.

## Stage 2. Surfaces (four agents in parallel, each on its own worktree from the foundation commit)
Shared rule: filled surfaces use `bg-mv-<g>` with `text-mv-ink`. Thumbnails are a white tile with a 3px ring or frame in the group color. **No blend modes**, so the figure keeps its true colors (the owner flagged the purple-tinted figure).

- **A. Builder**
  - `builder/EntryList.tsx`: filled rows. Replace `divide-y` with `gap-2`. The stepper and reps controls sit on translucent white. Superset and drag states must still read.
  - `builder/WeekBoard.tsx`: `BoardCard` and `DragCard` filled. The lit and dim rings must still be visible on fills. A thin `MovementMix` goes in the column header.
  - `builder/WeekList.tsx` rows: thin mix bar.
  - `builder/DayScreen.tsx` day chips: a 3px mix bar under the count, plus filled rest-day leftovers.
  - `PickRow`, `AddSheet` AddPreview and `desktop/CatalogDrawer` rows: ring thumbnail and a group dot.
  - Plan screen: a "Movement mix" panel with the big bar and legend.
- **B. Catalog**
  - `catalog/ExerciseCardMedia.tsx` is the single thumbnail path. Group ring for sm and md, colored frame for lg.
  - `ExerciseRow`: update `ROW_H` in `ExerciseList.tsx`.
  - `ExerciseCard`: update `TEXT_H` in `ExerciseGrid.tsx`.
  - `ExerciseDetail`: hero in a colored frame with a "Push · Horizontal push" label at line ~145. Check whether the `ExerciseMotion` `WELL` should stay white inside the frame.
  - `CatalogPage`: movement filter chips tinted by group, with the selected chip filled and an ink dot.
- **C. Body and insights**
  - `routes/body.tsx` page: a "By movement" panel (swatch, label, sets, bar) under the map. Week and day scopes follow the existing chips.
  - `bodymap/DeskMapPanel` (desktop side panel): movement mix block.
  - Keep the body map and legends purely cobalt.
- **D. Exports and share**
  - `export/image.ts`: add `group` colors to `Palette`, `FALLBACK_PALETTE` hex values and the token map, a `fill` DrawOp, colored row backgrounds in `layoutDay`, and mix bars in `layoutWeek`. Canvas text on fills uses fixed dark ink.
  - `imageContent.ts` and `planText.ts`: `group?` on `EntryText`, `mix` on week rows.
  - Update `image.test.ts`.
  - `PrintPage`: a group swatch dot per row (no fills, to save ink).
  - `GymSheet`: swatch dot.
  - `share/SharedPreview`: resolve through `exerciseFor`, group dot per entry, mix bar per day. Unknown ids fall back to "Other".

Every lane: en and uk strings for any new copy, no em-dashes, minimal comments, its own unit tests where logic changes, and `pnpm typecheck && pnpm lint && pnpm test` green before committing to its lane branch.

## Stage 3. Integrate and verify (one agent)
- Merge lanes A to D into `feat/movement-colors` and resolve conflicts (likely `messages.ts` and `app.css`).
- Run the full gate: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm e2e`. The e2e run includes `a11y.spec.ts` (axe light, dark, uk), `csp.spec.ts`, and knip via lint if configured.
- Screenshots with Playwright using system Chrome (`channel: 'chrome'`, since the bundled browser isn't installed): phone 390x844 and desktop 1440 wide, light and dark, of Plan, Day, Body, Exercises, Exercise detail and the desktop board. Also the exported PNG and the print view. Save them to the scratchpad.

## Stage 4. Review and fix (two agents)
- **Reviewer.** Compares the screenshots against `docs/redesign/movement-colors.html`. Checks:
  - contrast on every pastel in both themes
  - the figure is never tinted
  - the cobalt map is untouched
  - 44px targets on the new chips and controls
  - Ukrainian strings fit at 320px
  - layering (domain stays pure, the boundaries test passes)

  Returns verified findings.
- **Fixer.** Applies them on the branch and re-runs the gate.

The Workflow ends there. I report back with the screenshots and the test results. Nothing is pushed or merged to main without the owner.

## Critical files
`src/styles/app.css`, `index.html`, `vite.config.ts`, `src/domain/movement.ts` (new), `src/features/catalog/patterns.ts`, `src/app/useWeek.ts`, `src/ui/MovementMix.tsx` (new), `src/features/builder/{EntryList,WeekBoard,WeekList,DayScreen,PickRow,AddSheet}.tsx`, `src/features/builder/desktop/CatalogDrawer.tsx`, `src/features/catalog/{ExerciseCardMedia,ExerciseRow,ExerciseList,ExerciseCard,ExerciseGrid,ExerciseDetail,CatalogPage}.tsx`, `src/routes/body.tsx`, `src/features/export/{image,imageContent,planText,PrintPage,GymSheet}.ts(x)`, `src/features/share/SharedPreview.tsx`, plus the docs listed in Stage 1.

## Verification
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e` green on `feat/movement-colors`.
- New unit tests: `movementGroupOf` is total over all patterns, `movementMix` sums with custom exercises counted under "Other", `DaySummary.mix` per day, and PNG layout with fills.
- axe color-contrast passes in light, dark and uk.
- Visual pass: the screenshot set matches the preview (filled entries, ringed white thumbnails, mix bars, cobalt-only map).
- Manual check by the owner: `pnpm dev` in the worktree.
