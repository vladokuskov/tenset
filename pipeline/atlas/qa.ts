// Atlas QA renders on Metal: highlight sheets for the look-v2 exercise poses, relief close-ups and flat region colours.
// node pipeline/atlas/qa.ts [--out qa/out/polish] [--tag before] [--only relief] [--compare before] [--atlas flat|off]
//   writes <out>/atlas-shots[-tag]/<shot>.png and one sheet per group, <out>/atlas-<group>[-tag].png;
//   --compare <tag> adds that earlier run as a second row ("before" above, this run below)
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { ROOT } from '../lib/paths.ts'
import { launchMetal, startDevServer } from '../render/still.ts'

type Shot = { name: string; scene?: string; pose?: string; view?: string; hl?: string; atlas?: 'off' | 'flat'; focus?: string; size?: number; lift?: number; ortho?: boolean; viewport?: [number, number] }

const PULL = 'lats:p,upper_back:p,rear_delt:s,biceps:s,forearms:s'
const SQUAT = 'quads:p,glute_max:p,adductors:s,lower_back:s'
const CHEST = 'chest:p,front_delt:s,triceps:s'
const SQ: [number, number] = [390, 390]
const EX: [number, number] = [390, 560]

const groups: Record<string, Shot[]> = {
  curl: [
    { name: 'curl-hero', scene: 'db-curl', viewport: EX },
    { name: 'curl-arm', scene: 'db-curl', focus: 'lowerarm01_R', size: 0.42, viewport: SQ },
    { name: 'curl-front-arm', scene: 'db-curl', view: 'front', focus: 'lowerarm01_L', size: 0.42, viewport: SQ },
    { name: 'curl-wrist', pose: 'relaxed', view: 'front', hl: 'biceps:p,forearms:s', focus: 'wrist_R', size: 0.26, viewport: SQ },
    { name: 'curl-wrist-back', pose: 'relaxed', view: 'back', hl: 'biceps:p,forearms:s', focus: 'wrist_L', size: 0.26, viewport: SQ },
  ],
  raise: [
    { name: 'raise-hero', scene: 'db-lateral-raise', viewport: EX },
    { name: 'raise-front', scene: 'db-lateral-raise', view: 'front', focus: 'neck01', size: 0.5, viewport: SQ },
    { name: 'raise-back', scene: 'db-lateral-raise', view: 'back', focus: 'neck01', size: 0.5, viewport: SQ },
    { name: 'raise-neck', scene: 'db-lateral-raise', view: 'threequarter', focus: 'neck02', size: 0.3, viewport: SQ },
    { name: 'raise-neck-side', scene: 'db-lateral-raise', view: 'side', focus: 'neck02', size: 0.3, viewport: SQ },
  ],
  press: [
    { name: 'press-hero', scene: 'db-shoulder-press', viewport: EX },
    { name: 'press-close', scene: 'db-shoulder-press', focus: 'spine01', size: 0.5, viewport: SQ },
    { name: 'press-flank', scene: 'db-shoulder-press', view: 'side', focus: 'spine02', size: 0.45, viewport: SQ },
    { name: 'press-chest', pose: 'relaxed', view: 'threequarter', hl: CHEST, focus: 'spine01', size: 0.45, viewport: SQ },
    { name: 'press-chest-front', pose: 'relaxed', view: 'front', hl: CHEST, focus: 'neck01', size: 0.36, viewport: SQ },
  ],
  squat: [
    { name: 'squat-3q', pose: 'deep-squat', view: 'threequarter', hl: SQUAT },
    { name: 'squat-side', pose: 'deep-squat', view: 'side', hl: SQUAT },
    { name: 'squat-thigh', pose: 'relaxed', view: 'side', focus: 'upperleg02_R', size: 0.5, viewport: SQ },
    { name: 'squat-thigh-3q', pose: 'relaxed', view: 'threequarter', hl: SQUAT, focus: 'upperleg02_R', size: 0.55, viewport: SQ },
  ],
  pullup: [
    { name: 'pull-back', pose: 'dead-hang', view: 'back', hl: PULL },
    { name: 'pull-3q', pose: 'dead-hang', view: 'threequarter', hl: PULL },
    { name: 'pull-flank', pose: 'dead-hang', view: 'side', hl: PULL, focus: 'spine02', size: 0.48, viewport: SQ },
    { name: 'pull-flank-sa', pose: 'dead-hang', view: 'side', hl: 'serratus:p,obliques:s', focus: 'spine02', size: 0.48, viewport: SQ },
  ],
  relief: [
    { name: 'rel-torso', pose: 'relaxed', view: 'threequarter', focus: 'spine02', size: 0.5, viewport: SQ },
    { name: 'rel-back', pose: 'relaxed', view: 'back', focus: 'spine02', size: 0.55, viewport: SQ },
    { name: 'rel-neck', pose: 'relaxed', view: 'threequarter', focus: 'neck02', size: 0.26, viewport: SQ },
    { name: 'rel-flank', pose: 'arms-overhead', view: 'side', focus: 'spine02', size: 0.42, viewport: SQ },
    { name: 'rel-arm', pose: 'relaxed', view: 'side', focus: 'lowerarm01_R', size: 0.5, viewport: SQ },
    { name: 'rel-legs', pose: 'relaxed', view: 'threequarter', focus: 'lowerleg01_R', size: 0.6, lift: 0.1, viewport: SQ },
    { name: 'rel-calf', pose: 'relaxed', view: 'back', focus: 'lowerleg01_R', size: 0.45, viewport: SQ },
  ],
  flat: [
    ...['front', 'back', 'side'].map((view) => ({ name: `flat-${view}`, pose: 'anatomical', view, atlas: 'flat' as const, ortho: true })),
    { name: 'flat-side-overhead', pose: 'arms-overhead', view: 'side', atlas: 'flat', ortho: true },
    { name: 'flat-neck', pose: 'relaxed', view: 'threequarter', atlas: 'flat', focus: 'neck02', size: 0.3, viewport: SQ },
  ],
}

