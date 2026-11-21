// README screenshots: four phone screens of the library in a plain phone frame, one image per color scheme.
// Run `pnpm build` first; this serves dist/ so only owner-approved animations show.
import { existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { preview } from 'vite'
import { ROOT } from '../lib/paths.ts'
import { launchMetal } from './still.ts'

const OUT = path.join(ROOT, 'docs/screenshots')
const SCALE = 2
const SCREEN = { width: 390, height: 844 }
const STATUS_H = 47
// Loops play on cards, so each shot waits long enough for the on-screen ones to start.
const SHOTS = [
  { route: '/', wait: 2500, locale: 'en-US' },
  { route: '/?q=squat&equip=all', wait: 2500, locale: 'en-US' },
  { route: '/?sheet=equipment', wait: 1200, locale: 'en-US' },
  { route: '/?move=pull&equip=all', wait: 2500, locale: 'uk-UA' },
] as const

const SCHEMES = {
  light: { canvas: 'oklch(0.935 0.006 75)', ink: 'oklch(0.22 0.008 60)' },
  dark: { canvas: 'oklch(0.205 0.006 60)', ink: 'oklch(0.945 0.006 75)' },
} as const

type Scheme = keyof typeof SCHEMES

if (!existsSync(path.join(ROOT, 'dist/index.html'))) throw new Error('dist/ is missing, run pnpm build first')
mkdirSync(OUT, { recursive: true })

const server = await preview({ root: ROOT, logLevel: 'error', preview: { host: '127.0.0.1', port: 4396, strictPort: false } })
const base = server.resolvedUrls?.local[0]?.replace(/\/$/, '')
if (!base) throw new Error('preview server has no local url')
const { browser } = await launchMetal()

async function capture(scheme: Scheme): Promise<string[]> {
  const shots: string[] = []
  for (const { route, wait, locale } of SHOTS) {
    // a fresh context per shot, so the language comes from the browser locale and no saved choice carries over
    const context = await browser.newContext({
      viewport: { width: SCREEN.width, height: SCREEN.height - STATUS_H },
      deviceScaleFactor: SCALE,
      isMobile: true,
      hasTouch: true,
      colorScheme: scheme,
      locale,
      serviceWorkers: 'block',
    })
    const page = await context.newPage()
    await page.goto(`${base}${route}`)
    await page.waitForTimeout(wait)
    shots.push((await page.screenshot({ type: 'png' })).toString('base64'))
    await context.close()
  }
  return shots
}

const statusIcons = (ink: string) => `
  <svg width="70" height="13" viewBox="0 0 70 13" fill="${ink}" aria-hidden="true">
    <rect x="0" y="9" width="3" height="4" rx="1"/><rect x="5" y="6" width="3" height="7" rx="1"/>
    <rect x="10" y="3" width="3" height="10" rx="1"/><rect x="15" y="0" width="3" height="13" rx="1"/>
    <rect x="40" y="0.5" width="24" height="12" rx="3.5" fill="none" stroke="${ink}" stroke-opacity="0.45"/>
    <rect x="42.5" y="3" width="17" height="7" rx="2"/><rect x="65.5" y="4.5" width="2" height="4" rx="1" fill-opacity="0.45"/>
  </svg>`

function sheet(scheme: Scheme, shots: string[]): string {
  const { canvas, ink } = SCHEMES[scheme]
  const phones = shots
    .map(
      (b64) => `
      <div class="phone">
        <div class="screen">
          <div class="status"><span>10:24</span>${statusIcons(ink)}</div>
          <div class="pill"></div>
          <img src="data:image/png;base64,${b64}" width="${SCREEN.width}" height="${SCREEN.height - STATUS_H}" alt="">
        </div>
      </div>`,
    )
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; background: transparent; }
    .row { display: flex; gap: 44px; padding: 40px; width: max-content; }
    .phone { padding: 13px; border-radius: 64px; background: #1b1b1d; box-shadow: inset 0 0 0 2px #3a3a3e, 0 24px 48px -18px rgb(0 0 0 / 0.35); }
    .screen { position: relative; width: ${SCREEN.width}px; height: ${SCREEN.height}px; border-radius: 51px; overflow: hidden; background: ${canvas}; }
    .status { height: ${STATUS_H}px; display: flex; align-items: center; justify-content: space-between; padding: 4px 30px 0 44px; box-sizing: border-box;
      font: 600 16px/1 system-ui, -apple-system, sans-serif; color: ${ink}; }
    .pill { position: absolute; top: 11px; left: 50%; width: 122px; height: 35px; margin-left: -61px; border-radius: 20px; background: #000; }
    img { display: block; }
  </style></head><body><div class="row">${phones}</div></body></html>`
}

for (const scheme of Object.keys(SCHEMES) as Scheme[]) {
  const shots = await capture(scheme)
  const page = await browser.newPage({ deviceScaleFactor: 1.5 })
  await page.setContent(sheet(scheme, shots))
  const file = path.join(OUT, `phones-${scheme}.png`)
  await page.locator('.row').screenshot({ path: file, omitBackground: true })
  await page.close()
  console.log(`${path.relative(ROOT, file)} ${(statSync(file).size / 1024).toFixed(0)} KiB`)
}

await browser.close()
await new Promise<void>((resolve) => server.httpServer.close(() => resolve()))
