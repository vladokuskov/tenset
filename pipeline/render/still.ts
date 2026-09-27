// Renders figure stills from the dev route in Chromium on Metal.
// node pipeline/render/still.ts --preset s1v2
// node pipeline/render/still.ts --out qa/out/tmp [--head b] --shot look=relaxed:front --shot crop=deep-squat:side:lowerleg01_R:0.6 [--sheet sheet]
// node pipeline/render/still.ts --out qa/out/tmp --scene curl=db-curl --scene curl-arm=db-curl:hero:lowerarm01_R:0.5
// --atlas flat|off and --hl 'biceps:p,forearms:s' apply to every --shot / --scene of the run
// inline poses use | as separator: --shot 'x={"base":"relaxed","joints":{...}}|front'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium, type Browser, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { ROOT } from '../lib/paths.ts'

export type Shot = {
  name: string
  /** exercise still from src/features/figure/scenes.tsx; pose and view then default to the scene's */
  scene?: string
  pose?: string
  view?: string
  head?: 'a' | 'b'
  correctives?: false
  focus?: string
  size?: number
  lift?: number
  /** highlight spec, see src/features/figure/highlight.ts parseHighlight */
  hl?: string
  /** concentric pulse phase 0..1 */
  pulse?: number
  atlas?: 'off' | 'flat'
  ortho?: boolean
  /** CSS pixels, default 390 x 844 (always at 3x) */
  viewport?: [number, number]
}

const VIEWPORT = { width: 390, height: 844 }
const SCALE = 3

const STRESS = ['arms-overhead', 'abduction-90', 'pronation', 'supination', 'deep-squat', 'dead-hang']
const LOOK = ['front', 'threequarter', 'back']
const HEADS = ['a', 'b'] as const
const CLOSEUPS: [string, string, string, string, number][] = [
  ['overhead', 'arms-overhead', 'front', 'spine01', 0.62],
  ['hang', 'dead-hang', 'threequarter', 'spine01', 0.62],
  ['pronation', 'pronation', 'front', 'spine01', 0.62],
  ['squat', 'deep-squat', 'front', 'root', 0.72],
  ['squat-knee', 'deep-squat', 'side', 'lowerleg01_R', 0.55],
]

const ATLAS_VIEWS = ['front', 'back', 'side', 'left']
const HIGHLIGHTS: [string, string, string][] = [
  ['press', 'chest:p,front_delt:s,triceps:s', 'threequarter'],
  ['pull', 'lats:p,upper_back:p,rear_delt:s,biceps:s,forearms:s', 'back'],
  ['squat', 'quads:p,glute_max:p,adductors:s,lower_back:s', 'threequarter'],
  ['raise', 'side_delt:p,upper_traps:s,front_delt:s', 'front'],
]

const EXERCISES: [string, string][] = [['curl', 'db-curl'], ['lateral-raise', 'db-lateral-raise'], ['shoulder-press', 'db-shoulder-press']]
const EX_VIEWPORT: [number, number] = [390, 560]