async function renderShot(page: Page, base: string, s: Shot, file: string) {
  const q = new URLSearchParams()
  for (const k of ['scene', 'pose', 'view', 'hl', 'atlas', 'focus'] as const) if (s[k]) q.set(k, s[k]!)
  if (s.size) q.set('size', String(s.size))
  if (s.lift) q.set('lift', String(s.lift))
  if (s.ortho) q.set('ortho', '1')
  const [w, h] = s.viewport ?? [390, 844]
  if (page.viewportSize()?.width !== w || page.viewportSize()?.height !== h) await page.setViewportSize({ width: w, height: h })
  await page.goto(`${base}/dev/figure?${q}`)
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, undefined, { timeout: 90_000 })
  await page.screenshot({ path: file, type: 'png' })
}

async function sheet(page: Page, rows: { label: string; files: string[] }[], out: string) {
  const W = 300
  const html = rows.map((r) => `<div class="row"><div class="lab">${r.label}</div>${r.files.map((f) =>
    `<figure><img src="data:image/png;base64,${readFileSync(f).toString('base64')}"><figcaption>${path.basename(f, '.png')}</figcaption></figure>`).join('')}</div>`).join('')
  await page.setViewportSize({ width: 40 + W * Math.max(...rows.map((r) => r.files.length)), height: 100 })
  await page.setContent(`<style>body{margin:0;font:12px system-ui;background:#fff}.row{display:flex;align-items:flex-start}.lab{width:40px;writing-mode:vertical-rl;text-align:center;align-self:center}figure{margin:0;width:${W}px;text-align:center}img{width:${W}px;display:block}</style>${html}`)
  await page.waitForFunction(() => [...document.images].every((i) => i.complete))
  await page.screenshot({ path: out, type: 'png', fullPage: true })
}

async function main() {
  const argv = process.argv.slice(2)
  const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined)
  const outDir = path.resolve(ROOT, arg('--out') ?? 'qa/out/polish')
  const tag = arg('--tag')
  const compare = arg('--compare')
  const only = argv.flatMap((a, i) => (a === '--only' ? [argv[i + 1]] : []))
  const suffix = tag ? `-${tag}` : ''
  const shotDir = path.join(outDir, `atlas-shots${suffix}`)
  mkdirSync(shotDir, { recursive: true })
  const atlasMode = arg('--atlas') as 'off' | 'flat' | undefined
  const pick = arg('--shot')
  const chosen = Object.entries(groups).filter(([g]) => !only.length || only.includes(g))
    .map(([g, shots]) => [g, atlasMode ? shots.map((s) => ({ ...s, atlas: atlasMode, hl: undefined })) : shots] as const)
    .map(([g, shots]) => [g, pick ? shots.filter((s) => s.name === pick) : shots] as const)
    .filter(([, shots]) => shots.length)

  const { browser, renderer } = await launchMetal()
  console.log(`renderer: ${renderer}`)
  const { server, url } = await startDevServer()
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })
    const origin = new URL(url).origin
    const foreign = new Set<string>()
    ctx.on('request', (r) => {
      const u = new URL(r.url())
      if (u.origin !== origin && u.protocol !== 'data:' && u.protocol !== 'blob:') foreign.add(r.url())
    })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.error('pageerror:', e.message))
    for (const [, shots] of chosen) {
      for (const s of shots) {
        const t = Date.now()
        await renderShot(page, url, s, path.join(shotDir, `${s.name}.png`))
        console.log(`${s.name} ${Date.now() - t} ms`)
      }
    }
    const sp = await browser.newPage()
    for (const [g, shots] of chosen) {
      const rows = [{ label: tag ?? 'after', files: shots.map((s) => path.join(shotDir, `${s.name}.png`)) }]
      if (compare) {
        const before = shots.map((s) => path.join(outDir, `atlas-shots-${compare}`, `${s.name}.png`)).filter((f) => existsSync(f))
        if (before.length) rows.unshift({ label: compare, files: before })
      }
      const out = path.join(outDir, `atlas-${g}${suffix}.png`)
      await sheet(sp, rows, out)
      console.log(path.relative(ROOT, out))
    }
    if (foreign.size) throw new Error(`third-party requests: ${[...foreign].join(', ')}`)
  } finally {
    await browser.close()
    await server.close()
  }
}

await main()
