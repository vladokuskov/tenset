// Renders the same figure stills for several body GLBs side by side (the dev route's body.glb request is answered
// with each file), so a body change can be judged without touching public/models/body.glb.
// node pipeline/body/compare.ts --glb before=a.glb --glb after=b.glb --out qa/out/v11 [--prefix body] [--only hero]
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { launchMetal, startDevServer } from '../render/still.ts'
import { ROOT } from '../lib/paths.ts'

type Shot = { name: string; q: Record<string, string>; viewport?: [number, number] }

const rack = (side: 'L' | 'R') => {
  const s = side === 'L' ? 1 : -1
  return {
    [`clavicle_${side}`]: { rot: [0, 0, 6] }, [`shoulder01_${side}`]: { rot: [0, 0, 6] },
    [`upperarm01_${side}`]: { aim: [0.25 * s, 0.05, 1] }, [`lowerarm01_${side}`]: { flex: 145 },
  }
}
const FRONT_RACK = JSON.stringify({ base: 'relaxed', joints: { ...rack('L'), ...rack('R') } })

export const SHOTS: Shot[] = [
  { name: 'hero', q: { pose: 'relaxed', view: 'hero' } },
  { name: 'front', q: { pose: 'anatomical', view: 'front', ortho: '1' } },
  { name: 'side', q: { pose: 'anatomical', view: 'side', ortho: '1' } },
  { name: 'overhead', q: { pose: 'arms-overhead', view: 'front' } },
  { name: 'abduction', q: { pose: 'abduction-90', view: 'front' } },
  { name: 'hang', q: { pose: 'dead-hang', view: 'threequarter' } },
  { name: 'squat', q: { pose: 'deep-squat', view: 'threequarter' } },
  { name: 'pronation', q: { pose: 'pronation', view: 'threequarter' } },
  { name: 'supination', q: { pose: 'supination', view: 'threequarter' } },
  // elbows forward, fully flexed: the hands should come back to the front of the shoulders, not past the neck
  { name: 'rack', q: { pose: FRONT_RACK, view: 'side' } },
  { name: 'curl', q: { scene: 'db-curl' }, viewport: [390, 560] },
  { name: 'press', q: { scene: 'db-shoulder-press' }, viewport: [390, 560] },
  { name: 'raise', q: { scene: 'db-lateral-raise' }, viewport: [390, 560] },
  { name: 'shoulder', q: { pose: 'abduction-90', view: 'threequarter', focus: 'upperarm01_R', size: '0.45' }, viewport: [390, 390] },
  { name: 'overhead-joint', q: { pose: 'arms-overhead', view: 'front', focus: 'spine01', size: '0.62' }, viewport: [390, 390] },
]

async function main() {
  const { values: args } = parseArgs({
    options: { glb: { type: 'string', multiple: true }, out: { type: 'string' }, prefix: { type: 'string', default: 'body' }, only: { type: 'string', multiple: true } },
  })
  const glbs = (args.glb ?? []).map((g) => {
    const [label, file] = g.split('=')
    return { label, bytes: readFileSync(path.resolve(ROOT, file)) }
  })
  if (!glbs.length) throw new Error('pass --glb label=file.glb')
  const out = path.resolve(ROOT, args.out ?? 'qa/out/tmp')
  const shots = args.only?.length ? SHOTS.filter((s) => args.only!.includes(s.name)) : SHOTS
  const frames = path.join(out, `${args.prefix}-frames`)
  mkdirSync(frames, { recursive: true })
  const { browser } = await launchMetal()
  const { server, url } = await startDevServer()
  try {
    for (const g of glbs) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
      await ctx.route('**/models/body.glb', (r) => r.fulfill({ body: g.bytes, contentType: 'model/gltf-binary' }))
      const page = await ctx.newPage()
      page.on('pageerror', (e) => console.error('pageerror:', e.message))
      for (const s of shots) {
        const [w, h] = s.viewport ?? [390, 844]
        await page.setViewportSize({ width: w, height: h })
        await page.goto(`${url}/dev/figure?${new URLSearchParams(s.q)}`)
        await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, undefined, { timeout: 90_000 })
        await page.screenshot({ path: path.join(frames, `${g.label}-${s.name}.png`) })
        console.log(`${g.label} ${s.name}`)
      }
      await ctx.close()
    }
    const sheet = await browser.newPage()
    for (const s of shots) {
      const [w] = s.viewport ?? [390, 844]
      const imgs = glbs
        .map((g) => `<figure><img src="data:image/png;base64,${readFileSync(path.join(frames, `${g.label}-${s.name}.png`)).toString('base64')}"><figcaption>${g.label} / ${s.name}</figcaption></figure>`)
        .join('')
      await sheet.setViewportSize({ width: w * glbs.length, height: 100 })
      await sheet.setContent(`<style>body{margin:0;display:flex;font:13px system-ui;background:#fff}figure{margin:0;width:${w}px;text-align:center}img{width:${w}px;display:block}</style>${imgs}`)
      await sheet.waitForFunction(() => [...document.images].every((i) => i.complete))
      const file = path.join(out, `${args.prefix}-${s.name}.png`)
      await sheet.screenshot({ path: file, fullPage: true })
      console.log(path.relative(ROOT, file))
    }
  } finally {
    await browser.close()
    await server.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
