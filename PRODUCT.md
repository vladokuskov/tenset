# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Self-coached lifters, beginner to intermediate, who write their own weekly gym program. They plan on a phone (often at home or between sets), want to know whether the week trains every muscle at a sensible volume, and want to fix gaps without learning volume science first. Secondary: people who receive a program as a share link (from a friend, or built by Claude through the MCP endpoint) and open, preview and save it.

## Product Purpose

Tenset plans a weekly gym program (Mon to Sun) from a split template or blank, and shows live, on a head-level front/back body map, which muscles each day and the whole week train, in weekly hard sets per muscle group. It is a planner, not a logger: nothing about actual workouts is recorded.

Status: free, public, non-commercial side project (Vercel Hobby). No monetization planned. Success means people actually use it to plan their week and come away with a program that covers what they need.

## Positioning

Nobody else ships a detailed body map that fills in live while *planning* a week; competitors map logged workouts at 11 to 21 coarse groups. Tenset maps planned sets at 19 banded groups and 38 visible heads, with fractional set counting (primary 1.0, secondary 0.5) and visible math ("Incline DB press · Mon · 3 x 1.0 = 3"). Every exercise is animated by an in-house procedural 3D figure, and every muscle call cites a source in `data/sources.json`.

## Operating Context

- Phone-first offline PWA, 390x844 design target; desktop (>= 1280 px) gets a 7-column week board with drag between days and a sticky map panel.
- No accounts, no backend. Programs live in the browser (localStorage). Share links carry the program in the URL fragment; also QR, JSON export/import, print, PNG of a day or week, .ics calendar events.
- A stateless MCP endpoint (`api/mcp.ts`) lets Claude build programs and hand back a share link. It stores and logs no program data.
- Languages: English and Ukrainian, everything included. Ukrainian copy is machine-drafted and still awaits native review.

## Capabilities and Constraints

- Catalog of ~300 exercises, each with original 3 to 5 line cues, muscle roles, equipment, pattern and a looping animation or card.
- Weekly builder: sets, rep ranges, optional rest and RIR targets, supersets (pairs), session time estimate, per-day notes, Undo instead of confirm dialogs.
- Split templates (Full Body, Upper/Lower, PPL, Bro), first-run flow, custom exercises (max 30), per-exercise role overrides, personal per-muscle ranges.
- Bands: not trained / light / moderate / target range / high / very high, shown as text pills, never as colors. Volume is the only color on the body map and volume legends. Movement groups get categorical pastels on exercise surfaces only, always with `mv-ink` text and a text label, never on volume data. No warning semantics.
- Recovery is information only: no warnings, no warning colors, no "risk", "too soon", "overtrained", never blocks.
- Zero third-party runtime requests (strict CSP in `vercel.json`): no CDN fonts, presets or textures.
- Content and license rules in `CLAUDE.md` are hard constraints (banned sources, allowed assets, code licenses).
- Terminology: "hard sets", "weekly sets", "target range", "fractional sets", group vs head. Full spec in `docs/PLAN.md`.

## Brand Commitments

- Name: **Tenset** (nods to roughly ten weekly sets per muscle). Logo: the "Dial" mark with a lowercase wordmark (`docs/brand/`).
- Voice: neutral, plain, factual. No hype, no fear, no medical claims. A "not medical advice" line appears in first run, exercise detail, coverage and print.
- No brand names or logos of equipment makers or gyms anywhere.

## Evidence on Hand

- Research citations in `data/sources.json` (Pelland 2026, ACSM 2026, Baz-Valle 2022, and per-exercise studies); band and rule decisions in `docs/PLAN.md`.
- Product screenshots in `docs/screenshots/`.
- No testimonials, user counts, coach endorsements or reviews exist. Do not invent them. Exercise form has not been checked by a certified coach.

## Product Principles

1. Show the numbers, never judge them. Bands and recovery are facts with a "why?", not warnings.
2. Planning is the product. Every change shows its effect on the map immediately.
3. Honest about evidence. Cite sources; mark low-confidence calls as such.
4. Phone first, one hand, offline. Desktop is a richer view of the same thing.
5. Original and license-clean. Everything shipped is ours or properly credited.

## Accessibility & Inclusion

WCAG 2.2 AA. Already in place and must be kept: 44 px minimum targets, a non-drag path for every drag (2.5.7), nothing hover-only, colour-blind-safe single-hue volume scale with text bands, reduced motion (animations pause mid-rep), coverage list as the accessible equivalent of the body map, axe checks in e2e. Full English and Ukrainian parity.
