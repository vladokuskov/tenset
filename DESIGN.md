---
name: Tenset
description: A calibrated planning instrument for a weekly gym program, read through one cobalt volume scale on a head-level body map, with movement-group pastels on exercise surfaces.
colors:
  canvas: "oklch(0.962 0.004 260)"
  surface: "oklch(0.993 0.002 260)"
  surface-2: "oklch(0.925 0.006 260)"
  raised: "oklch(0.998 0.001 260)"
  thumb: "oklch(1 0 0)"
  line: "oklch(0.895 0.007 260)"
  line-strong: "oklch(0.79 0.01 260)"
  ink: "oklch(0.2 0.012 260)"
  ink-2: "oklch(0.42 0.018 260)"
  ink-3: "oklch(0.51 0.016 260)"
  on-ink: "oklch(0.985 0.002 260)"
  accent: "oklch(0.5 0.17 264)"
  accent-soft: "oklch(0.93 0.035 264)"
  on-accent: "oklch(0.985 0.005 264)"
  scrim: "oklch(0.18 0.015 260 / 0.36)"
  map-skin: "oklch(0.905 0.006 260)"
  vol-none: "oklch(0.85 0.008 260)"
  vol-light: "oklch(0.78 0.065 265)"
  vol-moderate: "oklch(0.665 0.125 265)"
  vol-target: "oklch(0.55 0.17 265)"
  vol-high: "oklch(0.44 0.165 267)"
  vol-very-high: "oklch(0.335 0.13 270)"
  mv-push: "oklch(0.82 0.1 294)"
  mv-pull: "oklch(0.836 0.096 162)"
  mv-shoulders: "oklch(0.835 0.078 230)"
  mv-arms: "oklch(0.834 0.101 358)"
  mv-legs: "oklch(0.833 0.11 57)"
  mv-core: "oklch(0.91 0.128 92)"
  mv-other: "oklch(0.885 0.012 265)"
  mv-ink: "oklch(0.209 0.01 268)"
typography:
  display:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "2.75rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontFeature: "\"tnum\" 1"
  headline:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: "2.125rem"
    letterSpacing: "-0.022em"
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: "1.375rem"
    letterSpacing: "-0.01em"
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.375rem"
    fontFeature: "\"tnum\" 1"
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: "1.125rem"
  micro:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: "0.875rem"
rounded:
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.25rem"
  2xl: "1.5rem"
  full: "9999px"
spacing:
  hairline: "1px"
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "28px"
  tabbar: "56px"
  rail: "88px"
  page-narrow: "640px"
  page-wide: "1440px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.line}"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
  button-ghost-hover:
    backgroundColor: "{colors.surface-2}"
  button-link:
    textColor: "{colors.accent}"
    typography: "{typography.body}"
  icon-button:
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: "44px"
  chip:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 14px"
    height: "36px"
  chip-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
  pill-outline:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.full}"
    padding: "0 10px"
    height: "24px"
  pill-soft:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.full}"
    padding: "0 10px"
    height: "24px"
  segmented-track:
    backgroundColor: "{colors.surface-2}"
    rounded: "{rounded.md}"
    padding: "2px"
    height: "44px"
  segmented-thumb:
    backgroundColor: "{colors.thumb}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
  stepper-button:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: "36px"
  input:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "44px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
  sheet:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.2xl}"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "6px 6px 6px 16px"
    height: "48px"
  tab-bar:
    textColor: "{colors.ink-3}"
    typography: "{typography.micro}"
    height: "{spacing.tabbar}"
  tab-bar-current:
    textColor: "{colors.accent}"
---

# Design System: Tenset

> **Status (2026-10-16).** This file records **Instrument** with **Movement Colors**. The Instrument color tokens (from `redesign/instrument-tokens`, 13dadcd) and the movement pastels land on `feat/movement-colors`; the Instrument fonts do not. **Fonts stay system for now:** Atkinson Hyperlegible Next and Barlow Condensed have no Cyrillic, so the app keeps `system-ui` for words and numbers until a face with Ukrainian coverage is chosen. `font-num` exists as a token (system stack, tabular, condensed stretch where the face has it) so big numbers can switch faces later without touching components.

