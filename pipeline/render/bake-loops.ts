// Bakes each motion exercise's H.264 loop and WebP poster from /dev/motion in Chromium on Metal.
// Frames come from renderAt(i / N) (N = loop seconds x 30), are drawn at 2x on the media background and scaled to
// 480 px by ffmpeg (libx264, yuv420p, one keyframe at the loop start, +faststart, no audio). The poster is the
// middle of the concentric without the pulse, on the same background (RENDER.posterAlpha keeps alpha). Files get
// content-hash names (see media.ts) and public/media/manifest.json maps exercise id -> { poster, loop, hash,
// frames, duration }. Fresh entries are skipped unless --force; a full run prunes entries and files that no baked
// motion needs any more.
// node pipeline/render/bake-loops.ts [--only 203,711] [--force] [--qa qa/out/loops]
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type { Page } from '@playwright/test'
import { createServer } from 'vite'
import { PUBLIC, ROOT } from '../lib/paths.ts'
import {
  LOOPS,
  MANIFEST,
  MEDIA_FILE,
  POSTERS,
  RENDER,
  isFresh,
  mediaJobs,
  mediaName,
  readManifest,
  sortManifest,
  type Manifest,
  type MediaEntry,
  type MediaJob,
} from './media.ts'
import { launchMetal } from './still.ts'

const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    force: { type: 'boolean', default: false },
    qa: { type: 'string', default: 'qa/out/loops' },
  },
})

const log = (s: string) => console.log(s)
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`

// HMR off: an edit elsewhere in the repo must not reload the page halfway through a loop
async function startServer() {
  const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 5191, strictPort: false, hmr: false }, optimizeDeps: { entries: ['index.html'] } })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (!url) throw new Error('dev server has no local url')
  return { server, url: url.replace(/\/$/, '') }
}

type BakeWindow = { __ready?: boolean; __bakePulse?: boolean; __bakeTicks?: number; renderAt(u: number): Promise<void> }

// runs in the page: the clock module is the app's own instance (Vite serves it at its source path), so wrapping
// tick lets the bake switch the concentric pulse off for the poster without a dev-route flag
async function hookClock() {
  const w = window as unknown as BakeWindow
  const { MotionClock } = await import(/* @vite-ignore */ String('/src/features/figure/motion/clock.ts'))
  const proto = MotionClock.prototype as { tick(dt: number, d: number): void; __baked?: boolean; pulse: boolean }
  if (proto.__baked) return
  const tick = proto.tick
  proto.tick = function (this: { pulse: boolean }, dt: number, d: number) {
    w.__bakeTicks = (w.__bakeTicks ?? 0) + 1
    if (w.__bakePulse !== undefined) this.pulse = w.__bakePulse
    tick.call(this, dt, d)
  }
  proto.__baked = true
}

function canvasInfo() {
  const c = document.querySelector('canvas')
  if (!c) return { renderer: 'no canvas', w: 0, h: 0 }
  const gl = c.getContext('webgl2')
  const ext = gl?.getExtension('WEBGL_debug_renderer_info')
  return { renderer: gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'no webgl2', w: c.width, h: c.height }
}

// runs in the page: the WebGL canvas drawn into a 2D canvas (optionally over a background and scaled), then toBlob
async function grab({ u, pulse, bg, size, type, quality }: { u: number; pulse: boolean; bg?: string; size?: number; type: string; quality?: number }) {
  const w = window as unknown as BakeWindow
  w.__bakePulse = pulse
  const ticks = w.__bakeTicks ?? 0
  await w.renderAt(u)
  if ((w.__bakeTicks ?? 0) - ticks < 2) throw new Error('the clock hook did not run')
  const src = document.querySelector('canvas')!
  const c = document.createElement('canvas')
  c.width = size ?? src.width
  c.height = size ?? src.height
  const g = c.getContext('2d')!
  if (bg) {
    g.fillStyle = bg
    g.fillRect(0, 0, c.width, c.height)
  }
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.drawImage(src, 0, 0, c.width, c.height)
  const blob = await new Promise<Blob | null>((done) => c.toBlob(done, type, quality))
  if (!blob || blob.type !== type) throw new Error(`toBlob gave ${blob?.type ?? 'nothing'}, wanted ${type}`)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function ffmpegArgs(job: MediaJob, out: string) {
  const n = job.frames
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(RENDER.fps), '-c:v', 'png', '-i', '-',
    '-vf', `scale=${RENDER.size}:${RENDER.size}:flags=lanczos+accurate_rnd+full_chroma_int:out_color_matrix=bt709:out_range=tv,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryslow', '-tune', 'animation', '-crf', String(RENDER.crf),
    '-profile:v', 'high', '-level:v', '3.1',
    '-g', String(n), '-keyint_min', String(n), '-sc_threshold', '0', '-x264-params', 'open-gop=0',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    '-r', String(RENDER.fps), '-frames:v', String(n), '-an', '-map_metadata', '-1', '-movflags', '+faststart',
    out,
  ]
}

