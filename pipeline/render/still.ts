// Renders figure stills from the dev route in Chromium on Metal.
// node pipeline/render/still.ts --preset s1v2
// node pipeline/render/still.ts --out qa/out/tmp [--head b] --shot look=relaxed:front --shot crop=deep-squat:side:lowerleg01_R:0.6 [--sheet sheet]
// node pipeline/render/still.ts --out qa/out/tmp --scene curl=db-curl --scene curl-arm=db-curl:hero:lowerarm01_R:0.5
// --atlas flat|off and --hl 'biceps:p,forearms:s' apply to every --shot / --scene of the run
// --viewport 390x390, --spin yaw,pitch (degrees, turns the figure about the focus bone), --grip R:hook:0.033 (hands.ts
// applyGrip on the posed figure), --pulse 0.45, --probe (hand vertices inside the held handle) and --perf (GPU timings) do too
// inline poses use | as separator: --shot 'x={"base":"relaxed","joints":{...}}|front'
// live motion contact sheets (/dev/motion, one row of phases per exercise): <out>/figure-<id>.png
// node pipeline/render/still.ts --out qa/out/animated --motion all [--phases 8] [--view hero|front|side|back] [--live]
//   [--mfocus wrist_R:0.3] (close-up on a bone) [--yaw 20] (degrees added to the camera azimuth)
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
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
  /** degrees: turn the posed figure about the focus bone (hand close-ups) */
  spin?: [number, number]
  /** 'R:1,0.5,0': turn the figure so this wrist-frame direction (palmar, distal, thumb side) faces a front camera,
   * fingers up (hand close-ups; use with view front) */
  handview?: string
  /** 'hook', 'R:hook' or 'L:rope:0.03', applied with hands.ts applyGrip after posing */
  grip?: string
  /** print how far hand vertices sink into the held handle */
  probe?: boolean
  /** print GPU timings: full frame, frame with flat skin, highlight change */
  perf?: boolean
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
  if (shot.grip || shot.spin || shot.handview) await page.evaluate(adjustFigure, { grip: shot.grip, spin: shot.spin, focus: shot.focus, handview: shot.handview })
  await page.screenshot({ path: file, type: 'png' })
  if (shot.probe) console.log(`  probe ${shot.name}: ${JSON.stringify(await page.evaluate(probeHandles))}`)
  if (shot.perf) console.log(`  perf ${shot.name}: ${JSON.stringify(await page.evaluate(perfProbe))}`)
}

// runs in the page. Synchronous loops, each call followed by a 1-pixel readPixels that waits for the GPU.
async function perfProbe() {
  type R = import('three').WebGLRenderer
  const f = (window as unknown as FigureWindow).__figure
  const mesh = f.rig.mesh
  const { r, s, c } = await new Promise<{ r: R; s: import('three').Scene; c: import('three').Camera }>((done) => {
    const prev = mesh.onBeforeRender
    mesh.onBeforeRender = function (...args) {
      mesh.onBeforeRender = prev
      prev.apply(this, args)
      done({ r: args[0], s: args[1], c: args[2] })
    }
  })
  const threeUrl = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/.vite/deps/three.js'))
  const THREE = await import(/* @vite-ignore */ String(threeUrl))
  const gl = r.getContext() as WebGL2RenderingContext
  const px = new Uint8Array(4)
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
  // wall time per call, each followed by a GPU sync; the GPU is kept busy for a second first so its clock is up
  const handle = f as unknown as { setHighlight(h: unknown): void }
  const hls = [{ primary: ['chest'], secondary: ['front_delt', 'triceps'] }, { primary: ['quads', 'glute_max'], secondary: ['adductors'] }]
  let k = 0
  const frameFn = () => r.render(s, c)
  const hlFrameFn = () => { handle.setHighlight(hls[k++ % 2]); r.render(s, c) }
  const warm = performance.now()
  while (performance.now() - warm < 1000) { r.render(s, c); sync() }
  const stats = (fn: () => void, n = 120) => {
    const t: number[] = []
    for (let i = 0; i < n; i++) {
      const t0 = performance.now()
      fn()
      sync()
      t.push(performance.now() - t0)
    }
    t.sort((a, b) => a - b)
    const q = (p: number) => Math.round(t[Math.floor(p * (n - 1))] * 100) / 100
    return { p10: q(0.1), med: q(0.5) }
  }
  const skin = mesh.material
  const flatMat = new THREE.MeshBasicMaterial({ color: 0xc4c4c2 })
  const out: Record<string, unknown> = { px: [gl.drawingBufferWidth, gl.drawingBufferHeight] }
  out.frame = stats(frameFn)
  out.frameWithHighlightChange = stats(hlFrameFn)
  mesh.material = flatMat
  out.frameFlatSkin = stats(frameFn)
  mesh.material = skin
  out.frameAgain = stats(frameFn)
  flatMat.dispose()
  return out
}