export const presets: Record<string, { out: string; shots: Shot[]; sheets?: Record<string, string[]> }> = {
  // exercise-illustration look: hero stills of both heads and three dumbbell exercises with highlights
  look: {
    out: 'qa/out/s1v2',
    shots: [
      ...HEADS.map((head) => ({ name: `hero-${head}`, pose: 'relaxed', view: 'hero', head })),
      ...HEADS.map((head) => ({ name: `hero-head-${head}`, pose: 'relaxed', view: 'hero', head, focus: 'head', size: 0.3, lift: 0.0, viewport: [390, 390] as [number, number] })),
      ...EXERCISES.map(([name, scene]) => ({ name: `ex-${name}`, scene, head: 'a' as const, viewport: EX_VIEWPORT })),
      // concentric pulse (for later motion), three phases on the curl's upper arm
      ...[0.15, 0.45, 0.75].map((pulse) => ({ name: `pulse-${pulse}`, scene: 'db-curl', head: 'a' as const, focus: 'upperarm02_L', size: 0.34, pulse, viewport: [390, 390] as [number, number] })),
    ],
    sheets: {
      'sheet-hero-ab': HEADS.map((h) => `hero-${h}`),
      'sheet-exercises': EXERCISES.map(([n]) => `ex-${n}`),
      'sheet-pulse': [0.15, 0.45, 0.75].map((p) => `pulse-${p}`),
      'sheet-look': [...HEADS.map((h) => `hero-${h}`), ...HEADS.map((h) => `hero-head-${h}`), ...EXERCISES.map(([n]) => `ex-${n}`)],
    },
  },
  atlas: {
    out: 'qa/out/s1v2',
    shots: [
      // flat region colours, orthographic, anatomical position: compare with the 2D map (qa/out/s2/front.png, back.png)
      ...ATLAS_VIEWS.map((view) => ({ name: `atlas-${view}`, pose: 'anatomical', view, head: 'a' as const, atlas: 'flat' as const, ortho: true })),
      // arms up, so the side views show the chest wall (serratus, lats, obliques)
      ...['side', 'left'].map((view) => ({ name: `atlas-${view}-overhead`, pose: 'arms-overhead', view, head: 'a' as const, atlas: 'flat' as const, ortho: true })),
      ...LOOK.map((view) => ({ name: `relief-${view}`, pose: 'relaxed', view, head: 'a' as const })),
      ...LOOK.map((view) => ({ name: `relief-off-${view}`, pose: 'relaxed', view, head: 'a' as const, atlas: 'off' as const })),
      { name: 'relief-torso-front', pose: 'relaxed', view: 'threequarter', head: 'a', focus: 'spine03', size: 0.4 },
      { name: 'relief-torso-back', pose: 'relaxed', view: 'back', head: 'a', focus: 'spine03', size: 0.4 },
      { name: 'relief-legs', pose: 'relaxed', view: 'threequarter', head: 'a', focus: 'lowerleg01_R', size: 0.5, lift: 0.1 },
      ...HIGHLIGHTS.map(([name, hl, view]) => ({ name: `hl-${name}`, pose: 'relaxed', view, head: 'a' as const, hl })),
      { name: 'hl-press-closeup', pose: 'relaxed', view: 'threequarter', head: 'a', focus: 'spine03', size: 0.4, hl: HIGHLIGHTS[0][1] },
      { name: 'hl-squat-pose', pose: 'deep-squat', view: 'threequarter', head: 'a', hl: HIGHLIGHTS[2][1] },
    ],
    sheets: {
      'sheet-atlas-front': ['qa/out/s2/front.png', 'atlas-front'],
      'sheet-atlas-back': ['qa/out/s2/back.png', 'atlas-back'],
      'sheet-atlas-sides': ['atlas-side', 'atlas-left', 'atlas-side-overhead', 'atlas-left-overhead'],
      'sheet-relief': [...LOOK.map((v) => `relief-off-${v}`), ...LOOK.map((v) => `relief-${v}`)],
      'sheet-relief-closeups': ['relief-torso-front', 'relief-torso-back', 'relief-legs'],
      'sheet-highlight': [...HIGHLIGHTS.map(([n]) => `hl-${n}`), 'hl-press-closeup', 'hl-squat-pose'],
    },
  },
  s1: {
    out: 'qa/out/s1',
    shots: [
      ...['front', 'threequarter', 'back'].map((view) => ({ name: `look-01-${view}`, pose: 'relaxed', view })),
      ...STRESS.flatMap((pose) => ['front', 'side'].map((view) => ({ name: `stress-${pose}-${view}`, pose, view }))),
    ],
    sheets: {
      'sheet-look': ['look-01-front', 'look-01-threequarter', 'look-01-back'],
      'sheet-stress-front': STRESS.map((p) => `stress-${p}-front`),
      'sheet-stress-side': STRESS.map((p) => `stress-${p}-side`),
    },
  },
  s1v2: {
    out: 'qa/out/s1v2',
    shots: [
      ...HEADS.flatMap((head) => LOOK.map((view) => ({ name: `look-${head}-${view}`, pose: 'relaxed', view, head }))),
      ...HEADS.flatMap((head) => ['front', 'threequarter', 'side'].map((view) => ({ name: `head-${head}-${view}`, pose: 'relaxed', view, head, focus: 'head', size: 0.3, lift: 0.06, viewport: [390, 390] as [number, number] }))),
      ...STRESS.flatMap((pose) => ['front', 'side'].map((view) => ({ name: `stress-${pose}-${view}`, pose, view, head: 'a' as const }))),
      // corrective morphs off vs on, cropped on the joints they fix
      ...CLOSEUPS.flatMap(([name, pose, view, focus, size]) => [false, true].map((on) => ({
        name: `joint-${name}-${on ? 'on' : 'off'}`, pose, view, head: 'a' as const, focus, size, ...(on ? {} : { correctives: false as const }),
      }))),
    ],
    sheets: {
      'sheet-look-a': LOOK.map((v) => `look-a-${v}`),
      'sheet-look-b': LOOK.map((v) => `look-b-${v}`),
      'sheet-heads': HEADS.flatMap((h) => ['front', 'threequarter', 'side'].map((v) => `head-${h}-${v}`)),
      'sheet-stress-front': STRESS.map((p) => `stress-${p}-front`),
      'sheet-stress-side': STRESS.map((p) => `stress-${p}-side`),
      'sheet-joints': CLOSEUPS.flatMap(([name]) => [`joint-${name}-off`, `joint-${name}-on`]),
    },
  },
}