## Overview

**Creative North Star: "The Calibrated Instrument"**

Tenset is a measuring tool for a training week. The chrome is quiet graphite, cool and nearly colorless, so that the cobalt volume scale on the body map reads as data and nothing else. Exercises carry a second, categorical voice: a soft pastel per movement group (push, pull, shoulders, arms, legs, core), so a day or a week shows its balance at a glance. Numbers are the product: they are big, condensed, tabular and always paired with the words that explain them. The interface behaves like a well-made gauge: exact, legible at arm's length in a gym, and silent about what it does not know.

Density is phone-first and calm: one 640 px column, grouped panels on a slightly darker canvas, hairline rows inside panels instead of nested cards. On desktop the same system widens into a week board with a nav rail and a sticky map panel; it never gains decoration in exchange for space. Recovery and volume are stated, never judged, so no color ever means "warning", and Tailwind's default palette is removed on purpose.

**Key Characteristics:**
- Graphite neutrals with a faint cool tint (hue 260) in both themes.
- Cobalt is the brand, the only volume hue, and (one step deeper) the interactive accent.
- Movement groups get categorical pastels on exercise surfaces, always with dark `mv-ink` text and a text label.
- Primary actions are ink, not color.
- System fonts for now; big numbers use `font-num` at 600.
- Tabular figures everywhere.
- Flat panels; shadows only on things that float.
- Light and dark themes are first-class, each tuned on its own.

## Colors

A cool graphite ramp with a single cobalt voice that does double duty as volume data and affordance, plus six categorical pastels that name what kind of movement an exercise is.

### Primary
- **Instrument Cobalt** (`accent`): links, focus rings, the current tab, selection tint. Deeper and more saturated than the mid volume steps so it reads as "you can press this", not "this muscle has volume". Its pale partner **Cobalt Wash** (`accent-soft`) is the text selection color and the Undo label on the ink toast.

### Secondary: the Volume Scale
- **Volume, six steps** (`vol-none` → `vol-light` → `vol-moderate` → `vol-target` → `vol-high` → `vol-very-high`): one cobalt hue (265 to 270) stepped by lightness only. Light theme: darker means more. Dark theme: brighter means more. Steps map 1:1 to the volume bands; `role-primary` and `role-secondary` alias `vol-high` and `vol-light` for muscle tints on exercise cards and the figure.
- **Map Skin** (`map-skin`): the untrained silhouette of the body map, a neutral just off the canvas. Region separators use `surface`.

### Tertiary: Movement Colors
- **Movement pastels** (`mv-push` lilac, `mv-pull` mint, `mv-shoulders` sky, `mv-arms` pink, `mv-legs` apricot, `mv-core` butter, `mv-other` graphite for custom exercises with no pattern). Groups come from `MOVEMENT_GROUPS` in `src/domain/movement.ts`. Dark theme uses slightly deeper, less bright versions so fills do not glare.
- **Movement Ink** (`mv-ink`, about `#16181D`): the text and icon color on every pastel fill. It stays dark in both themes, so contrast is at least 8:1 on every fill in light and dark.
- **Where:** filled entry rows and board cards, chips, swatch dots, mix bars, the colored ring or frame around a white thumbnail. **Never** on the body map, volume legends, bands or any volume number.
- **Thumbnails:** the figure image sits on a white tile inside a 3 px ring (or a padded frame on the hero) in the group color. No blend modes, no tint over the figure; it keeps its true colors.

### Neutral
- **Graphite Canvas** (`canvas`): the page. Also the PWA theme color (`#f2f3f5` light, `#0f1114` dark).
- **Panel White** (`surface`): grouped panels on the canvas.
- **Well Grey** (`surface-2`): wells, segmented tracks, tonal buttons, inputs, stepper buttons.
- **Sheet White** (`raised`): sheets and popovers. **Thumb** (`thumb`): the segmented-control thumb.
- **Hairline** (`line`) and **Control Edge** (`line-strong`): dividers inside panels; outlines on chips, pills and controls.
- **Graphite Ink** (`ink`), **Ink 2** (`ink-2`), **Ink 3** (`ink-3`): primary text, secondary text, tertiary text and inactive icons. `on-ink` is text on ink fills.
- **Scrim** (`scrim`): sheet backdrop.