type FigureWindow = {
  __figure: {
    rig: { mesh: import('three').SkinnedMesh; bone(n: string): import('three').Bone }
    scene: import('three').Object3D
  }
}

// runs in the page: dev modules are served by Vite at their source paths, so these are the app's own instances
async function adjustFigure({ grip, spin, focus, handview }: { grip?: string; spin?: [number, number]; focus?: string; handview?: string }) {
  const f = (window as unknown as FigureWindow).__figure
  if (grip) {
    const { applyGrip } = await import(/* @vite-ignore */ String('/src/features/figure/hands.ts'))
    const parts = grip.split(':')
    const sides = parts[0] === 'L' || parts[0] === 'R' ? [parts.shift()!] : ['L', 'R']
    for (const side of sides) applyGrip(f.rig, side, parts[0], parts[1] ? Number(parts[1]) : undefined)
  }
  if (spin || handview) {
    const s = f.scene
    const V = s.position.constructor as typeof import('three').Vector3
    const Q = s.quaternion.constructor as typeof import('three').Quaternion
    const E = s.rotation.constructor as typeof import('three').Euler
    const M = s.matrix.constructor as typeof import('three').Matrix4
    s.updateMatrixWorld(true)
    const pivot = f.rig.bone(focus ?? 'root').getWorldPosition(new V())
    let q = new Q()
    if (spin) q.setFromEuler(new E((spin[1] * Math.PI) / 180, (spin[0] * Math.PI) / 180, 0, 'YXZ'))
    if (handview) {
      const [side, vec] = handview.split(':')
      const [a, b, c] = vec.split(',').map(Number)
      const w = f.rig.bone(`wrist_${side}`).matrixWorld
      const X = new V(side === 'L' ? 1 : -1, 0, 0).transformDirection(w)
      const Y = new V(0, 1, 0).transformDirection(w)
      const Z = new V(0, 0, 1).transformDirection(w)
      const dir = X.multiplyScalar(a).addScaledVector(Y, b).addScaledVector(Z, c).normalize()
      const basis = (d: import('three').Vector3, up: import('three').Vector3) => {
        const u = up.clone().addScaledVector(d, -up.dot(d)).normalize()
        return new M().makeBasis(new V().crossVectors(u, d), u, d)
      }
      const from = basis(dir, Y.clone())
      const to = basis(new V(0, 0.08, 1).normalize(), new V(0, 1, 0))
      q = new Q().setFromRotationMatrix(to.multiply(from.transpose()))
    }
    s.quaternion.premultiply(q)
    s.position.sub(pivot).applyQuaternion(q).add(pivot)
    s.updateMatrixWorld(true)
  }
  await new Promise<void>((done) => {
    const step = (k: number) => (k ? requestAnimationFrame(() => step(k - 1)) : done())
    step(4)
  })
}

// per hand: the deepest hand vertex inside the dumbbell handle (mm, negative = inside) by dominant bone
async function probeHandles() {
  const f = (window as unknown as FigureWindow).__figure
  const { skinnedPositions } = await import(/* @vite-ignore */ String('/src/features/figure/props/fit.ts'))
  const { gripFrame } = await import(/* @vite-ignore */ String('/src/features/figure/props/grip.ts'))
  const { dumbbellDefaults } = await import(/* @vite-ignore */ String('/src/features/figure/props/sockets.ts'))
  const mesh = f.rig.mesh
  f.scene.updateMatrixWorld(true)
  const P = skinnedPositions(mesh) as Float32Array
  const si = mesh.geometry.getAttribute('skinIndex')
  const sw = mesh.geometry.getAttribute('skinWeight')
  const names = mesh.skeleton.bones.map((b) => b.name)
  const R = dumbbellDefaults.handleRadius as number
  const out: Record<string, { worst: number; inside: number; bone: string }> = {}
  for (const side of ['L', 'R']) {
    const g = gripFrame(f.rig, side)
    let worst = Infinity, inside = 0, bone = ''
    for (let i = 0; i < si.count; i++) {
      let b = 0, w = 0
      for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > w) { w = sw.getComponent(i, k); b = si.getComponent(i, k) }
      const n = names[b]
      if (!n.endsWith(`_${side}`) || !/^(finger|metacarpal|wrist)/.test(n)) continue
      const dx = P[i * 3] - g.position.x, dy = P[i * 3 + 1] - g.position.y, dz = P[i * 3 + 2] - g.position.z
      const t = dx * g.axis.x + dy * g.axis.y + dz * g.axis.z
      if (Math.abs(t) > (dumbbellDefaults.handle as number) / 2) continue
      const d = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - t * t)) - R
      if (d < -0.0005) inside++
      if (d < worst) { worst = d; bone = n }
    }
    out[side] = { worst: Math.round(worst * 10000) / 10, inside, bone }
  }
  return out
}