export async function startDevServer(): Promise<{ server: ViteDevServer; url: string }> {
  const server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 5190, strictPort: false },
    optimizeDeps: { entries: ['index.html'] },
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (!url) throw new Error('dev server has no local url')
  return { server, url: url.replace(/\/$/, '') }
}

export async function launchMetal(): Promise<{ browser: Browser; renderer: string }> {
  const browser = await chromium.launch({ args: ['--use-angle=metal'] })
  const page = await browser.newPage()
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'no webgl'
  })
  await page.close()
  if (!renderer.includes('Metal')) {
    await browser.close()
    throw new Error(`WebGL renderer is not Metal: ${renderer}`)
  }
  return { browser, renderer }
}

async function renderShot(page: Page, base: string, shot: Shot, file: string) {
  const q = new URLSearchParams()
  if (shot.scene) q.set('scene', shot.scene)
  if (shot.pose) q.set('pose', shot.pose)
  if (shot.view) q.set('view', shot.view)
  if (shot.head) q.set('head', shot.head)
  if (shot.correctives === false) q.set('cor', '0')
  if (shot.focus) q.set('focus', shot.focus)
  if (shot.size) q.set('size', String(shot.size))
  if (shot.lift) q.set('lift', String(shot.lift))
  if (shot.hl) q.set('hl', shot.hl)
  if (shot.pulse !== undefined) q.set('pulse', String(shot.pulse))
  if (shot.atlas) q.set('atlas', shot.atlas)
  if (shot.ortho) q.set('ortho', '1')
  const [w, h] = shot.viewport ?? [VIEWPORT.width, VIEWPORT.height]
  if (page.viewportSize()?.width !== w || page.viewportSize()?.height !== h) await page.setViewportSize({ width: w, height: h })
  await page.goto(`${base}/dev/figure?${q}`)
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, undefined, { timeout: 90_000 })
  await page.screenshot({ path: file, type: 'png' })
}

async function contactSheet(page: Page, files: string[], out: string) {
  const imgs = files
    .map((f) => `<figure><img src="data:image/png;base64,${readFileSync(f).toString('base64')}"><figcaption>${path.basename(f, '.png')}</figcaption></figure>`)
    .join('')
  await page.setViewportSize({ width: 260 * files.length, height: 100 })
  await page.setContent(
    `<style>body{margin:0;display:flex;align-items:flex-start;font:12px system-ui;background:#fff}figure{margin:0;width:260px;text-align:center}img{width:260px;display:block}</style>${imgs}`,
  )
  await page.waitForFunction(() => [...document.images].every((i) => i.complete))
  await page.screenshot({ path: out, type: 'png', fullPage: true })
}

