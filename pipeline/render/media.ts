// Baked exercise media (loop + poster): render settings, input hashing and the stale-media check shared by
// bake-loops.ts and check-media.ts. A media hash covers everything the render reads from the repo: the figure
// assets (public/models), the skeleton, the exercise record (template, params, highlight roles, camera hint),
// the shipped baked motion, the hero camera its scene picks and the render settings. Code changes that alter the look
// bump RENDER.version.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { CompactMotion } from '../../src/motion/bake.ts'
import { skeletonHash, type SkeletonData } from '../../src/motion/skeleton.ts'
import { sceneFor } from '../../src/features/figure/motion/scenes/index.ts'
import { DATA, PUBLIC, ROOT } from '../lib/paths.ts'

/**
 * the restart (bake-loops.ts seamZones, encodeLoop): the keyframe gets `keyBoost` times the bits, the last frame the
 * fixed quantizer `lastQ`, and with `match` the still frames before the restart are encoded towards the decoded keyframe
 */
export type SeamSettings = { keyBoost: number; lastQ: number; match: boolean }

export const RENDER = {
  version: 5,
  view: 'hero',
  /** output pixels (square) */
  size: 480,
  /** frames are drawn at size * supersample and scaled down with lanczos */
  supersample: 2,
  fps: 30,
  background: '#ffffff',
  crf: 24,
  /** seam trials (pipeline/render/seam.ts): the restart jump about halves against a 4x boost of the 8 frames either
   * side, and the loops come out ~21% larger than without seam treatment instead of ~29% (budget 22%) */
  seam: { keyBoost: 2, lastQ: 8, match: true } as SeamSettings,
  posterQuality: 0.8,
  /** posters on the background like the loops; alpha about doubles their size (11-26 KB instead of 5-13 KB) */
  posterAlpha: false,
  /** QA contact sheet: 8 frames of the encoded loop, this wide each, in a 4 x 2 grid */
  sheetFrame: 480,
} as const

export const BAKED_MOTION = path.join(ROOT, 'src/features/figure/motion/baked')
export const BODY_ASSETS = path.join(PUBLIC, 'models')
export const MEDIA = path.join(PUBLIC, 'media')
export const LOOPS = path.join(MEDIA, 'loops')
export const POSTERS = path.join(MEDIA, 'posters')
export const MANIFEST = path.join(MEDIA, 'manifest.json')

/** paths are relative to the app base (prefix import.meta.env.BASE_URL) */
export type MediaEntry = {
  poster: string
  loop: string
  hash: string
  frames: number
  /** seconds of one loop */
  duration: number
  /** short hash per input, so the stale check can say what changed */
  inputs: Record<InputName, string>
}
export type Manifest = Record<string, MediaEntry>

type InputName = 'body' | 'skeleton' | 'record' | 'motion' | 'camera' | 'renderer'

export type MediaJob = {
  id: number
  /** <id>-<slug> */
  slug: string
  frames: number
  duration: number
  /** loop fraction of the middle of the concentric (the poster frame; reduced motion rests here too) */
  midRep: number
  hash: string
  inputs: Record<InputName, string>
}

export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => stableJson(x ?? null)).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')

function bodyHash(): string {
  const h = createHash('sha256')
  for (const f of readdirSync(BODY_ASSETS).filter((x) => !x.startsWith('.')).sort()) h.update(f).update(readFileSync(path.join(BODY_ASSETS, f)))
  return h.digest('hex')
}

function threeVersion(): string {
  return (JSON.parse(readFileSync(path.join(ROOT, 'node_modules/three/package.json'), 'utf8')) as { version: string }).version
}

type Rec = {
  id: number
  slug: string
  laterality: string
  groups: Record<string, string>
  media: { template: string | null; params: Record<string, unknown>; mapView: 'F' | 'B' }
}

function midConcentric([ecc, pb, con, pt]: CompactMotion['tempo']) {
  return (pt / 2 + ecc + pb + con / 2) / (ecc + pb + con + pt)
}

