import { useSyncExternalStore } from 'react'
import { decodeIdRaster, type IdRaster } from '../../domain/idRaster'
import { regionFill } from './fills'

export type AnatomyView = 'front' | 'back'
/** full: head-level regions (front.svg). groups: coarse group regions for mini maps (front.groups.svg). */
export type AnatomyKind = 'full' | 'groups'

export type Bounds = { x0: number; y0: number; x1: number; y1: number }

export type AnatomyRegion = {
  d: string
  /** The subject's anatomical side, not the screen side. */
  side: 'l' | 'r'
  evenodd: boolean
  group?: string
  head?: string
  untracked?: string
  bounds: Bounds
}

export type AnatomyDoc = {
  view: AnatomyView
  kind: AnatomyKind
  viewBox: string
  width: number
  height: number
  silhouette: { d: string; evenodd: boolean }[]
  regions: AnatomyRegion[]
}

export const MAP_WIDTH = 816
export const MAP_HEIGHT = 2048
export const MAP_ASPECT = MAP_WIDTH / MAP_HEIGHT
/** Tap sampling radius in CSS px; converted to raster cells for the drawn size, so 2x zoom halves it in cells. */
export const TAP_RADIUS_PX = 12

const docs = new Map<string, AnatomyDoc>()
const rasters = new Map<AnatomyView, IdRaster>()
const pending = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()

const keyOf = (view: AnatomyView, kind: AnatomyKind) => `${view}${kind === 'groups' ? '.groups' : ''}`
const url = (file: string) => `${import.meta.env.BASE_URL}anatomy/${file}`
const notify = () => listeners.forEach((l) => l())

// Paths are polygons written as "M x y l dx dy ... z", one ring per M.
export function pathBounds(d: string): Bounds {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (const ring of d.split('M').slice(1)) {
    const nums = ring.match(/-?(?:\d+\.?\d*|\.\d+)/g)?.map(Number) ?? []
    let x = nums[0], y = nums[1]
    for (let i = 0; i < nums.length; i += 2) {
      if (i > 0) {
        x += nums[i]
        y += nums[i + 1]
      }
      if (x < b.x0) b.x0 = x
      if (x > b.x1) b.x1 = x
      if (y < b.y0) b.y0 = y
      if (y > b.y1) b.y1 = y
    }
  }
  return b
}

function parse(text: string, view: AnatomyView, kind: AnatomyKind): AnatomyDoc {
  const svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement
  const viewBox = svg.getAttribute('viewBox') ?? `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`
  const [, , width, height] = viewBox.split(/\s+/).map(Number)
  const pathOf = (p: Element) => ({ d: p.getAttribute('d') ?? '', evenodd: p.getAttribute('fill-rule') === 'evenodd' })
  const silhouette = [...svg.querySelectorAll('#silhouette path')].map(pathOf)
  const regions = [...svg.querySelectorAll('#regions path, #groups path')].map((p) => {
    const base = pathOf(p)
    return {
      ...base,
      side: (p.getAttribute('data-side') === 'l' ? 'l' : 'r') as 'l' | 'r',
      group: p.getAttribute('data-group') ?? undefined,
      head: p.getAttribute('data-head') ?? undefined,
      untracked: p.getAttribute('data-untracked') ?? undefined,
      bounds: pathBounds(base.d),
    }
  })
  return { view, kind, viewBox, width, height, silhouette, regions }
}

// One hidden <svg> holds a <symbol> per view and kind. Mini maps and cards draw it with <use>
// and set fills through CSS variables, so many instances stay cheap:
//   --g-<group> region fill by group, --h-<head> by head (wins), --gb-rest for everything else,
//   --gb-skin silhouette, --gb-untracked untracked muscles, --gb-line / --gb-line-w outlines.
export const symbolId = (view: AnatomyView, kind: AnatomyKind) => `gb-anatomy-${keyOf(view, kind).replace('.', '-')}`

const LINE = 'stroke:var(--gb-line,none);stroke-width:var(--gb-line-w,1px);stroke-linejoin:round'

function symbolMarkup(doc: AnatomyDoc): string {
  const rule = (evenodd: boolean) => (evenodd ? ' fill-rule="evenodd"' : '')
  const skin = doc.silhouette.map(
    (p) => `<path d="${p.d}"${rule(p.evenodd)} style="fill:var(--gb-skin,var(--color-map-skin))"/>`,
  )
  const regions = doc.regions.map((r) => {
    const fill = regionFill(r.group, r.head, r.untracked)
    return `<path d="${r.d}"${rule(r.evenodd)} vector-effect="non-scaling-stroke" style="fill:${fill};${LINE}"/>`
  })
  return `<symbol id="${symbolId(doc.view, doc.kind)}" viewBox="${doc.viewBox}">${skin.join('')}${regions.join('')}</symbol>`
}

