// Loop seam check: how visible the restart of a baked loop is. Decodes each loop and compares the jump across the
// restart (last frame -> first) with the steps between the still frames either side of it (the top pause is still, so
// a clean seam jumps no more than those). Luma only, over the pixels the figure and props cover.
// node pipeline/render/seam.ts [--only 203,711]                                  measure the loops in the manifest
// node pipeline/render/seam.ts --frames qa/out/seam --only 401,711 --render      save their source frames (Metal)
// node pipeline/render/seam.ts --frames qa/out/seam --trial [--seam none,k2:q8:m] encode the saved frames per setting
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { PUBLIC, ROOT } from '../lib/paths.ts'
import { encodeLoop, grab, hookClock, scaleArgs, startServer, YUV_FRAME, type BakeWindow } from './bake-loops.ts'
import { mediaJobs, readManifest, RENDER, type SeamSettings } from './media.ts'
import { launchMetal } from './still.ts'

const W = RENDER.size
const PLANE = W * W
/** tv-range luma of the white background is 235; darker than this is figure, props or shadow */
const ACTIVE = 230
/** frames of the still stretch either side of the restart: half the 0.5 s top pause, less one for easing */
const STILL = Math.floor((0.5 / 2) * RENDER.fps) - 1

export type SeamReport = {
  frames: number
  /** mean absolute luma step across the restart, over the active pixels */
  seam: number
  /** 99th percentile of that step */
  seamP99: number
  /** median step between neighbouring still frames next to the restart (excluding it) */
  still: number
  /** seam / max(still, 0.1): about 1 when the restart is as quiet as the pause around it */
  ratio: number
}

/** luma planes of a yuv420p raw stream */
function lumas(raw: Buffer): Buffer[] {
  const n = Math.floor(raw.length / YUV_FRAME)
  return Array.from({ length: n }, (_, i) => raw.subarray(i * YUV_FRAME, i * YUV_FRAME + PLANE))
}

function decode(file: string): Buffer[] {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-'], { maxBuffer: 1 << 30 })
  if (r.status !== 0) throw new Error(`ffmpeg decode failed: ${r.stderr}`)
  return lumas(r.stdout)
}

function step(a: Buffer, b: Buffer, mask: Uint8Array) {
  const d: number[] = []
  for (let i = 0; i < PLANE; i++) if (mask[i]) d.push(Math.abs(a[i] - b[i]))
  d.sort((x, y) => x - y)
  return { mean: d.reduce((s, x) => s + x, 0) / Math.max(1, d.length), p99: d[Math.floor(d.length * 0.99)] ?? 0 }
}

export function seamReport(y: Buffer[], still = STILL): SeamReport {
  const n = y.length
  const mask = new Uint8Array(PLANE)
  for (let i = 0; i < PLANE; i++) mask[i] = y[0][i] < ACTIVE || y[n - 1][i] < ACTIVE ? 1 : 0
  const s = step(y[n - 1], y[0], mask)
  const k = Math.max(2, Math.min(still, Math.floor(n / 4)))
  const pairs: number[] = []
  for (let i = 0; i + 1 < k; i++) pairs.push(step(y[i], y[i + 1], mask).mean)
  for (let i = n - k; i + 1 < n; i++) pairs.push(step(y[i], y[i + 1], mask).mean)
  pairs.sort((a, b) => a - b)
  const quiet = pairs[pairs.length >> 1]
  const r = (x: number) => Math.round(x * 1000) / 1000
  return { frames: n, seam: r(s.mean), seamP99: s.p99, still: r(quiet), ratio: r(s.mean / Math.max(quiet, 0.1)) }
}

const line = (name: string, rep: SeamReport) =>
  `${name.padEnd(32)} seam ${rep.seam.toFixed(2)} (p99 ${rep.seamP99})  still ${rep.still.toFixed(2)}  ratio ${rep.ratio.toFixed(1)}`