/** top-level MP4 box types in file order */
function mp4Boxes(buf: Buffer): string[] {
  const out: string[] = []
  for (let p = 0; p + 8 <= buf.length;) {
    let size = buf.readUInt32BE(p)
    const type = buf.toString('latin1', p + 4, p + 8)
    if (size === 1) size = Number(buf.readBigUInt64BE(p + 8))
    else if (size === 0) size = buf.length - p
    out.push(type)
    if (size < 8) break
    p += size
  }
  return out
}

function verifyLoop(file: string, job: MediaJob) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,pix_fmt,width,height,nb_frames,r_frame_rate', '-of', 'json', file], { encoding: 'utf8' })
  if (probe.status !== 0) throw new Error(`ffprobe failed: ${probe.stderr}`)
  const streams = (JSON.parse(probe.stdout) as { streams: Record<string, string | number>[] }).streams
  const v = streams[0]
  const want = { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: RENDER.size, height: RENDER.size, nb_frames: String(job.frames), r_frame_rate: `${RENDER.fps}/1` }
  if (streams.length !== 1) throw new Error(`${file}: ${streams.length} streams, want 1 (video only)`)
  for (const [k, x] of Object.entries(want)) if (v[k] !== x) throw new Error(`${file}: ${k} is ${v[k]}, want ${x}`)
  const keys = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'frame=key_frame', '-of', 'csv=p=0', file], { encoding: 'utf8' })
  const flags = keys.stdout.trim().split('\n').map((l) => l.trim().replace(/,$/, ''))
  if (flags.length !== job.frames || flags[0] !== '1' || flags.slice(1).some((f) => f !== '0')) throw new Error(`${file}: keyframes ${flags.map((f, i) => (f === '1' ? i : -1)).filter((i) => i >= 0).join(',')}, want only 0`)
  const boxes = mp4Boxes(readFileSync(file))
  if (boxes.indexOf('moov') < 0 || boxes.indexOf('moov') > boxes.indexOf('mdat')) throw new Error(`${file}: moov after mdat (${boxes.join(',')}), not faststart`)
}

function verifyPoster(buf: Buffer) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') throw new Error('poster is not WebP')
  const chunk = buf.toString('latin1', 12, 16)
  const alpha = chunk === 'VP8X' && !!(buf[20] & 0x10)
  if (alpha !== RENDER.posterAlpha) throw new Error(`poster alpha is ${alpha}, want ${RENDER.posterAlpha}`)
  let w = 0, h = 0
  if (chunk === 'VP8X') [w, h] = [buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1]
  else if (chunk === 'VP8 ') [w, h] = [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff]
  if (w !== RENDER.size || h !== RENDER.size) throw new Error(`poster is ${w}x${h} (${chunk}), want ${RENDER.size}`)
}