function parseArgs(argv: string[]) {
  const shots: Shot[] = []
  let out = ''
  let sheet = ''
  let preset = ''
  let head: 'a' | 'b' | undefined
  let atlas: Shot['atlas']
  let hl: string | undefined
  const only: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--preset') preset = argv[++i]
    else if (a === '--out') out = argv[++i]
    else if (a === '--sheet') sheet = argv[++i]
    else if (a === '--only') only.push(argv[++i])
    else if (a === '--head') head = argv[++i] === 'b' ? 'b' : 'a'
    else if (a === '--atlas') atlas = argv[++i] === 'flat' ? 'flat' : 'off'
    else if (a === '--hl') hl = argv[++i]
    else if (a === '--shot') {
      const arg = argv[++i]
      const name = arg.slice(0, arg.indexOf('='))
      const spec = arg.slice(arg.indexOf('=') + 1)
      const [pose, view = 'front', focus, size] = spec.split(spec.includes('|') ? '|' : ':')
      shots.push({ name, pose, view, focus, size: size ? Number(size) : undefined })
    } else if (a === '--scene') {
      // --scene name=db-curl[:view[:focus:size]]
      const arg = argv[++i]
      const name = arg.slice(0, arg.indexOf('='))
      const [scene, view, focus, size] = arg.slice(arg.indexOf('=') + 1).split(':')
      shots.push({ name, scene, view: view || undefined, focus, size: size ? Number(size) : undefined })
    }
  }
  for (const s of shots) {
    if (head) s.head = head
    if (atlas) s.atlas = atlas
    if (hl) s.hl = hl
  }
  return { shots, out, sheet, preset, only }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const p = args.preset ? presets[args.preset] : undefined
  if (args.preset && !p) throw new Error(`unknown preset ${args.preset}`)
  let shots = p ? p.shots : args.shots
  if (args.only.length) shots = shots.filter((s) => args.only.some((o) => s.name.includes(o)))
  const outDir = path.resolve(ROOT, args.out || p?.out || 'qa/out/tmp')
  if (!shots.length) throw new Error('no shots')
  mkdirSync(outDir, { recursive: true })

  const { browser, renderer } = await launchMetal()
  console.log(`renderer: ${renderer}`)
  const { server, url } = await startDevServer()
  const foreign = new Set<string>()
  try {
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE })
    // context-wide, so workers and service workers are covered too
    const origin = new URL(url).origin
    ctx.on('request', (r) => {
      const u = new URL(r.url())
      if (u.origin !== origin && u.protocol !== 'data:' && u.protocol !== 'blob:') foreign.add(r.url())
    })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.error('pageerror:', e.message))
    for (const shot of shots) {
      const file = path.join(outDir, `${shot.name}.png`)
      const t = Date.now()
      await renderShot(page, url, shot, file)
      console.log(`${path.relative(ROOT, file)} (${Date.now() - t} ms)`)
    }
    const sheetPage = await browser.newPage()
    const sheets = { ...(p?.sheets ?? {}), ...(args.sheet ? { [args.sheet]: shots.map((s) => s.name) } : {}) }
    for (const [name, names] of Object.entries(sheets)) {
      // names are shots of this run; paths (with a slash) are existing images from elsewhere in the repo
      const files = names
        .map((n) => (n.includes('/') ? path.join(ROOT, n) : shots.some((s) => s.name === n) ? path.join(outDir, `${n}.png`) : ''))
        .filter((f) => f && existsSync(f))
      if (!names.some((n) => shots.some((s) => s.name === n))) continue
      const file = path.join(outDir, `${name}.png`)
      await contactSheet(sheetPage, files, file)
      console.log(`${path.relative(ROOT, file)}`)
    }
  } finally {
    await browser.close()
    await server.close()
  }
  if (foreign.size) throw new Error(`third-party requests: ${[...foreign].join(', ')}`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