export type MotionSheet = { id: number; phases: number; view?: string; live?: boolean; viewport: [number, number]; focus?: string; size?: number; yaw?: number }

/** ids of the exercises with a shipped baked loop */
export function motionIds(): number[] {
  const dir = path.join(ROOT, 'src/features/figure/motion/baked')
  return readdirSync(dir).map((f) => Number(/^(\d+)-/.exec(f)?.[1])).filter((n) => n > 0).sort((a, b) => a - b)
}

async function renderMotion(page: Page, base: string, m: MotionSheet, dir: string): Promise<{ files: string[]; captions: string[] }> {
  const q = new URLSearchParams({ id: String(m.id), t: '0', paused: '1' })
  if (m.view) q.set('view', m.view)
  if (m.live) q.set('live', '1')
  if (m.focus) q.set('focus', m.focus)
  if (m.size) q.set('size', String(m.size))
  if (m.yaw) q.set('yaw', String(m.yaw))
  const [w, h] = m.viewport
  if (page.viewportSize()?.width !== w || page.viewportSize()?.height !== h) await page.setViewportSize({ width: w, height: h })
  await page.goto(`${base}/dev/motion?${q}`)
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, undefined, { timeout: 90_000 })
  const files: string[] = [], captions: string[] = []
  for (let k = 0; k < m.phases; k++) {
    const t = k / m.phases
    await page.evaluate((u) => (window as unknown as { renderAt(u: number): Promise<void> }).renderAt(u), t)
    const file = path.join(dir, `${m.id}-${k}.png`)
    await page.screenshot({ path: file, type: 'png' })
    files.push(file)
    captions.push(`t=${t.toFixed(3)}`)
  }
  return { files, captions }
}

