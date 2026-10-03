// License allowlist for everything that can ship: the production dependency tree plus the dev packages that emit
// code into the build. Other dev tools (axe-core, Playwright, oxlint...) never ship and are exempt.
// node pipeline/compliance/licenses.ts           check licenses and that public/THIRD_PARTY_NOTICES.txt is current
// node pipeline/compliance/licenses.ts --write   regenerate public/THIRD_PARTY_NOTICES.txt
import fs from 'node:fs'
import path from 'node:path'
import { PUBLIC, ROOT } from '../lib/paths.ts'
import { normalizeLicense, spdxAllowed } from './spdx.ts'

const ALLOWED = new Set([
  'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Apache-2.0', 'CC0-1.0', 'OFL-1.1', 'BlueOak-1.0.0',
])

// Dev packages whose code lands in the build. true = also walk their dependencies.
const BUNDLED_DEV: Record<string, boolean> = {
  'workbox-precaching': true, // service worker (src/sw/sw.ts)
  'workbox-expiration': true,
  'workbox-range-requests': true,
  'workbox-routing': true,
  'workbox-strategies': true,
  tailwindcss: false, // preflight CSS
  vite: false, // preload helper and modulepreload polyfill
  'vite-plugin-pwa': false, // registerSW.js
}

// Reviewed exceptions, pinned to the license they were reviewed under.
const EXCEPTIONS: Record<string, { license: string; reason: string }> = {
  isbot: {
    license: 'Unlicense',
    reason: 'public-domain dedication; only used by the SSR path of @tanstack/react-router, not in the client bundle',
  },
}

const NOTICES = path.join(PUBLIC, 'THIRD_PARTY_NOTICES.txt')
const LICENSE_FILE = /^(licen[sc]e|copying|notice)([.\-_].*)?$/i

type Pkg = {
  name: string
  version: string
  license: string
  inferred: boolean
  author: string
  dir: string
  source: string
  via: string
}
type Manifest = {
  name: string
  version: string
  author?: string | { name?: string }
  license?: unknown
  licenses?: unknown
  homepage?: string
  repository?: string | { url?: string }
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

const readManifest = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as Manifest

// Node's resolution walk, so it works for both pnpm's symlinked store and a flat node_modules.
function resolve(name: string, from: string): string | null {
  for (let d = from; ; d = path.dirname(d)) {
    if (path.basename(d) !== 'node_modules') {
      const candidate = path.join(d, 'node_modules', name)
      if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate)
    }
    if (d === path.dirname(d)) return null
  }
}

const licenseFiles = (dir: string) =>
  fs.readdirSync(dir).filter((f) => LICENSE_FILE.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort()

// Same fallback pnpm uses when package.json has no license field: read it off the LICENSE file.
function inferLicense(dir: string): string {
  const text = licenseFiles(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
  if (/Permission is hereby granted, free of charge/i.test(text)) return 'MIT'
  if (/Apache License,?\s+Version 2\.0/i.test(text)) return 'Apache-2.0'
  if (/Permission to use, copy, modify, and\/or distribute this software/i.test(text)) {
    return /provided that the above copyright notice/i.test(text) ? 'ISC' : '0BSD'
  }
  return 'UNKNOWN'
}

function sourceUrl(m: Manifest): string {
  const repo = typeof m.repository === 'string' ? m.repository : m.repository?.url
  const url = m.homepage ?? repo ?? ''
  return url.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '').replace(/^github:/, 'https://github.com/')
}

function collect(): Pkg[] {
  const root = readManifest(ROOT)
  const found = new Map<string, Pkg>()
  const seenDirs = new Set<string>()
  const queue: { name: string; from: string; via: string; walk: boolean; optional: boolean }[] = [
    ...Object.keys(root.dependencies ?? {}).map((name) => ({ name, from: ROOT, via: 'dependencies', walk: true, optional: false })),
    ...Object.entries(BUNDLED_DEV).map(([name, walk]) => ({ name, from: ROOT, via: 'bundled dev', walk, optional: false })),
  ]
  while (queue.length) {
    const { name, from, via, walk, optional } = queue.shift()!
    const dir = resolve(name, from)
    if (!dir) {
      if (optional) continue
      throw new Error(`cannot resolve ${name} (needed by ${via}); run pnpm install`)
    }
    if (seenDirs.has(dir)) continue
    seenDirs.add(dir)
    const m = readManifest(dir)
    const key = `${m.name}@${m.version}`
    if (!found.has(key)) {
      const declared = normalizeLicense(m.license ?? m.licenses)
      found.set(key, {
        name: m.name,
        version: m.version,
        license: declared === 'UNKNOWN' ? inferLicense(dir) : declared,
        inferred: declared === 'UNKNOWN',
        author: (typeof m.author === 'string' ? m.author : m.author?.name) ?? '',
        dir,
        source: sourceUrl(m),
        via,
      })
    }
    if (!walk) continue
    for (const dep of Object.keys(m.dependencies ?? {})) queue.push({ name: dep, from: dir, via: key, walk: true, optional: false })
    for (const dep of Object.keys(m.optionalDependencies ?? {})) queue.push({ name: dep, from: dir, via: key, walk: true, optional: true })
  }
  return [...found.values()].sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name < b.name ? -1 : 1))
}