/** one job per shipped baked motion (src/features/figure/motion/baked/<id>-<slug>.json), with its current media hash */
export function mediaJobs(): MediaJob[] {
  const skeleton = skeletonHash(JSON.parse(readFileSync(path.join(DATA, 'motion-templates/skeleton.json'), 'utf8')) as SkeletonData)
  const body = bodyHash()
  const renderer = sha(stableJson({ ...RENDER, three: threeVersion() }))
  const jobs: MediaJob[] = []
  for (const f of readdirSync(BAKED_MOTION).filter((x) => /^\d+-.+\.json$/.test(x)).sort()) {
    const { id, motion } = JSON.parse(readFileSync(path.join(BAKED_MOTION, f), 'utf8')) as { id: number; motion: CompactMotion }
    const recFile = path.join(DATA, 'exercises', f)
    if (!existsSync(recFile)) throw new Error(`${f}: baked motion has no record at data/exercises/${f}`)
    const rec = JSON.parse(readFileSync(recFile, 'utf8')) as Rec
    const record = sha(stableJson({
      template: rec.media.template,
      params: rec.media.params,
      groups: rec.groups,
      laterality: rec.laterality,
      mapView: rec.media.mapView,
    }))
    // the scene's camera: a camera-only change must reach a new file name (media is served immutable)
    const camera = sha(stableJson(sceneFor(motion.template).camera(motion.params, rec.media.mapView)))
    const parts = { body, skeleton: sha(skeleton), record, motion: sha(stableJson(motion)), camera, renderer }
    const frames = Math.max(2, Math.round(motion.duration * RENDER.fps))
    jobs.push({
      id,
      slug: f.replace(/\.json$/, ''),
      frames,
      duration: Math.round((frames / RENDER.fps) * 1000) / 1000,
      midRep: midConcentric(motion.tempo),
      hash: sha(stableJson(parts)).slice(0, 12),
      inputs: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.slice(0, 8)])) as MediaJob['inputs'],
    })
  }
  return jobs
}

export function readManifest(): Manifest {
  return existsSync(MANIFEST) ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest) : {}
}

export function sortManifest(m: Manifest): Manifest {
  return Object.fromEntries(Object.entries(m).sort(([a], [b]) => Number(a) - Number(b)))
}

export const mediaName = (job: Pick<MediaJob, 'id' | 'hash'>, ext: 'mp4' | 'webp') => `${job.id}-${job.hash}.${ext}`
export const MEDIA_FILE = /^\d+-[0-9a-f]{12}\.(mp4|webp)$/

/** true when the entry exists, matches the current inputs and its files are on disk */
export function isFresh(job: MediaJob, e: MediaEntry | undefined): e is MediaEntry {
  return !!e && e.hash === job.hash && e.frames === job.frames && existsSync(path.join(PUBLIC, e.poster)) && existsSync(path.join(PUBLIC, e.loop))
}

/** every reason the baked media no longer matches the repo; empty when fresh. `scoped`: only these jobs, without the
 * manifest-wide checks (orphan entries and files) */
export function checkMedia(jobs = mediaJobs(), manifest = readManifest(), scoped = false): string[] {
  const issues: string[] = []
  const hint = 'run node pipeline/render/bake-loops.ts'
  for (const job of jobs) {
    const e = manifest[job.id]
    if (!e) {
      issues.push(`${job.slug}: no baked media (${hint} --only ${job.id})`)
      continue
    }
    if (e.hash !== job.hash) {
      const changed = (Object.keys(job.inputs) as InputName[]).filter((k) => e.inputs?.[k] !== job.inputs[k])
      issues.push(`${job.slug}: stale media, ${changed.join(', ') || 'hash'} changed (${hint} --only ${job.id})`)
    }
    if (e.frames !== job.frames) issues.push(`${job.slug}: manifest has ${e.frames} frames, the motion needs ${job.frames}`)
    for (const [kind, rel, dir] of [['poster', e.poster, 'media/posters/'], ['loop', e.loop, 'media/loops/']] as const) {
      if (!rel.startsWith(dir) || !MEDIA_FILE.test(path.basename(rel))) issues.push(`${job.slug}: ${kind} path ${rel} is not ${dir}<id>-<hash>`)
      else if (!existsSync(path.join(PUBLIC, rel))) issues.push(`${job.slug}: ${kind} file public/${rel} is missing`)
    }
  }
  if (scoped) return issues
  const ids = new Set(jobs.map((j) => String(j.id)))
  for (const id of Object.keys(manifest)) if (!ids.has(id)) issues.push(`manifest entry ${id} has no baked motion (${hint} to prune)`)
  const used = new Set(Object.values(manifest).flatMap((e) => [e.poster, e.loop]))
  for (const [dir, rel] of [[POSTERS, 'media/posters'], [LOOPS, 'media/loops']] as const) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).filter((x) => !x.startsWith('.'))) if (!used.has(`${rel}/${f}`)) issues.push(`public/${rel}/${f} is not in the manifest (${hint} to prune)`)
  }
  return issues
}
