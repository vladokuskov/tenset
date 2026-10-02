import type { MapScale } from '../../app/volumeScale'
import type { BandId } from '../../domain/volume'
import { MAP_ASPECT, MAP_HEIGHT, type AnatomyDoc, type AnatomyView } from '../bodymap/anatomy'
import type { EntryText } from './planText'

export const IMAGE_WIDTH = 1080
const PAD = 72
const CONTENT = IMAGE_WIDTH - 2 * PAD

export type FontSpec = { size: number; weight: 400 | 600 | 700 }
export type Measure = (text: string, font: FontSpec) => number
export type TextColor = 'ink' | 'ink2' | 'ink3'

export type DrawOp =
  | { t: 'text'; x: number; y: number; text: string; font: FontSpec; color: TextColor; align?: 'left' | 'center' }
  | { t: 'rule'; x: number; y: number; w: number }
  | { t: 'map'; x: number; y: number; h: number; view: AnatomyView }
  | { t: 'swatch'; x: number; y: number; w: number; h: number; band: BandId }

export type ImageLayout = { width: number; height: number; scale: MapScale; ops: DrawOp[] }

export type DayImageContent = {
  title: string
  summary: string
  rows: readonly EntryText[]
  /** Shown instead of rows: "Rest day", "No exercises yet". */
  empty?: string
  note?: string
  footer: string
  app: string
}

export type WeekImageRow = { day: string; title?: string; summary: string; groups?: string; rest: boolean }

export type WeekImageContent = {
  title: string
  subtitle: string
  rows: readonly WeekImageRow[]
  legend: readonly { band: BandId; label: string }[]
  mapCaption: string
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

function footer(ops: DrawOp[], measure: Measure, y: number, text: string, app: string): number {
  y += 48
  ops.push({ t: 'rule', x: PAD, y, w: CONTENT })
  y = textBlock(ops, measure, text, F.footer, 'ink3', PAD, y + 24, CONTENT)
  y = textBlock(ops, measure, app, F.app, 'ink2', PAD, y + 8, CONTENT, 1)
  return y + PAD - 16
}

const DAY_MAP_H = 340
const MAP_GAP = 20

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
  for (const row of c.rows) {
    const top = y + 26
    if (row.marker) ops.push({ t: 'text', x: PAD, y: top + 2, text: row.marker, font: F.marker, color: 'ink' })
    const x = PAD + markerW
    y = textBlock(ops, measure, row.name, F.name, 'ink', x, top, CONTENT - markerW, 2)
    y = textBlock(ops, measure, row.parts.join(' · '), F.detail, 'ink2', x, y + 6, CONTENT - markerW, 2) + 26
    ops.push({ t: 'rule', x: PAD, y, w: CONTENT })
  }
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
}

/** Light-theme token values in sRGB, used when the browser's canvas cannot read the computed color. */
export const FALLBACK_PALETTE: Palette = {
  bg: '#f7f5f3',
  ink: '#1d1a17',
  ink2: '#57514d',
  ink3: '#6d6863',
  line: '#d9d5d0',
  skin: '#e1ddd9',
  untracked: '#dad6d1',
  vol: {
    none: '#d2cdc8',
    light: '#a3b5d4',
    moderate: '#7493d0',
    target: '#4b70c7',
    high: '#314ea9',
    very_high: '#22337c',
  },
}

const TOKENS: Record<Exclude<keyof Palette, 'vol'>, string> = {
  bg: 'var(--color-surface)',
  ink: 'var(--color-ink)',
  ink2: 'var(--color-ink-2)',
  ink3: 'var(--color-ink-3)',
  line: 'var(--color-line)',
  skin: 'var(--color-map-skin)',
  untracked: 'color-mix(in oklab, var(--color-vol-none) 45%, var(--color-map-skin))',
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
    const out = { ...FALLBACK_PALETTE, vol: { ...FALLBACK_PALETTE.vol } }
    for (const key of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) out[key] = read(TOKENS[key], FALLBACK_PALETTE[key])
    for (const band of Object.keys(VOL_TOKENS) as BandId[]) out.vol[band] = read(VOL_TOKENS[band], FALLBACK_PALETTE.vol[band])
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
