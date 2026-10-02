# UI contracts

The UI foundation that feature agents build on. `docs/PLAN.md` stays the source of truth for scope; this file pins the shared pieces so parallel agents do not collide. Change a contract here and in its `index.ts` together, and tell the other owners.

## Ownership

| Area | Owner | Files |
|---|---|---|
| Design system, primitives, shell | foundation (lead after handoff) | `src/styles/app.css`, `src/ui/*`, `src/app/*`, `src/routes/__root.tsx`, `index.html`, `public/favicon.svg`, `public/icons/*` |
| Body map, mini maps, legend, muscle sheet, coverage | bodymap agent | `src/features/bodymap/*`, `src/routes/body.tsx` |
| Catalog grid, cards, rows, exercise detail | catalog agent | `src/features/catalog/*`, `src/routes/exercises.tsx`, `src/routes/exercise.$slug.tsx` |
| Plan, day, add sheet, programs, first run | builder agent | `src/features/builder/*`, `src/routes/index.tsx`, `src/routes/day.$dow.tsx`, `src/routes/welcome.tsx` |
| Not yet assigned | lead decides | `src/routes/shared.tsx`, `src/routes/settings.tsx`, `src/routes/credits.tsx`, `src/routes/privacy.tsx`, `src/routes/about.tsx` |

Proposed split; the lead confirms. Each route file currently holds a working placeholder marked with `<Placeholder owner="...">`. Delete the marker when the screen is built.

## Design tokens (`src/styles/app.css`)

Clay and cobalt. Warm-gray surfaces sit with the clay mannequin, cobalt is the only data color, brass marks interactivity.

- Surfaces: `canvas` (page), `surface` (grouped panels), `surface-2` (wells, tracks, tonal buttons), `raised` (sheets), `thumb` (segmented thumb).
- Lines: `line` (hairlines), `line-strong` (control borders).
- Text: `ink`, `ink-2` (secondary), `ink-3` (tertiary, placeholders), `on-ink` (on ink fills).
- Accent: `accent` (focus ring, current tab, links, toast action), `accent-soft`, `on-accent`. Use it sparingly; primary buttons are `ink`, not accent.
- Map: `map-skin` (silhouette), `map-gap` (region separators).
- Volume scale, single hue, lightness only, retuned for dark mode (darker means more in light mode, brighter means more in dark mode): `vol-none`, `vol-light`, `vol-moderate`, `vol-target`, `vol-high`, `vol-very-high`. Role tints for exercise cards: `role-primary`, `role-secondary`.
- All tokens are Tailwind colors (`bg-surface`, `text-ink-2`, `fill-vol-target`) and CSS variables (`var(--color-vol-target)`). Tailwind's default palette is removed on purpose: no `red-500`, no warning colors anywhere.
- Type: `system-ui`, tabular numbers everywhere (`num` utility for emphasis). Scale: `text-xs` 12, `text-sm` 13, `text-base` 16, `text-md` 17, `text-lg` 20, `text-xl` 24, `text-2xl` 30, `text-display` 44 (big numbers, use `font-light`).
- Radii by hierarchy: panels `rounded-xl`, controls `rounded-md`, chips and pills `rounded-full`, sheets `rounded-2xl`. Shadows only on things that float (`shadow-float`, `shadow-sheet`, `shadow-thumb`), never on panels.
- Utilities: `hit` (extends the hit area to at least 44x44 without changing the visual), `px-gutter` (16px plus safe area), `pt-safe`, `pb-safe`, `pb-chrome` (room for tab bar and sticky actions), `glass` (translucent bars), `scrollbar-none`.
- Layout variables: `--chrome-bottom` (tab bar plus safe area, 0 plus safe area at 1280px and up or on bare screens), `--chrome-left` (rail width at 1280px and up), `--actions-h` (set automatically when a `StickyActions` bar is on screen), `--page-max` (640px, 1440px inside `<Page width="wide">`).
- Breakpoints: `lg` 1024px (sheets become floating panels), `desktop` 1280px (nav rail replaces tab bar).
- Dark mode follows `prefers-color-scheme`; `<html data-theme="light|dark">` forces one (for QA or a future setting).

## Primitives (`src/ui`, import from `../ui`)

