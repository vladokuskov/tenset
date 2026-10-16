import type { MapScale } from '../../app/volumeScale'
import { MOVEMENT_KEYS, type MovementKey, type MovementMix } from '../../domain/movement'
import type { BandId } from '../../domain/volume'
import { MAP_ASPECT, MAP_HEIGHT, type AnatomyDoc, type AnatomyView } from '../bodymap/anatomy'
import type { EntryText } from './planText'

export const IMAGE_WIDTH = 1080
const PAD = 72
const CONTENT = IMAGE_WIDTH - 2 * PAD

export type FontSpec = { size: number; weight: 400 | 600 | 700 }
export type Measure = (text: string, font: FontSpec) => number
/** mvInk and mvInk2 are for text on movement fills; they stay dark whatever the theme. */
export type TextColor = 'ink' | 'ink2' | 'ink3' | 'mvInk' | 'mvInk2'

export type DrawOp =
  | { t: 'text'; x: number; y: number; text: string; font: FontSpec; color: TextColor; align?: 'left' | 'center' }
  | { t: 'rule'; x: number; y: number; w: number }
  | { t: 'map'; x: number; y: number; h: number; view: AnatomyView }
  | { t: 'swatch'; x: number; y: number; w: number; h: number; band: BandId }
  | { t: 'fill'; x: number; y: number; w: number; h: number; r: number; group: MovementKey }

export type ImageLayout = { width: number; height: number; scale: MapScale; ops: DrawOp[] }

export type DayImageContent = {
  title: string
  summary: string
  rows: readonly EntryText[]
  /** Movement group names; a row with a group shows its name before the details. */
  groupNames?: Readonly<Record<MovementKey, string>>
  /** Shown instead of rows: "Rest day", "No exercises yet". */
  empty?: string
  note?: string
  footer: string
  app: string
}

export type WeekImageRow = { day: string; title?: string; summary: string; groups?: string; mix?: MovementMix; rest: boolean }

export type WeekImageContent = {
  title: string
  subtitle: string
  rows: readonly WeekImageRow[]
  legend: readonly { band: BandId; label: string }[]
  mapCaption: string
  /** The whole week's movement mix with a "Push 24 sets" style label per group with sets. */
  mix?: { title: string; total: MovementMix; legend: readonly { group: MovementKey; label: string }[] }
  footer: string
  app: string
}

const ELLIPSIS = '…'
const lineHeight = (f: FontSpec) => Math.round(f.size * 1.28)

/** Trims the end until the text plus an ellipsis fits; `force` adds the ellipsis even when the text fits. */
export function ellipsize(text: string, maxWidth: number, measure: (s: string) => number, force = false): string {
  if (!force && measure(text) <= maxWidth) return text
  const chars = [...text]
  while (chars.length && measure(chars.join('').trimEnd() + ELLIPSIS) > maxWidth) chars.pop()
  return chars.join('').trimEnd() + ELLIPSIS
}

/** Greedy word wrap; words wider than a line break by character; past maxLines the last line gets an ellipsis. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number, maxLines = Infinity): string[] {
  const lines: string[] = []
  let line = ''
  const push = (word: string) => {
    const next = line ? `${line} ${word}` : word
    if (measure(next) <= maxWidth) {
      line = next
      return
    }
    if (line) lines.push(line)
    line = ''
    if (measure(word) <= maxWidth) {
      line = word
      return
    }
    let part = ''
    for (const ch of word) {
      if (part && measure(part + ch) > maxWidth) {
        lines.push(part)
        part = ''
      }
      part += ch
    }
    line = part
  }
  for (const word of text.split(/\s+/).filter(Boolean)) push(word)
  if (line) lines.push(line)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = ellipsize(kept[maxLines - 1], maxWidth, measure, true)
  return kept
}

const F = {
  title: { size: 56, weight: 700 },
  summary: { size: 30, weight: 400 },
  marker: { size: 32, weight: 700 },
  name: { size: 36, weight: 600 },
  detail: { size: 30, weight: 400 },
  note: { size: 28, weight: 400 },
  day: { size: 32, weight: 700 },
  rowTitle: { size: 32, weight: 600 },
  rowSummary: { size: 28, weight: 400 },
  rowGroups: { size: 26, weight: 400 },
  legend: { size: 22, weight: 400 },
  mixTitle: { size: 26, weight: 600 },
  mixLegend: { size: 24, weight: 400 },
  footer: { size: 24, weight: 400 },
  app: { size: 24, weight: 600 },
} satisfies Record<string, FontSpec>

/** Stacks wrapped lines from y; returns the y below the block. */
function textBlock(
  ops: DrawOp[],
  measure: Measure,
  text: string,
  font: FontSpec,
  color: TextColor,
  x: number,
  y: number,
  width: number,
  maxLines = Infinity,
  align: 'left' | 'center' = 'left',
): number {
  const lh = lineHeight(font)
  const lines = wrapText(text, width, (s) => measure(s, font), maxLines)
  lines.forEach((line, i) =>
    ops.push({ t: 'text', x: align === 'center' ? x + width / 2 : x, y: y + i * lh, text: line, font, color, align }),
  )
  return y + lines.length * lh
}