Dark theme values live in `src/styles/app.css` and in `.impeccable/design.json` (`colorMeta.*.dark`). They are retuned, not inverted: the canvas drops to near-black graphite, the accent lifts to a lighter cobalt, and the volume scale flips direction.

### Named Rules
**The Two Voices Rule.** Volume is the only color on the body map and volume legends. Movement groups get categorical pastels on exercise surfaces only, always with `mv-ink` text and a text label, never on volume data. Color is never the only cue: every swatch or fill sits next to the group name or the exercise name, and mix bars carry a legend or an `aria-label` with every group and its sets.

**The No Alarm Rule.** No warning semantics, in either theme. No color ever means "too much", "risk" or "too soon"; the movement pastels are categories, not states. Bands are words in neutral pills, so "high" never reads as danger. The default Tailwind palette stays removed.

**The Ink Action Rule.** Primary buttons are `ink` on `on-ink`. Cobalt marks interactivity (links, focus, current tab), never the main call to action fill.

## Typography

**Display Font:** system stack via `font-num` (600, tabular, condensed stretch where the face supports it)
**Body Font:** `system-ui` stack

**Character:** Fonts stay system for now. Instrument picked Atkinson Hyperlegible Next and Barlow Condensed, but neither covers Cyrillic, so they are parked until a Ukrainian-ready pair is chosen. No font packages are installed and no runtime font requests are made.

### Hierarchy
- **Display** (600, 2.75rem, line-height 1, -0.01em, `font-num`): the one big number on a screen: weekly sets in the muscle sheet, "15 of 19" groups trained. Always followed by a smaller unit or caption in `ink-2`/`ink-3`.
- **Headline** (700, 1.875rem / 2.125rem, -0.022em): page titles in the large page header.
- **Title** (600, 1.0625rem / 1.375rem, -0.01em): section headings above panels.
- **Body** (400, 1rem / 1.375rem): rows, descriptions, sheet content. Inputs never go below 16 px (prevents iOS zoom).
- **Label** (500, 0.8125rem / 1.125rem): buttons at `sm`, chips, secondary row meta ("5 exercises · 17 sets · about 55 min"), toasts.
- **Micro** (500, 0.6875rem): tab bar labels, stepper units, small pills. Use sparingly; it is the floor.

Weights in use are 400, 500, 600 and 700. Light weights are retired; big numbers are semibold.

### Named Rules
**The Tabular Rule.** Every number is tabular (`font-variant-numeric: tabular-nums` on body, `num` utility for emphasis), so stepping 9 → 10 sets never shifts a column.

**The Condensed Is For Numbers Rule.** `font-num` sets numerals only. Words, units and labels stay in `font-sans`.

## Layout

- **Phone (below 1024 px):** one column, max 640 px (`--page-max`), 16 px gutters plus safe-area insets (`px-gutter`). Bottom tab bar 56 px plus safe area (Plan, Body, Exercises). Sticky glass page header, 52 px tall, with a large title block below it that scrolls away.
- **Rhythm:** 28 px between sections, 10 px from a section title to its panel, 16 px inside panels. Rows inside a panel are separated by hairlines, never by gaps or nested cards.
- **Sheets:** native `<dialog>` as a bottom sheet on phone (full width, max 640 px, top corners 1.5rem). From 1024 px, a floating side panel 440 px wide inset 12 px from the right, or a centered 512 px dialog when `data-desktop="center"`.
- **Desktop (1280 px and up, `desktop:` breakpoint):** an 88 px nav rail on the left replaces the tab bar; wide pages widen `--page-max` to 1440 px for the 7-column week board with a sticky ~400 px map panel. 1024 to 1279 px keeps the phone layout with desktop-style sheets.
- **Sticky actions** reserve their own height (`--actions-h`, 76 px) so content never hides under them; `pb-chrome` accounts for tab bar, actions and safe area together.
- **Touch:** every target is at least 44 × 44 px. The `hit` utility extends small visuals (36 px chips and steppers) to 44 px without changing their size.

