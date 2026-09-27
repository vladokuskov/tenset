// Encodes RGB(A) pixel buffers as WebP through Blender (local ffmpeg has no libwebp; no encoder ships).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import { CACHE, ROOT } from '../lib/paths.ts'

export type WebpJob = { out: string; width: number; height: number; rgba: Uint8Array; quality: number; alpha?: boolean }

export function writePng(file: string, width: number, height: number, rgba: Uint8Array, alpha = true) {
  const png = new PNG({ width, height, colorType: alpha ? 6 : 2, inputHasAlpha: true })
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, PNG.sync.write(png))
}

export function encodeWebp(jobs: WebpJob[]) {
  const tmp = path.join(CACHE, 'atlas/png')
  fs.mkdirSync(tmp, { recursive: true })
  const args: string[] = []
  for (const j of jobs) {
    const png = path.join(tmp, `${path.basename(j.out, '.webp')}.png`)
    writePng(png, j.width, j.height, j.rgba, j.alpha ?? false)
    args.push(png, j.out, String(j.quality))
  }
  const log = execFileSync(process.env.BLENDER ?? 'blender', ['-b', '--factory-startup', '-P', path.join(ROOT, 'pipeline/atlas/webp.py'), '--', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  }).toString()
  const ok = log.split('\n').filter((l) => l.startsWith('WEBP_OK')).length
  if (ok !== jobs.length) throw new Error(`WebP encode failed:\n${log.slice(-3000)}`)
  return jobs.map((j) => ({ out: j.out, bytes: fs.statSync(j.out).size }))
}