function mapPair(ops: DrawOp[], x: number, y: number, h: number, gap: number) {
  const w = h * MAP_ASPECT
  ops.push({ t: 'map', x, y, h, view: 'front' }, { t: 'map', x: x + w + gap, y, h, view: 'back' })
  return 2 * w + gap
}

/** Stacked bar of sets per group, segments in display order with a small gap; nothing for an empty mix. */
export function mixBar(ops: DrawOp[], mix: MovementMix, x: number, y: number, w: number, h: number, gap: number) {
  const parts = MOVEMENT_KEYS.filter((k) => mix[k] > 0)
  const total = parts.reduce((n, k) => n + mix[k], 0)
  if (!total) return
  const free = w - gap * (parts.length - 1)
  let at = x
  parts.forEach((group, i) => {
    const sw = i === parts.length - 1 ? x + w - at : (free * mix[group]) / total
    ops.push({ t: 'fill', x: at, y, w: sw, h, r: Math.min(h / 2, 6), group })
    at += sw + gap
  })
}

function footer(ops: DrawOp[], measure: Measure, y: number, text: string, app: string): number {
  y += 48
  ops.push({ t: 'rule', x: PAD, y, w: CONTENT })
  y = textBlock(ops, measure, text, F.footer, 'ink3', PAD, y + 24, CONTENT)
  y = textBlock(ops, measure, app, F.app, 'ink2', PAD, y + 8, CONTENT, 1)
  return y + PAD - 16
}

const DAY_MAP_H = 340
const MAP_GAP = 20
const ROW_GAP = 16
const ROW_PAD = 24
const ROW_INSET = 28
const ROW_R = 28

export function layoutDay(c: DayImageContent, measure: Measure): ImageLayout {
  const ops: DrawOp[] = []
  const mapW = 2 * DAY_MAP_H * MAP_ASPECT + MAP_GAP
  mapPair(ops, IMAGE_WIDTH - PAD - mapW, PAD, DAY_MAP_H, MAP_GAP)
  const textW = CONTENT - mapW - 40
  let y = textBlock(ops, measure, c.title, F.title, 'ink', PAD, PAD, textW, 3)
  y = textBlock(ops, measure, c.summary, F.summary, 'ink2', PAD, y + 12, textW, 3)
  y = Math.max(y, PAD + DAY_MAP_H) + 40

  ops.push({ t: 'rule', x: PAD, y, w: CONTENT })
  if (c.rows.length === 0) {
    y = textBlock(ops, measure, c.empty ?? '', F.name, 'ink3', PAD, y + 28, CONTENT, 2) + 28
    ops.push({ t: 'rule', x: PAD, y, w: CONTENT })
  }
  const markerW = c.rows.some((r) => r.marker) ? 76 : 0
  if (c.rows.length) y += ROW_GAP - 2
  for (const row of c.rows) {
    const fill: DrawOp = { t: 'fill', x: PAD, y, w: CONTENT, h: 0, r: ROW_R, group: row.group ?? 'other' }
    ops.push(fill)
    const top = y + ROW_PAD
    const left = PAD + ROW_INSET
    const inner = CONTENT - 2 * ROW_INSET - markerW
    if (row.marker) ops.push({ t: 'text', x: left, y: top + 2, text: row.marker, font: F.marker, color: 'mvInk' })
    const x = left + markerW
    const group = row.group && c.groupNames?.[row.group]
    const details = (group ? [group, ...row.parts] : row.parts).join(' · ')
    let ty = textBlock(ops, measure, row.name, F.name, 'mvInk', x, top, inner, 2)
    ty = textBlock(ops, measure, details, F.detail, 'mvInk2', x, ty + 6, inner, 2) + ROW_PAD
    fill.h = ty - y
    y = ty + ROW_GAP
  }
  if (c.rows.length) y -= ROW_GAP
  if (c.note) y = textBlock(ops, measure, c.note, F.note, 'ink2', PAD, y + 28, CONTENT, 4)
  y = footer(ops, measure, y, c.footer, c.app)
  return { width: IMAGE_WIDTH, height: Math.ceil(y), scale: 'day', ops }
}

