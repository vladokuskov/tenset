// Re-renders the poster frame of shipped exercises with the current code (same page, camera and settings as
// bake-loops.ts) and compares it byte for byte with the baked poster. Proves a code change (shared helpers, the
// composer, props, grips) leaves the approved renders alone; writes nothing into public/.
// node pipeline/render/verify-posters.ts [--only 203,711] [--family F1]
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { PUBLIC } from '../lib/paths.ts'
import { selection } from '../motion/load.ts'
import { canvasInfo, grab, hookClock, startServer, type BakeWindow } from './bake-loops.ts'
import { isFresh, mediaJobs, readManifest, RENDER } from './media.ts'
import { launchMetal } from './still.ts'

const { values } = parseArgs({ options: { only: { type: 'string' }, family: { type: 'string' } } })
const pick = selection(values.only, values.family)
const manifest = readManifest()
const jobs = mediaJobs().filter((j) => (!pick || pick.has(j.id, j.slug)) && isFresh(j, manifest[j.id]))
if (!jobs.length) throw new Error('no exercise with fresh baked media selected')
const { browser, renderer } = await launchMetal()
console.log(`renderer: ${renderer}`)
const { server, url } = await startServer()
let bad = 0
try {
  const ctx = await browser.newContext({ viewport: { width: RENDER.size, height: RENDER.size }, deviceScaleFactor: RENDER.supersample })
  const page = await ctx.newPage()
  for (const job of jobs) {
    await page.goto(`${url}/dev/motion?${new URLSearchParams({ id: String(job.id), t: '0', paused: '1', view: RENDER.view })}`)
    await page.waitForFunction(() => (window as unknown as BakeWindow).__ready === true, undefined, { timeout: 120_000 })
    const info = await page.evaluate(canvasInfo)
    if (!info.renderer.includes('Metal')) throw new Error(`canvas renderer is not Metal: ${info.renderer}`)
    await page.evaluate(hookClock)
    const poster = Buffer.from(await page.evaluate(grab, { u: job.midRep, pulse: false, bg: RENDER.posterAlpha ? undefined : RENDER.background, size: RENDER.size, type: 'image/webp', quality: RENDER.posterQuality }), 'base64')
    const same = poster.equals(readFileSync(path.join(PUBLIC, manifest[job.id].poster)))
    if (!same) bad++
    console.log(`${same ? 'same' : 'CHANGED'} ${job.slug}`)
  }
} finally {
  await browser.close()
  await server.close()
}
console.log(bad ? `${bad} of ${jobs.length} posters render differently` : `${jobs.length} posters render identically`)
process.exit(bad ? 1 : 0)