function licenseTexts(pkg: Pkg): string {
  const files = licenseFiles(pkg.dir)
  if (!files.length) {
    const by = pkg.author ? ` Author: ${pkg.author}.` : ''
    return `No license file is included in the published package. Declared license: ${pkg.license}.${by}`
  }
  return files
    .map((f) => fs.readFileSync(path.join(pkg.dir, f), 'utf8').replace(/\r\n?/g, '\n').replace(/\s+$/, ''))
    .join('\n\n')
}

function notices(pkgs: Pkg[]): string {
  const rule = '='.repeat(80)
  const head = [
    'Tenset: third-party notices',
    '',
    'Generated by pipeline/compliance/licenses.ts from the production dependency tree plus the build',
    'packages that emit code into the app (Workbox in the service worker, Tailwind CSS preflight, Vite',
    'and vite-plugin-pwa runtime helpers). Some packages are only reachable through optional code paths',
    'and may not ship in the bundle. Asset credits (BodyParts3D, MakeHuman/MPFB2) are on the Credits page.',
    '',
    `${pkgs.length} packages.`,
  ]
  const body = pkgs.map((p) => {
    const license = `License: ${p.license}${p.inferred ? ' (from the license file)' : ''}`
    const source = p.source ? [`Source: ${p.source}`] : []
    return [rule, `${p.name} ${p.version}`, license, ...source, '', licenseTexts(p), ''].join('\n')
  })
  return [...head, '', ...body].join('\n')
}

const pkgs = collect()
const failures: string[] = []
const exceptions: string[] = []
for (const p of pkgs) {
  let ok = false
  try {
    ok = spdxAllowed(p.license, ALLOWED)
  } catch {
    // malformed expressions need a manual review
  }
  if (ok) continue
  const ex = EXCEPTIONS[p.name]
  if (ex && ex.license === p.license) exceptions.push(`${p.name}@${p.version} (${p.license}): ${ex.reason}`)
  else failures.push(`${p.name}@${p.version}: ${p.license} (via ${p.via}, ${path.relative(ROOT, p.dir)})`)
}

const counts = new Map<string, number>()
for (const p of pkgs) counts.set(p.license, (counts.get(p.license) ?? 0) + 1)
console.log(`${pkgs.length} shipped packages: ${[...counts].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`).join(', ')}`)
for (const e of exceptions) console.log(`EXCEPTION ${e}`)
for (const f of failures) console.log(`DISALLOWED ${f}`)

const text = notices(pkgs)
if (process.argv.includes('--write')) {
  fs.writeFileSync(NOTICES, text)
  console.log(`wrote ${path.relative(ROOT, NOTICES)} (${(text.length / 1024).toFixed(1)} KiB)`)
} else if (!fs.existsSync(NOTICES) || fs.readFileSync(NOTICES, 'utf8') !== text) {
  failures.push('notices')
  console.log(`STALE ${path.relative(ROOT, NOTICES)}: run pnpm licenses:notices`)
}
if (failures.length) process.exit(1)