const WEEK_MAP_H = 600
const DAY_COL = 132

export function layoutWeek(c: WeekImageContent, measure: Measure): ImageLayout {
  const ops: DrawOp[] = []
  let y = textBlock(ops, measure, c.title, F.title, 'ink', PAD, PAD, CONTENT, 2)
  y = textBlock(ops, measure, c.subtitle, F.summary, 'ink2', PAD, y + 12, CONTENT, 2) + 40

  const gap = 48
  const mapW = 2 * WEEK_MAP_H * MAP_ASPECT + gap
  mapPair(ops, PAD + (CONTENT - mapW) / 2, y, WEEK_MAP_H, gap)
  y += WEEK_MAP_H + 28

  if (c.legend.length) {
    const col = CONTENT / c.legend.length
    let bottom = y
    c.legend.forEach((l, i) => {
      const x = PAD + i * col
      ops.push({ t: 'swatch', x: x + 3, y, w: col - 6, h: 14, band: l.band })
      bottom = Math.max(bottom, textBlock(ops, measure, l.label, F.legend, 'ink2', x, y + 24, col, 2, 'center'))
    })
    y = bottom
  }
  y = textBlock(ops, measure, c.mapCaption, F.legend, 'ink3', PAD, y + 10, CONTENT, 2, 'center') + 36

  if (c.mix && c.mix.legend.length) {
    y = textBlock(ops, measure, c.mix.title, F.mixTitle, 'ink', PAD, y, CONTENT, 1) + 14
    mixBar(ops, c.mix.total, PAD, y, CONTENT, 16, 4)
    y += 16 + 20
    const cols = 3
    const col = CONTENT / cols
    const lh = lineHeight(F.mixLegend)
    c.mix.legend.forEach((l, i) => {
      const x = PAD + (i % cols) * col
      const ly = y + Math.floor(i / cols) * (lh + 12)
      ops.push({ t: 'fill', x, y: ly + (lh - 20) / 2, w: 20, h: 20, r: 5, group: l.group })
      ops.push({ t: 'text', x: x + 32, y: ly, text: ellipsize(l.label, col - 44, (s) => measure(s, F.mixLegend)), font: F.mixLegend, color: 'ink2' })
    })
    y += Math.ceil(c.mix.legend.length / cols) * (lh + 12) + 24
  }

  ops.push({ t: 'rule', x: PAD, y, w: CONTENT })
  const textW = CONTENT - DAY_COL
  for (const row of c.rows) {
    const pad = row.rest ? 18 : 24
    const top = y + pad
    ops.push({ t: 'text', x: PAD, y: top, text: ellipsize(row.day, DAY_COL - 16, (s) => measure(s, F.day)), font: F.day, color: 'ink' })
    const x = PAD + DAY_COL
    let ty = top
    if (row.title) ty = textBlock(ops, measure, row.title, F.rowTitle, 'ink', x, ty, textW, 1)
    ty = textBlock(ops, measure, row.summary, F.rowSummary, row.rest ? 'ink3' : 'ink2', x, row.title ? ty + 4 : ty + 2, textW, 2)
    if (row.groups) ty = textBlock(ops, measure, row.groups, F.rowGroups, 'ink3', x, ty + 4, textW, 1)
    const mix = row.mix
    if (mix && MOVEMENT_KEYS.some((k) => mix[k] > 0)) {
      mixBar(ops, mix, x, ty + 12, textW, 8, 3)
      ty += 12 + 8
    }
    y = Math.max(ty, top + lineHeight(F.day)) + pad
    ops.push({ t: 'rule', x: PAD, y, w: CONTENT })
  }
  y = footer(ops, measure, y, c.footer, c.app)
  return { width: IMAGE_WIDTH, height: Math.ceil(y), scale: 'week', ops }
}