async function bakeOne(page: Page, base: string, job: MediaJob, qaDir: string): Promise<MediaEntry> {
  const px = RENDER.size * RENDER.supersample
  await page.goto(`${base}/dev/motion?${new URLSearchParams({ id: String(job.id), t: '0', paused: '1', view: RENDER.view })}`)
  await page.waitForFunction(() => (window as unknown as BakeWindow).__ready === true, undefined, { timeout: 120_000 })
  const info = await page.evaluate(canvasInfo)
  if (!info.renderer.includes('Metal')) throw new Error(`${job.slug}: canvas renderer is not Metal: ${info.renderer}`)
  if (info.w !== px || info.h !== px) throw new Error(`${job.slug}: canvas is ${info.w}x${info.h}, want ${px}`)
  await page.evaluate(hookClock)

  const loopName = mediaName(job, 'mp4')
  const loopFile = path.join(LOOPS, loopName)
  const ff = spawn('ffmpeg', ffmpegArgs(job, loopFile), { stdio: ['pipe', 'inherit', 'pipe'] })
  let err = ''
  ff.stderr.on('data', (d) => (err += d))
  const exited = once(ff, 'exit')
  const t0 = Date.now()
  for (let i = 0; i < job.frames; i++) {
    const png = Buffer.from(await page.evaluate(grab, { u: i / job.frames, pulse: true, bg: RENDER.background, type: 'image/png' }), 'base64')
    if (!ff.stdin.write(png)) await once(ff.stdin, 'drain')
    if ((i + 1) % 40 === 0) log(`    frame ${i + 1}/${job.frames} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
  }
  ff.stdin.end()
  const [code] = await exited
  if (code !== 0) throw new Error(`${job.slug}: ffmpeg exited ${code}: ${err}`)
  verifyLoop(loopFile, job)

  const posterName = mediaName(job, 'webp')
  const poster = Buffer.from(await page.evaluate(grab, { u: job.midRep, pulse: false, bg: RENDER.posterAlpha ? undefined : RENDER.background, size: RENDER.size, type: 'image/webp', quality: RENDER.posterQuality }), 'base64')
  verifyPoster(poster)
  writeFileSync(path.join(POSTERS, posterName), poster)

  // QA: 8 evenly spaced frames of the encoded loop in one strip
  const step = Math.max(1, Math.floor(job.frames / 8))
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', loopFile, '-vf', `select='not(mod(n\\,${step}))',scale=240:-1,tile=8x1`, '-frames:v', '1', '-update', '1', path.join(qaDir, `${job.slug}.png`)])

  return {
    poster: `media/posters/${posterName}`,
    loop: `media/loops/${loopName}`,
    hash: job.hash,
    frames: job.frames,
    duration: job.duration,
    inputs: job.inputs,
  }
}

async function posterSheet(page: Page, manifest: Manifest, out: string) {
  // every poster on the media background (and on a dark surface when they carry alpha, to check the edges)
  const cells = Object.entries(manifest).map(([id, e]) => {
    const src = `data:image/webp;base64,${readFileSync(path.join(PUBLIC, e.poster)).toString('base64')}`
    return `<figure><div style="background:${RENDER.background}"><img src="${src}"></div>${RENDER.posterAlpha ? `<div style="background:#1f1f22"><img src="${src}"></div>` : ''}<figcaption>${id}</figcaption></figure>`
  })
  await page.setViewportSize({ width: 6 * 260, height: 100 })
  await page.setContent(`<style>body{margin:0;font:12px system-ui;background:#888;display:grid;grid-template-columns:repeat(6,260px)}figure{margin:0}figure>div{height:130px;display:flex;justify-content:center}img{height:130px}figcaption{text-align:center;color:#fff}</style>${cells.join('')}`)
  await page.waitForFunction(() => [...document.images].every((i) => i.complete))
  await page.screenshot({ path: out, fullPage: true })
}

async function main() {
  const only = values.only?.split(',').map(Number)
  const all = mediaJobs()
  const jobs = all.filter((j) => !only || only.includes(j.id))
  if (only && jobs.length !== only.length) throw new Error(`unknown ids: ${only.filter((id) => !all.some((j) => j.id === id)).join(', ')}`)
  const qaDir = path.resolve(ROOT, values.qa!)
  for (const d of [LOOPS, POSTERS, qaDir]) mkdirSync(d, { recursive: true })
  const manifest: Manifest = readManifest()
  const todo = jobs.filter((j) => values.force || !isFresh(j, manifest[j.id]))
  log(`${jobs.length} exercises, ${todo.length} to bake${todo.length < jobs.length ? ` (${jobs.length - todo.length} fresh, --force re-bakes)` : ''}`)

  const save = () => writeFileSync(MANIFEST, JSON.stringify(sortManifest(manifest), null, 2) + '\n')
  const drop = (rel: string | undefined) => {
    if (!rel) return
    try {
      unlinkSync(path.join(PUBLIC, rel))
    } catch {
      /* already gone */
    }
  }

  if (todo.length) {
    const { browser, renderer } = await launchMetal()
    log(`renderer: ${renderer}`)
    const { server, url } = await startServer()
    const origin = new URL(url).origin
    const foreign = new Set<string>()
    try {
      const ctx = await browser.newContext({ viewport: { width: RENDER.size, height: RENDER.size }, deviceScaleFactor: RENDER.supersample })
      ctx.on('request', (r) => {
        const u = new URL(r.url())
        if (u.origin !== origin && u.protocol !== 'data:' && u.protocol !== 'blob:') foreign.add(r.url())
      })
      const page = await ctx.newPage()
      page.on('pageerror', (e) => console.error('  pageerror:', e.message))
      page.on('console', (m) => {
        if (m.type() === 'error') console.error('  console:', m.text())
      })
      for (const [k, job] of todo.entries()) {
        const t0 = Date.now()
        log(`[${k + 1}/${todo.length}] ${job.slug} (${job.frames} frames, hash ${job.hash})`)
        const entry = await bakeOne(page, url, job, qaDir)
        if (foreign.size) throw new Error(`third-party requests: ${[...foreign].join(', ')}`)
        const now = mediaJobs().find((j) => j.id === job.id)
        if (now?.hash !== job.hash) {
          drop(entry.poster)
          drop(entry.loop)
          throw new Error(`${job.slug}: inputs changed during the bake (${job.hash} -> ${now?.hash}); run again`)
        }
        const old = manifest[job.id]
        if (old && old.poster !== entry.poster) drop(old.poster)
        if (old && old.loop !== entry.loop) drop(old.loop)
        manifest[job.id] = entry
        save()
        const loopBytes = statSync(path.join(PUBLIC, entry.loop)).size
        const posterBytes = statSync(path.join(PUBLIC, entry.poster)).size
        log(`    loop ${kb(loopBytes)}, poster ${kb(posterBytes)} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
      }
      if (!only) await posterSheet(page, sortManifest(manifest), path.join(qaDir, 'posters.png'))
    } finally {
      await browser.close()
      await server.close()
    }
  }

  if (!only) {
    // prune entries without a baked motion and files no entry references
    const ids = new Set(all.map((j) => String(j.id)))
    for (const id of Object.keys(manifest)) {
      if (ids.has(id)) continue
      drop(manifest[id].poster)
      drop(manifest[id].loop)
      delete manifest[id]
      log(`pruned entry ${id}`)
    }
    const used = new Set(Object.values(manifest).flatMap((e) => [e.poster, e.loop]))
    for (const [dir, rel] of [[POSTERS, 'media/posters'], [LOOPS, 'media/loops']] as const) {
      for (const f of readdirSync(dir)) {
        if (MEDIA_FILE.test(f) && !used.has(`${rel}/${f}`)) {
          unlinkSync(path.join(dir, f))
          log(`pruned ${rel}/${f}`)
        }
      }
    }
    save()
  }

  let loops = 0, posters = 0
  log('\nid     loop       poster     frames')
  for (const job of jobs) {
    const e = manifest[job.id]
    if (!e) continue
    const l = statSync(path.join(PUBLIC, e.loop)).size, p = statSync(path.join(PUBLIC, e.poster)).size
    loops += l
    posters += p
    log(`${String(job.id).padEnd(6)} ${kb(l).padStart(9)}  ${kb(p).padStart(9)}  ${e.frames}`)
  }
  log(`total  ${kb(loops).padStart(9)}  ${kb(posters).padStart(9)}  (${kb(loops + posters)} for ${jobs.length} exercises)`)
}

await main()