| Component | Notes |
|---|---|
| `Page`, `PageBody`, `Panel`, `Section`, `StickyActions` | Screen wrapper and layout. `StickyActions` is the fixed bar above the tab bar ("Add exercise", "Add to plan"); toasts move up to clear it. |
| `PageHeader` | Sticky translucent toolbar plus large title. `back={{ to, label }}` shows a visible back button on pushed screens: history back when there is in-app history, else navigates to `to`. `actions` for trailing IconButtons, `children` for chips under the title. |
| `Button`, `LinkButton` | Variants `primary` (ink), `secondary`, `ghost`, `link` (accent text). Sizes `sm` (36 visual, 44 hit), `md` 44, `lg` 52. `icon` / `iconEnd` take lucide icons. `LinkButton` takes typed router props. |
| `IconButton`, `IconLink` | `label` is required (aria-label and tooltip). 44 or 36 visual, always 44 hit. |
| `Chip`, `ChipGroup` | Toggle chips (`aria-pressed`). `ChipGroup` single (`allowEmpty` optional) or `multiple`; `scroll` for one horizontal row. |
| `SegmentedControl` | Radiogroup with roving focus and arrow keys. |
| `Stepper` | Sets -/+ with a focusable spinbutton (arrows, Page Up/Down, Home/End). Defaults min 1, max 20. |
| `Sheet` + `useSheet` | See URL conventions. Native `<dialog>`: bottom sheet on phone, floating side panel from 1024px (`desktop="center"` for small dialogs). Optional `footer` is pinned. Focus goes to the dialog itself on open, so no keyboard pops up. |
| `showToast`, `ToastHost` | One toast at a time, `action` for Undo. Host is mounted in the root layout. Use `toastWithUndo(message)` from `src/app/undo.ts` for program changes. |
| `EmptyState`, `Pill`, `VisuallyHidden`, `Placeholder` | `Pill` is the neutral band pill (`outline` or `soft`); bands are words, never colors. `Placeholder` is temporary. |
| `TabBar`, `NavRail` | Mounted by the root layout; hidden on `/welcome` and `/dev/*`. |

## App layer (`src/app`)

- `useCatalog()`: exercises, active exercises, catalog map, by-slug map, replacements, splits. Overridable through `AppProviders catalog={...}`.
- `useWeek(program?)`: memoized `computeWeek` + `computeCoverage` + recovery schedule for the active program (or a passed one, e.g. a decoded share link) under current prefs. Returns `{ program, week, coverage, schedule, order, days, dayFacts(day), prefs }`. `days[d]` has `kind`, `label`, `exercises`, `hardSets`, `topGroups`, `estMinutes` (planned session length rounded to 5 minutes, 0 for rest or empty days, from `src/domain/session.ts`). `order` is display order from `weekStart`.
- `days.ts`: `DayIndex` (0 = Monday), slugs `mon..sun`, `dayName(d, 'short'|'long'|'letter')`, `weekOrder(weekStart)`, `sortDays`, `formatDayList`, `todayIndex`.
- `bands.ts`: `bandLabel(band, { goal, optional })` gives not trained / light / moderate / target range / high / very high; optional groups never read "light"; the general goal reads moderate as "good for general fitness". Also `targetText(edges, { personal }?)` ("target 10-20", or "your range 15-25" when personal), `bandTargetText(band)` (personal when `band.mode !== 'normal'`), `citedRangeText(band.cited)` (the research range line for "why?" when the user set their own), `bandRange`, `bandExplanation` (neutral one-liners for "why?").
- `format.ts`: `formatSets(7.5)` "7.5", `setsLabel`, `countLabel`, `formatMath(3, 0.5)` "3 × 0.5 = 1.5", `formatDelta(8, 11)` "8 → 11", `joinMeta`, `formatDaySummary(5, 17, locale, 55)` "5 exercises · 17 sets · about 55 min" (minutes only when above 0), `formatRest(90)` "90 s" / `formatRest(120)` "2 min", `formatRir(2)` "RIR 2".
- `volumeScale.ts`: `VOLUME_COLOR[band]`, `ROLE_COLOR[role]`, `groupShade(group, sets, scale, targets?)`, `headShade(head, sets, scale, targets?)` (personal ranges move the steps via `shadeEdges`; skipped groups shade on the research range; pass `usePrefsStore((s) => s.targets)`), `dayEdges(edges)` (weekly edges times 10/30 for the day scale).
- `search.ts`: zod building blocks for search params (every param optional, invalid values become `undefined`).
- `firstRun.ts`: `/`, `/day/*` and `/body` redirect to `/welcome` while no program exists. Catalog, detail, settings, legal pages and `/shared` stay reachable. Skipping the welcome creates a blank program.
- `brand.ts`: `APP_NAME` (working name) and the not-medical-advice line.

## URL and sheet conventions