## Elevation & Depth

Flat by default. Depth comes from tonal layering: `canvas` under `surface` panels, `surface-2` wells inside them, `raised` for anything that floats. Shadows exist only on floating layers, and they carry a faint graphite tint rather than pure black. In dark mode each shadow adds a 1 px inset top highlight so floating layers catch light on their upper edge. Sticky bars use `glass`: 90% canvas with a 20 px saturated blur.

### Shadow Vocabulary
- **Float** (`shadow-float`): toasts, popovers, desktop side sheets.
- **Sheet** (`shadow-sheet`): bottom sheets, shadow cast upward.
- **Thumb** (`shadow-thumb`): the segmented-control thumb, the only shadow on a control.

### Named Rules
**The Panels Don't Float Rule.** Panels and cards never carry a shadow. If something has a shadow, it is above the page and can be dismissed.

## Shapes

Soft, consistent rounding by hierarchy, nothing sharp and nothing bubbly. Panels 1.25rem (`rounded-xl`), controls and inputs 0.75rem (`rounded-md`), toasts 1rem (`rounded-lg`), sheets 1.5rem (`rounded-2xl`, top corners only on phone), chips, pills, icon buttons and stepper buttons fully round. Segment buttons inset 2 px inside their track and take the track radius minus 2 px so the curves stay concentric. Borders are 1 px hairlines and appear only on chips, outline pills, the tab bar top edge and the nav rail edge. Icons are lucide at stroke 1.75 (2 for the current tab).

## Components

### Buttons
Quiet and exact: ink or tonal fills, no gradients, a small press scale.
- **Shape:** gently rounded (0.75rem); `lg` uses 1rem.
- **Sizes:** `sm` 36 px (hit area 44), `md` 44 px, `lg` 52 px; horizontal padding 14, 16, 20 px.
- **Primary:** `ink` fill, `on-ink` text, weight 500. Hover lightens to 88% ink.
- **Secondary (default):** `surface-2` fill, `ink` text; hover `line`.
- **Ghost:** transparent, hover `surface-2`.
- **Link:** `accent` text, underline on hover, no press scale.
- **Press / Disabled:** `scale(0.98)` on press, 150 ms ease-out; disabled at 45% opacity and not clickable.
- **Icon buttons:** round, 44 px (or 36 px with a 44 px hit area), ghost / tonal / solid variants mirroring the above; icon 22 px (18 at 36).

### Chips
- **Style:** fully round, 36 px (32 at `sm`), 1 px `line-strong` border, transparent fill, `ink` text at label size. Optional trailing count in `ink-3`.
- **Selected:** fills `ink` with `on-ink` text and a 70% `on-ink` count. Toggle chips expose `aria-pressed`. A removable chip ends in a 14 px ×.

### Pills (bands and tags)
- **Outline:** 1 px `line-strong` border, `ink-2` text, 24 px (20 at `sm`). Used for volume bands next to numbers.
- **Soft:** `surface-2` fill for quiet tags such as "custom".
- Pills are never colored by band. That is the No Alarm Rule made concrete. Movement colors never go on band pills either.

### Segmented Control
A `surface-2` track (44 px, or 36 px at `sm`) with 2 px padding; the selected segment is a `thumb` fill with `shadow-thumb` and `ink` text, the rest `ink-2`. Real radio group semantics with arrow, Home and End keys. Used for scope (Week / Day), shading (Groups / Heads) and settings.

### Stepper
Round 36 px `surface-2` minus and plus buttons (hit area 44, press `scale(0.9)`) around a centered value in semibold `md` with an optional micro unit below. The value is a `spinbutton` with arrow, Page and Home/End keys.

