// Renders QA screenshots of the baked body map with Playwright Chromium.
// Usage: node pipeline/anatomy/qa-map.ts  -> qa/out/s2/{front,back,overview,groups}.png
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { PUBLIC, ROOT } from '../lib/paths.ts'

const OUT = path.join(ROOT, 'qa/out/s2')
const read = (f: string) => fs.readFileSync(path.join(PUBLIC, 'anatomy', f), 'utf8')

const css = `
  body { margin: 0; background: #fff; font-family: -apple-system, Helvetica, Arial, sans-serif; }
  .row { display: flex; gap: 24px; padding: 16px; }
  svg { display: block; }
  #silhouette path { fill: #d9d6d0; }
  #regions path, #groups path { stroke: #fff; stroke-width: 1.5; stroke-linejoin: round; }
  [data-untracked] { fill: #b9b4ab !important; }
  text { font-size: 15px; font-weight: 600; fill: #111; paint-order: stroke; stroke: #fff; stroke-width: 3px; text-anchor: middle; dominant-baseline: middle; }
  h2 { font-size: 18px; margin: 0 0 4px 16px; }
`

// Distinct colors by id; runs in the page.
const colorize = `
  (() => {
    const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 };
    for (const p of document.querySelectorAll('#regions path, #groups path')) {
      const key = p.dataset.head || p.dataset.group || p.dataset.untracked;
      const h = hash(key);
      if (!p.dataset.untracked) p.style.fill = 'hsl(' + (h % 360) + ' ' + (55 + (h >> 9) % 30) + '% ' + (48 + (h >> 17) % 18) + '%)';
    }
  })()
`

// Puts a label near the most interior sampled point of each region (skips the l/r twin).
const label = `
  ((which) => {
    for (const svg of document.querySelectorAll('svg')) {
      const seen = new Set();
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      for (const p of svg.querySelectorAll(which)) {
        const key = p.dataset.head || p.dataset.group || p.dataset.untracked;
        const b = p.getBBox();
        let best = null, bestD = -1;
        const step = Math.max(3, Math.min(b.width, b.height) / 12);
        const pts = [];
        for (let y = b.y; y <= b.y + b.height; y += step) for (let x = b.x; x <= b.x + b.width; x += step) pts.push([x, y, p.isPointInFill(new DOMPoint(x, y))]);
        const outside = pts.filter((q) => !q[2]);
        for (const q of pts) {
          if (!q[2]) continue;
          let d = Infinity;
          for (const o of outside) d = Math.min(d, Math.hypot(o[0] - q[0], o[1] - q[1]));
          d = Math.min(d, q[0] - b.x + step, b.x + b.width - q[0] + step, q[1] - b.y + step, b.y + b.height - q[1] + step);
          if (d > bestD) { bestD = d; best = q; }
        }
        if (!best) continue;
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', best[0]); t.setAttribute('y', best[1]);
        t.textContent = (seen.has(key) ? '' : '') + key + (p.dataset.side ? '.' + p.dataset.side : '');
        seen.add(key);
        g.appendChild(t);
      }
      svg.appendChild(g);
    }
  })
`

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  const shot = async (html: string, file: string, width: number, labels?: string) => {
    await page.setViewportSize({ width, height: 800 })
    await page.setContent(`<!doctype html><style>${css}</style>${html}`)
    await page.evaluate(colorize)
    if (labels) await page.evaluate(`${label}(${JSON.stringify(labels)})`)
    await page.screenshot({ path: path.join(OUT, file), fullPage: true })
  }
  const front = read('front.svg'), back = read('back.svg')
  const size = (svg: string, h: number) => svg.replace('<svg ', `<svg height="${h}" `)
  await shot(size(front, 2048), 'front.png', 880)
  await shot(size(back, 2048), 'back.png', 880)
  await shot(
    `<div class="row"><div><h2>Front (viewer's left = subject's right)</h2>${size(front, 2048)}</div><div><h2>Back</h2>${size(back, 2048)}</div></div>`,
    'overview.png', 1720, '#regions path',
  )
  await shot(
    `<div class="row">${size(read('front.groups.svg'), 900)}${size(read('back.groups.svg'), 900)}</div>`,
    'groups.png', 820, '#groups path',
  )
  await browser.close()
  console.log(`wrote ${path.relative(ROOT, OUT)}/{front,back,overview,groups}.png`)
}

await main()