function injectSymbol(doc: AnatomyDoc) {
  if (typeof document === 'undefined') return
  let host: Element | null = document.getElementById('gb-anatomy-sprite')
  if (!host) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.id = 'gb-anatomy-sprite'
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('focusable', 'false')
    svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none')
    document.body.appendChild(svg)
    host = svg
  }
  const id = symbolId(doc.view, doc.kind)
  if (document.getElementById(id)) return
  const parsed = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${symbolMarkup(doc)}</svg>`,
    'image/svg+xml',
  )
  host.appendChild(document.importNode(parsed.documentElement.firstElementChild!, true))
}

function once(key: string, run: () => Promise<void>): Promise<void> {
  let p = pending.get(key)
  if (!p) {
    p = run().catch((err: unknown) => {
      pending.delete(key)
      if (import.meta.env.DEV) console.warn(err)
    })
    pending.set(key, p)
  }
  return p
}

async function fetchOk(file: string): Promise<Response> {
  const r = await fetch(url(file))
  if (!r.ok) throw new Error(`anatomy ${file}: ${r.status}`)
  return r
}

/** Fetches and parses one map file once; every later call resolves from the cache. */
export function loadAnatomy(view: AnatomyView, kind: AnatomyKind): Promise<void> {
  const key = keyOf(view, kind)
  if (docs.has(key)) return Promise.resolve()
  return once(key, async () => {
    const doc = parse(await (await fetchOk(`${key}.svg`)).text(), view, kind)
    docs.set(key, doc)
    injectSymbol(doc)
    notify()
  })
}

/** Group-index raster for tap hit-testing ({view}.ids.bin). */
export function loadIdRaster(view: AnatomyView): Promise<void> {
  if (rasters.has(view)) return Promise.resolve()
  return once(`${view}.ids`, async () => {
    rasters.set(view, decodeIdRaster(new Uint8Array(await (await fetchOk(`${view}.ids.bin`)).arrayBuffer())))
    notify()
  })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Parsed map art, shared across all instances; null until the first fetch resolves. */
export function useAnatomy(view: AnatomyView, kind: AnatomyKind): AnatomyDoc | null {
  const key = keyOf(view, kind)
  if (!docs.has(key)) void loadAnatomy(view, kind)
  return useSyncExternalStore(subscribe, () => docs.get(key) ?? null, () => null)
}

export function useIdRaster(view: AnatomyView, enabled = true): IdRaster | null {
  if (enabled && !rasters.has(view)) void loadIdRaster(view)
  return useSyncExternalStore(subscribe, () => (enabled ? (rasters.get(view) ?? null) : null), () => null)
}

/** Union of the bounds of regions matching the predicate, or null when none match. */
export function regionBounds(doc: AnatomyDoc, match: (r: AnatomyRegion) => boolean): Bounds | null {
  let out: Bounds | null = null
  for (const r of doc.regions) {
    if (!match(r)) continue
    const b = r.bounds
    out = out
      ? { x0: Math.min(out.x0, b.x0), y0: Math.min(out.y0, b.y0), x1: Math.max(out.x1, b.x1), y1: Math.max(out.y1, b.y1) }
      : { ...b }
  }
  return out
}

/**
 * A viewBox around `b` with the given aspect (width / height), at least `minHeight` tall,
 * padded, and kept inside the figure vertically.
 */
export function cropViewBox(b: Bounds, aspect: number, minHeight: number, pad = 0.12): string {
  let h = Math.max(minHeight, (b.y1 - b.y0) * (1 + 2 * pad), ((b.x1 - b.x0) * (1 + 2 * pad)) / aspect)
  h = Math.min(h, MAP_HEIGHT)
  const w = h * aspect
  const cx = (b.x0 + b.x1) / 2
  const cy = (b.y0 + b.y1) / 2
  const y = Math.max(0, Math.min(MAP_HEIGHT - h, cy - h / 2))
  const x = w >= MAP_WIDTH ? (MAP_WIDTH - w) / 2 : Math.max(0, Math.min(MAP_WIDTH - w, cx - w / 2))
  return `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`
}

// Start fetching the mini map art as soon as any map is imported.
if (typeof window !== 'undefined') {
  void loadAnatomy('front', 'groups')
  void loadAnatomy('back', 'groups')
}