async function render(dir: string, only: number[]) {
  const jobs = mediaJobs().filter((j) => only.includes(j.id))
  const { browser } = await launchMetal()
  const { server, url } = await startServer()
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: W }, deviceScaleFactor: RENDER.supersample })
    const page = await ctx.newPage()
    for (const job of jobs) {
      const out = path.join(dir, String(job.id))
      mkdirSync(out, { recursive: true })
      await page.goto(`${url}/dev/motion?${new URLSearchParams({ id: String(job.id), t: '0', paused: '1', view: RENDER.view })}`)
      await page.waitForFunction(() => (window as unknown as BakeWindow).__ready === true, undefined, { timeout: 120_000 })
      await page.evaluate(hookClock)
      for (let i = 0; i < job.frames; i++) {
        const png = Buffer.from(await page.evaluate(grab, { u: i / job.frames, pulse: true, bg: RENDER.background, type: 'image/png' }), 'base64')
        writeFileSync(path.join(out, `${String(i).padStart(4, '0')}.png`), png)
        if ((i + 1) % 40 === 0) console.log(`  ${job.slug} frame ${i + 1}/${job.frames}`)
      }
      console.log(`${job.slug}: ${job.frames} frames in ${path.relative(ROOT, out)}`)
    }
  } finally {
    await browser.close()
    await server.close()
  }
}

/** the saved PNG frames scaled exactly as the bake scales them, raw yuv420p */
function scaled(dir: string) {
  const frames = readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => readFileSync(path.join(dir, f)))
  const r = spawnSync('ffmpeg', scaleArgs(), { input: Buffer.concat(frames), maxBuffer: 1 << 30 })
  if (r.status !== 0) throw new Error(`ffmpeg scale failed: ${r.stderr}`)
  return { yuv: r.stdout, n: frames.length }
}

/** 'none' or 'k<keyBoost>:q<lastQ>[:m]' (m: match the still tail to the decoded keyframe) */
const parseSeam = (s: string): SeamSettings | null => {
  if (s === 'none') return null
  const [k, q, m] = s.split(':')
  return { keyBoost: Number(k.slice(1)), lastQ: Number(q.slice(1)), match: m === 'm' }
}
const seamName = (s: SeamSettings | null) => (s ? `k${s.keyBoost}:q${s.lastQ}${s.match ? ':m' : ''}` : 'none')

function trial(dir: string, only: number[] | undefined, seams: (SeamSettings | null)[]) {
  const ids = readdirSync(dir).filter((d) => /^\d+$/.test(d) && (!only || only.includes(Number(d)))).sort()
  const total = new Map<string, number>()
  for (const id of ids) {
    const { yuv, n } = scaled(path.join(dir, id))
    for (const seam of seams) {
      const file = path.join(dir, `${id}-${seamName(seam).replace(/:/g, '_')}.mp4`)
      const tail = encodeLoop(yuv, n, file, seam)
      const bytes = statSync(file).size
      total.set(seamName(seam), (total.get(seamName(seam)) ?? 0) + bytes)
      console.log(`${line(`${id} ${seamName(seam)}`, seamReport(decode(file)))}  ${(bytes / 1024).toFixed(1)} KB, ${tail} matched`)
    }
  }
  const base = total.get('none')
  if (base) for (const [name, bytes] of total) console.log(`total ${name.padEnd(9)} ${(bytes / 1024).toFixed(1)} KB (${(((bytes / base) - 1) * 100).toFixed(1)}% vs none)`)
}

function measure(only: number[] | undefined) {
  const manifest = readManifest()
  let worst = 0, rows = 0
  for (const job of mediaJobs().filter((j) => !only || only.includes(j.id))) {
    const e = manifest[job.id]
    if (!e || !existsSync(path.join(PUBLIC, e.loop))) continue
    const rep = seamReport(decode(path.join(PUBLIC, e.loop)))
    worst = Math.max(worst, rep.ratio)
    rows++
    console.log(line(job.slug, rep))
  }
  console.log(`worst seam ratio ${worst.toFixed(1)} over ${rows} loops`)
}

async function main() {
  const { values } = parseArgs({ options: { only: { type: 'string' }, frames: { type: 'string' }, render: { type: 'boolean', default: false }, trial: { type: 'boolean', default: false }, seam: { type: 'string' } } })
  const only = values.only?.split(',').map(Number)
  if (values.frames) {
    const dir = path.resolve(ROOT, values.frames)
    if (values.render) await render(dir, only ?? [])
    if (values.trial) trial(dir, only, (values.seam ?? `none,${seamName(RENDER.seam)}`).split(',').map(parseSeam))
    return
  }
  measure(only)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