async function gridSheet(page: Page, files: string[], captions: string[], title: string, cols: number, out: string) {
  const cell = 480
  const imgs = files
    .map((f, i) => `<figure><img src="data:image/png;base64,${readFileSync(f).toString('base64')}"><figcaption>${captions[i]}</figcaption></figure>`)
    .join('')
  await page.setViewportSize({ width: cell * cols, height: 100 })
  await page.setContent(
    `<style>body{margin:0;font:12px system-ui;background:#fff}h1{font-size:14px;margin:6px 8px}main{display:grid;grid-template-columns:repeat(${cols},${cell}px)}figure{margin:0;text-align:center}img{width:${cell}px;display:block}</style><h1>${title}</h1><main>${imgs}</main>`,
  )
  await page.waitForFunction(() => [...document.images].every((i) => i.complete))
  await page.screenshot({ path: out, type: 'png', fullPage: true })
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
  let viewport: [number, number] | undefined
  let spin: [number, number] | undefined
  let grip: string | undefined
  let handview: string | undefined
  let probe = false
  let perf = false
  let pulse: number | undefined
  const compose: string[] = []
  const only: string[] = []
  let motion: number[] = []
  let phases = 8
  let view: string | undefined
  let live = false
  let mfocus: string | undefined
  let msize: number | undefined
  let yaw: number | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--preset') preset = argv[++i]
    else if (a === '--out') out = argv[++i]
    else if (a === '--sheet') sheet = argv[++i]
    else if (a === '--only') only.push(argv[++i])
    else if (a === '--head') head = argv[++i] === 'b' ? 'b' : 'a'
    else if (a === '--atlas') atlas = argv[++i] === 'flat' ? 'flat' : 'off'
    else if (a === '--hl') hl = argv[++i]
    else if (a === '--viewport') viewport = argv[++i].split('x').map(Number) as [number, number]
    else if (a === '--spin') spin = argv[++i].split(',').map(Number) as [number, number]
    else if (a === '--grip') grip = argv[++i]
    else if (a === '--handview') handview = argv[++i]
    else if (a === '--probe') probe = true
    else if (a === '--perf') perf = true
    else if (a === '--pulse') pulse = Number(argv[++i])
    else if (a === '--compose') compose.push(argv[++i])
    else if (a === '--motion') {
      const v = argv[++i]
      motion = v === 'all' ? motionIds() : v.split(',').map(Number)
    } else if (a === '--phases') phases = Number(argv[++i])
    else if (a === '--view') view = argv[++i]
    else if (a === '--live') live = true
    else if (a === '--yaw') yaw = Number(argv[++i])
    else if (a === '--mfocus') {
      const [bone, sz] = argv[++i].split(':')
      mfocus = bone
      msize = sz ? Number(sz) : undefined
    }
    else if (a === '--shot') {
      const arg = argv[++i]
      const name = arg.slice(0, arg.indexOf('='))
      const spec = arg.slice(arg.indexOf('=') + 1)
      const [pose, view = 'front', focus, size] = spec.split(spec.includes('|') ? '|' : ':')
      shots.push({ name, pose, view, focus, size: size ? Number(size) : undefined })
    } else if (a === '--scene') {
      // --scene name=db-curl[:view[:focus:size[:R/1,0,0 handview]]]
      const arg = argv[++i]
      const name = arg.slice(0, arg.indexOf('='))
      const [scene, view, focus, size, hv] = arg.slice(arg.indexOf('=') + 1).split(':')
      shots.push({ name, scene, view: view || undefined, focus, size: size ? Number(size) : undefined, ...(hv ? { handview: hv.replace('/', ':') } : {}) })
    }
  }
  for (const s of shots) {
    if (head) s.head = head
    if (atlas) s.atlas = atlas
    if (hl) s.hl = hl
    if (viewport) s.viewport = viewport
    if (spin) s.spin = spin
    if (grip) s.grip = grip
    if (handview) s.handview = handview
    if (probe) s.probe = true
    if (perf) s.perf = true
    if (pulse !== undefined) s.pulse = pulse
  }
  const motions: MotionSheet[] = motion.map((id) => ({ id, phases, view, live, viewport: viewport ?? [390, 480], focus: mfocus, size: msize, yaw }))
  return { shots, out, sheet, preset, only, compose, motions }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const p = args.preset ? presets[args.preset] : undefined
  if (args.preset && !p) throw new Error(`unknown preset ${args.preset}`)
  let shots = p ? p.shots : args.shots
  if (args.only.length) shots = shots.filter((s) => args.only.some((o) => s.name.includes(o)))
  const outDir = path.resolve(ROOT, args.out || p?.out || 'qa/out/tmp')
  if (!shots.length && !args.compose.length && !args.motions.length) throw new Error('no shots')
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
    page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()) })
    for (const shot of shots) {
      const file = path.join(outDir, `${shot.name}.png`)
      const t = Date.now()
      await renderShot(page, url, shot, file)
      console.log(`${path.relative(ROOT, file)} (${Date.now() - t} ms)`)
    }
    const sheetPage = await browser.newPage()
    for (const m of args.motions) {
      const t = Date.now()
      const tmp = path.join(outDir, '.frames')
      mkdirSync(tmp, { recursive: true })
      const { files, captions } = await renderMotion(page, url, m, tmp)
      const tag = [m.view, m.focus, m.yaw && `yaw${m.yaw}`].filter(Boolean).join('-')
      const file = path.join(outDir, `figure-${m.id}${tag ? `-${tag}` : ''}.png`)
      await gridSheet(sheetPage, files, captions, `${m.id}${tag ? ` ${tag}` : ''}`, Math.min(4, m.phases), file)
      console.log(`${path.relative(ROOT, file)} (${Date.now() - t} ms)`)
      rmSync(tmp, { recursive: true, force: true })
    }
    for (const c of args.compose) {
      // --compose out.png=a.png,b.png: a captioned sheet of existing images (repo paths)
      const [out, list] = c.split('=')
      await contactSheet(sheetPage, list.split(',').map((f) => path.join(ROOT, f)), path.join(ROOT, out))
      console.log(out)
    }
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