- Every sheet lives in the URL as `?sheet=<name>` plus its own params, so back closes it and links can open it. A route must list each sheet name in its `sheet` enum, otherwise the param is dropped.
- `const s = useSheet('add', ['tab', 'group'])`: `s.open`, `s.show(params)` pushes a history entry, `s.update(params)` changes params in place, `s.close()` goes back when the sheet was opened in-app and otherwise strips its params, `s.switchTo(name)` swaps one sheet for another in the same entry (menu to share).
- Filters and view state that should survive back and reload go in search params with `replace: true`. Transient state (search text inside a sheet, the "Which muscle?" chooser) stays local.
- Day URLs use slugs (`/day/mon`); stored days are indexes (0 = Monday).

| Route | Search params | Sheets |
|---|---|---|
| `/` | `sheet`, `day` | `menu`, `programs`, `share`, `export`, `paste`, `image` (week PNG), `calendar` (.ics), `add` (`day`) |
| `/day/$dow` | `sheet`, `entry`, `tab`, `group` | `add` (`tab`, `group`), `entry`, `move`, `copy`, `swap` (`entry`), `day`, `image` (day PNG) |
| `/body` | `scope` (week or mon..sun), `shade` (groups, heads), `view` (front, back, both), `sheet`, `group`, `head` | `muscle` (`group`, `head`) |
| `/exercises` | `q`, `muscle`, `equip` (mine, all), `pattern`, `sheet` | `muscle` (filter via map) |
| `/exercise/$slug` | `sheet`, `from` (day slug that opened it) | `days` (add to plan), `counts` (edit how this counts) |
| `/welcome` | `step` (1..3) | none |
| `/shared` | none; the program is in the `#fragment` | none |
| `/settings` | `sheet`, `id`, `group` | `equipment`, `overrides`, `custom` (`id`), `targets` (`group` expands and scrolls to that muscle) |
| `/credits`, `/privacy`, `/about` | none | none |
| `/dev/figure` | unchanged, dev only | none |

## Entry fields

`Entry` (`src/domain/schema.ts`): `id`, `exerciseId`, `sets`, optional `reps`, `restSec` (0-600, step 15; absent means the exercise default in the estimate), `rir` (0-5), `withPrev: true` (superset with the entry above; pairs only). Change them only through the program store (`setRestSec`, `setRir`, `linkWithPrev`), which keeps pairs consistent and undoable. Rows and cards label pairs with `supersetLabels(entries)` from `src/features/builder/labels.ts` (A1/A2, B1/B2; null for solo entries). Swap candidates are ranked by `rankAlternatives` in `src/features/catalog/alternatives.ts` (equipment, curated list, head overlap, level, id).

## Shared component contracts

Keep the props; replace the internals freely. Current implementations are minimal but working.

### `src/features/bodymap` (bodymap agent)

```ts
BodyMap(props: {
  view: 'front' | 'back' | 'both'
  values: { heads: Record<string, number>; groups: Record<string, number> } // fractional sets for the scope
  shade?: 'groups' | 'heads'   // default 'groups'
  scale: 'week' | 'day'
  highlight?: readonly string[] // group ids outlined in ink
  onSelectGroup?: (group: string) => void
  label?: string
  className?: string
})
BodyMini(props: {
  view: 'front' | 'back' | 'both'
  groups?: Record<string, number> // volume shading
  roles?: Record<string, 'primary' | 'secondary'> // role tint, wins over groups
  scale?: 'week' | 'day'
  height?: number // px, default 72
  label?: string  // set to announce as an image; decorative otherwise
  className?: string
})
VolumeLegend(props: { scale: 'week' | 'day'; className?: string })
```

For the week pass `week.shade.weekly` (heads) and `week.weekly` (groups); for one day pass the day column of `week.shade.daily` and `week.daily`. Taps are pointer only; the coverage list is the accessible equivalent (plan). Still to build: ID-raster hit testing with the "Which muscle?" chooser, zoom, symbol/use sprites for mini maps, pulse on change.

### `src/features/catalog` (catalog agent)

```ts
ExerciseCardMedia(props: { exercise: Exercise | CustomExercise; size: 'sm' | 'md' | 'lg'; className?: string })
ExerciseRow(props: {
  exercise: Exercise | CustomExercise
  meta?: ReactNode     // second line, defaults to primary groups
  trailing?: ReactNode // add button, stepper, menu; outside the tap target
  link?: boolean       // row body links to /exercise/$slug
  onSelect?: () => void
  className?: string
})
useRoles(exercise) // roles after the user's overrides
```

`sm` is the 48px row poster (zoomed to the area of the primaries), `md` the grid card, `lg` the detail hero. Later the same slot shows baked posters and loops.