// Drawing (browser only)

export type Palette = {
  bg: string
  ink: string
  ink2: string
  ink3: string
  line: string
  skin: string
  untracked: string
  vol: Record<BandId, string>
  mv: Record<MovementKey, string>
  mvInk: string
  mvInk2: string
}

/** Light-theme token values in sRGB, used when the browser's canvas cannot read the computed color. */
export const FALLBACK_PALETTE: Palette = {
  bg: '#fcfdfe',
  ink: '#13161c',
  ink2: '#474d57',
  ink3: '#616670',
  line: '#dadce1',
  skin: '#dde0e4',
  untracked: '#d5d8dc',
  vol: {
    none: '#cbced3',
    light: '#a3b7e2',
    moderate: '#6e91e0',
    target: '#3f69d3',
    high: '#2a47ac',
    very_high: '#1f2c78',
  },
  mv: {
    push: '#c7b8ff',
    pull: '#8eddb6',
    shoulders: '#93d3f2',
    arms: '#ffadc8',
    legs: '#ffb680',
    core: '#ffdf78',
    other: '#d5d9e1',
  },
  mvInk: '#16181d',
  mvInk2: 'rgba(22, 24, 29, 0.72)',
}

const TOKENS: Record<Exclude<keyof Palette, 'vol' | 'mv' | 'mvInk2'>, string> = {
  bg: 'var(--color-surface)',
  ink: 'var(--color-ink)',
  ink2: 'var(--color-ink-2)',
  ink3: 'var(--color-ink-3)',
  line: 'var(--color-line)',
  skin: 'var(--color-map-skin)',
  untracked: 'color-mix(in oklab, var(--color-vol-none) 45%, var(--color-map-skin))',
  mvInk: 'var(--color-mv-ink)',
}

const VOL_TOKENS: Record<BandId, string> = {
  none: 'var(--color-vol-none)',
  light: 'var(--color-vol-light)',
  moderate: 'var(--color-vol-moderate)',
  target: 'var(--color-vol-target)',
  high: 'var(--color-vol-high)',
  very_high: 'var(--color-vol-very-high)',
}

const SENTINEL = '#010203'

/** Paints the color into one pixel and reads it back as rgb(), or null when the canvas cannot parse it. */
function toRgb(ctx: CanvasRenderingContext2D, color: string): string | null {
  ctx.fillStyle = SENTINEL
  ctx.fillStyle = color
  if (ctx.fillStyle === SENTINEL) return null
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  return a === 0 ? null : `rgb(${r}, ${g}, ${b})`
}

/** Concrete light-theme colors from the CSS tokens, whatever theme is on screen. */
export function resolvePalette(): Palette {
  const root = document.documentElement
  const previous = root.dataset.theme
  root.dataset.theme = 'light'
  const probe = document.createElement('span')
  probe.style.display = 'none'
  document.body.append(probe)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const read = (value: string, fallback: string) => {
    probe.style.color = value
    const computed = getComputedStyle(probe).color
    return (ctx && computed && toRgb(ctx, computed)) || fallback
  }
  try {
    const out = { ...FALLBACK_PALETTE, vol: { ...FALLBACK_PALETTE.vol }, mv: { ...FALLBACK_PALETTE.mv } }
    for (const key of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) out[key] = read(TOKENS[key], FALLBACK_PALETTE[key])
    for (const band of Object.keys(VOL_TOKENS) as BandId[]) out.vol[band] = read(VOL_TOKENS[band], FALLBACK_PALETTE.vol[band])
    for (const key of MOVEMENT_KEYS) out.mv[key] = read(`var(--color-mv-${key})`, FALLBACK_PALETTE.mv[key])
    return out
  } finally {
    probe.remove()
    if (previous === undefined) delete root.dataset.theme
    else root.dataset.theme = previous
  }
}