### Cards / Containers (Panel)
- **Corner Style:** 1.25rem.
- **Background:** `surface` on `canvas`.
- **Shadow Strategy:** none (Panels Don't Float).
- **Border:** none; inner rows divided by `line` hairlines.
- **Internal Padding:** 16 px; list rows 10 to 12 px vertical.

### Inputs / Fields
- **Style:** `surface-2` fill, no border, 0.75rem radius, 44 px tall, 12 px padding, `ink-3` placeholder, 16 px minimum font size.
- **Focus:** the global focus ring, 2 px `accent` outline offset 2 px. No glow.

### Navigation
- **Tab bar (phone):** glass bar with a hairline top border, three equal tabs, 24 px icon over a micro label. Current tab is `accent` with a 2 px icon stroke; others `ink-3`, hover `ink-2`.
- **Nav rail (desktop):** 88 px column on `canvas` with a hairline right border, brand mark on top, settings and language at the bottom.
- **Page header:** sticky glass bar with back button (chevron plus label) and actions; the large page title sits below it in the scroll.

### Sheets and Toasts
- **Sheet:** `raised`, 1.5rem radius, `shadow-sheet` on phone; slides up 340 ms on `ease-out` over a fading `scrim`. Desktop side sheet slides in 24 px from the right with a fade.
- **Toast:** `ink` bar, 48 px minimum, 1rem radius, `shadow-float`; label-size message and a semibold `accent-soft` Undo button. Enters 320 ms from 12 px below. Destructive actions use Undo, not confirm dialogs.

### Body Map (signature component)
Front and back silhouettes in `map-skin`, each muscle region filled from the six-step volume scale, separated by `surface`-colored gaps. A legend under the map names the scale (week or single day). The map and its legend are cobalt only; movement colors never appear here. Tapping selects a group; the coverage list is the accessible equivalent. On exercise cards and the 3D figure, `role-primary` and `role-secondary` tint the working muscles.

### Motion
Two curves: `ease-out` `cubic-bezier(0.2, 0.8, 0.2, 1)` for entrances and state changes, `ease-in-out` `cubic-bezier(0.6, 0, 0.3, 1)` for movement between positions. Control feedback 150 ms, popovers 140 to 180 ms, sheets 300 to 340 ms. Reduced motion collapses all of it to near zero, and exercise loops pause mid-rep.

## Do's and Don'ts

### Do:
- **Do** use the `vol-*` scale for volume and nothing else.
- **Do** color exercise surfaces by movement group (`bg-mv-<group>` with `text-mv-ink`), and always show the group or exercise name with it.
- **Do** put thumbnails on white inside a group-colored ring or frame.
- **Do** make the primary action `ink` (`bg-ink text-on-ink`); keep `accent` for links, focus and the current tab.
- **Do** set big numbers as `font-num text-display font-semibold`, followed by a unit in `ink-2` or `ink-3`.
- **Do** keep every number tabular.
- **Do** group content in flat `surface` panels at 1.25rem with hairline rows inside.
- **Do** give every target a 44 px hit area (`hit` utility for smaller visuals).
- **Do** check each new token or surface in both light and dark themes; the dark values are tuned, not inverted.

### Don't:
- **Don't** add a warning color or any color that means a state (too much, too soon, risk), in either theme, for any reason.
- **Don't** put movement colors on the body map, volume legends, bands or volume numbers.
- **Don't** tint the figure or use `mix-blend-mode` on thumbnails; the owner rejected the purple-tinted figure.
- **Don't** use `ink` or `ink-2` text on a pastel fill; use `mv-ink`, which stays dark in dark mode.
- **Don't** color volume bands. Bands are words in neutral pills.
- **Don't** put a shadow on a panel or card.
- **Don't** fill a primary button with cobalt.
- **Don't** use `font-num` for words, or a light weight for big numbers.
- **Don't** reintroduce warm cream surfaces or brass accents; the owner retired that look as an AI default.
- **Don't** load fonts, textures or icons from a third-party origin; everything is self-hosted.
- **Don't** nest cards inside panels.