### `src/features/builder` (builder agent)

```ts
DayPicker(props: {
  value: readonly DayIndex[]
  onChange: (days: DayIndex[]) => void // unique, sorted Monday first
  label: string
  weekStart?: DayIndex // defaults to prefs
  hints?: Partial<Record<DayIndex, string>> // e.g. "Rest", "4"
  disabled?: readonly DayIndex[]
  className?: string
})
```

### Paste a program (`src/features/export/PasteSheet.tsx`)

- Sheet `paste` on `/`, opened from the Plan menu ("Paste a program") or the "Paste a program" section of the export dialog (`ExportDialog` `onPaste`, a `switchTo`).
- Input: free text, CSV with a header row, or a share link (full `/shared#...` URL or the bare fragment). A link that decodes skips the review and saves as is.
- Text goes through `parseProgramText` and `assignDays` (`src/domain/importText.ts`, pure): weekday headers keep their day; other sessions fill the free days in order when the text lists rest days, otherwise spread like templates (`SPREAD`: 3 sessions on Mon, Wed, Fri). Unreadable lines are warnings, never errors.
- Names go through `createMatcher` (`importMatch.ts`): exact name or alias, then MiniSearch (OR, fuzzy, prefix) over the localized catalog plus the active program's custom exercises. Weak or missing matches carry a neutral "Check this one" pill until the user picks, skips, or keeps the line as their own exercise (one optional primary group). Lines with no match start skipped.
- "Create program" always adds a new program (`importProgram`, names deduped with `withUniqueNames`), which becomes active, then a toast. Nothing existing is changed.

### Files, image and calendar (`src/features/export`)

- `files.ts`: `download(file)` (temporary `<a download>`), `canShareFiles(file?)` (Web Share with files; pass the file to check its type), `shareOrDownload(file, title)` (share sheet when possible, else download; resolves `'shared' | 'downloaded' | 'cancelled'`). Use these instead of new local copies.
- Sheet `image` (`ImageSheet`, prop `day` for one session, none for the week): on `/` from the Plan menu ("Save week as image"), on `/day/$dow` from day options ("Save as image", a `switchTo` that saves the typed label and note first). Shows a preview `<img>` from a blob URL (revoked on close) with Download and, when the browser can share files, Share. Files: `gym-plan-monday.png`, `gym-plan-week.png`.
- `image.ts`: 1080 px wide Canvas 2D drawing, no deps. Pure layout (`wrapText`, `ellipsize`, `layoutDay`, `layoutWeek`) returns draw ops and the height; `renderImage` draws them. The map is drawn from the parsed `AnatomyDoc` paths with `Path2D` (never the live SVG). Colors come from the light-theme tokens through `resolvePalette()` (probe element, read back through a 1 px canvas) with `FALLBACK_PALETTE` when the canvas cannot parse a value. Content (titles, rows, legend) comes from `imageContent.ts`; entry text ("3 × 6-8", "rest 2 min", "RIR 2", A1/A2) from `planText.ts`.
- Sheet `calendar` (`CalendarSheet`) on `/` from the Plan menu ("Add to calendar"): start time (default 18:00), Download .ics and Share. `ics.ts` is pure: one VEVENT per training day with exercises, `RRULE:FREQ=WEEKLY`, floating local DTSTART on the next matching weekday (today counts; day 0 = Monday whatever `weekStart`), DTEND from `estMinutes` (at least 15 min), stable `UID` `<programId>-<mon..sun>@gym-builder`, CRLF, TEXT escaping and 75-octet folding that never splits a UTF-8 character. Events are a one-time copy; later edits do not update them.

## Copy and color rules (from the plan, enforced in review)

- Neutral tone, sentence case, no em-dashes. Recovery is plain facts in secondary text; never "risk", "too soon", "overtrained", "recover", readiness numbers, "!" badges or warning colors, never in toasts.
- Volume is the only data color. Bands are text pills. "High" is described as diminishing returns, never as danger.
- An empty training day is not a rest day. Destructive actions use an Undo toast, not a confirm dialog.
- Not-medical-advice line (`NOT_MEDICAL_ADVICE`) on first run, exercise detail footer, coverage footer and print.
- Every string ships in English and Ukrainian (`docs/I18N.md`). Ukrainian follows the same rules: no «ризик», «зарано», «перетренованість», «відновлення», «оптимальний»; apostrophe `ʼ`; polite plural imperative. The language switch (`LanguageToggle`, bilingual label «Мова / Language») sits in the Plan, Body and Exercises headers, the desktop rail, Settings and the first welcome step.