const FONT_FALLBACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
const fontString = (f: FontSpec, family: string) => `${f.weight} ${f.size}px ${family}`

const paths = new WeakMap<AnatomyDoc, { skin: Path2D[]; regions: Path2D[] }>()
function docPaths(doc: AnatomyDoc) {
  let p = paths.get(doc)
  if (!p) {
    p = { skin: doc.silhouette.map((s) => new Path2D(s.d)), regions: doc.regions.map((r) => new Path2D(r.d)) }
    paths.set(doc, p)
  }
  return p
}

export type ShadeFn = (group: string, sets: number, scale: MapScale) => BandId

export type RenderInput = {
  layout: ImageLayout
  docs: Record<AnatomyView, AnatomyDoc>
  groups: Readonly<Record<string, number>>
  shade: ShadeFn
  palette: Palette
  fileName: string
}

function drawFigure(ctx: CanvasRenderingContext2D, doc: AnatomyDoc, op: Extract<DrawOp, { t: 'map' }>, input: RenderInput) {
  const { palette, groups, shade, layout } = input
  const k = op.h / MAP_HEIGHT
  const p = docPaths(doc)
  ctx.save()
  ctx.translate(op.x, op.y)
  ctx.scale(k, k)
  ctx.fillStyle = palette.skin
  doc.silhouette.forEach((s, i) => ctx.fill(p.skin[i], s.evenodd ? 'evenodd' : 'nonzero'))
  ctx.strokeStyle = palette.bg
  ctx.lineWidth = 1.5 / k
  ctx.lineJoin = 'round'
  doc.regions.forEach((r, i) => {
    ctx.fillStyle =
      r.untracked || !r.group ? palette.untracked : palette.vol[shade(r.group, groups[r.group] ?? 0, layout.scale)]
    ctx.fill(p.regions[i], r.evenodd ? 'evenodd' : 'nonzero')
    ctx.stroke(p.regions[i])
  })
  ctx.restore()
}

/** A canvas text measurer, so layout and drawing agree. */
export function canvasMeasure(): { measure: Measure; family: string } {
  const family = (typeof document !== 'undefined' && getComputedStyle(document.body).fontFamily) || FONT_FALLBACK
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  return {
    family,
    measure: (text, font) => {
      ctx.font = fontString(font, family)
      return ctx.measureText(text).width
    },
  }
}

export function renderImage(input: RenderInput, family: string): Promise<File> {
  const { layout, palette } = input
  const canvas = document.createElement('canvas')
  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('canvas unavailable'))
  ctx.fillStyle = palette.bg
  ctx.fillRect(0, 0, layout.width, layout.height)
  ctx.textBaseline = 'top'
  for (const op of layout.ops) {
    if (op.t === 'text') {
      ctx.font = fontString(op.font, family)
      ctx.fillStyle = palette[op.color]
      ctx.textAlign = op.align ?? 'left'
      ctx.fillText(op.text, op.x, op.y)
    } else if (op.t === 'rule') {
      ctx.fillStyle = palette.line
      ctx.fillRect(op.x, op.y, op.w, 2)
    } else if (op.t === 'swatch') {
      ctx.fillStyle = palette.vol[op.band]
      ctx.fillRect(op.x, op.y, op.w, op.h)
    } else if (op.t === 'fill') {
      ctx.fillStyle = palette.mv[op.group]
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(op.x, op.y, op.w, op.h, op.r)
      else ctx.rect(op.x, op.y, op.w, op.h)
      ctx.fill()
    } else {
      drawFigure(ctx, input.docs[op.view], op, input)
    }
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => {
      if (blob) resolve(new File([blob], input.fileName, { type: 'image/png' }))
      else reject(new Error('toBlob failed'))
    }, 'image/png'),
  )
}
