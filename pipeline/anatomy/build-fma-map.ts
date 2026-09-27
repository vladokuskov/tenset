// Resolves fma-spec.ts against the BodyParts3D isa parts lists and writes fma-map.json.
// Usage: node pipeline/anatomy/build-fma-map.ts
import fs from 'node:fs'
import path from 'node:path'
import { CACHE, DATA, ROOT } from '../lib/paths.ts'
import { OCCLUDER_CONCEPTS, OCCLUDER_EXCLUDE, REGIONS, SKIN } from './fma-spec.ts'

const BP3D = path.join(CACHE, 'bodyparts3d')
const OUT = path.join(ROOT, 'pipeline/anatomy/fma-map.json')

type Concept = { fma: string; files: string[] }

function loadElementParts(): Map<string, Concept> {
  const text = fs.readFileSync(path.join(BP3D, 'isa_element_parts.txt'), 'utf8')
  const byName = new Map<string, Concept>()
  for (const line of text.split('\n').slice(1)) {
    const [fma, name, file] = line.trim().split('\t')
    if (!file) continue
    const c = byName.get(name) ?? { fma, files: [] }
    c.files.push(file)
    byName.set(name, c)
  }
  return byName
}

const concepts = loadElementParts()

function resolve(name: string): Concept {
  const c = concepts.get(name)
  if (!c) throw new Error(`BodyParts3D concept not found: "${name}"`)
  return { fma: c.fma, files: [...c.files].sort() }
}

function sides(rightName: string) {
  if (!rightName.includes('right ')) throw new Error(`spec name must name the right side: ${rightName}`)
  const leftName = rightName.replace('right ', 'left ')
  return { r: { name: rightName, ...resolve(rightName) }, l: { name: leftName, ...resolve(leftName) } }
}

const taxonomy = JSON.parse(fs.readFileSync(path.join(DATA, 'taxonomy.json'), 'utf8')) as {
  heads: { id: string; group: string; view: string }[]
  untracked: { id: string; view: string }[]
}

const viewsOf = (flag: string) => (flag === 'FB' ? ['F', 'B'] : [flag])

const regions = REGIONS.map((spec) => {
  const head = taxonomy.heads.find((h) => h.id === spec.id)
  const src = spec.kind === 'head' ? head : taxonomy.untracked.find((u) => u.id === spec.id)
  if (!src) throw new Error(`${spec.id} is not in taxonomy.json`)
  const group = spec.kind === 'head' ? head!.group : null
  return {
    id: spec.id,
    kind: spec.kind,
    group,
    views: spec.views ?? viewsOf(src.view),
    ...(spec.clip ? { clip: spec.clip } : {}),
    source: spec.parts.length ? 'bodyparts3d' : 'hand-polygon',
    parts: spec.parts.map((p) => ({
      ...(p.deep ? { deep: p.deep } : {}),
      ...(p.clip ? { clip: p.clip } : {}),
      ...(p.maxThicknessMm ? { maxThicknessMm: p.maxThicknessMm } : {}),
      ...(p.overrides ? { overrides: p.overrides } : {}),
      ...sides(p.name),
    })),
  }
})

const missing = [...taxonomy.heads, ...taxonomy.untracked].filter((h) => !regions.some((r) => r.id === h.id))
if (missing.length) throw new Error(`taxonomy ids without a region: ${missing.map((m) => m.id).join(', ')}`)

const regionFiles = new Set<string>()
for (const r of regions) for (const p of r.parts) for (const f of [...p.l.files, ...p.r.files]) regionFiles.add(f)
const excluded = new Set(OCCLUDER_EXCLUDE.flatMap((n) => resolve(n).files))
const occluderFiles = [...new Set(OCCLUDER_CONCEPTS.flatMap((c) => resolve(c).files))]
  .filter((f) => !regionFiles.has(f) && !excluded.has(f))
  .sort()

const map = {
  source: 'BodyParts3D 4.0, isa tree (isa_element_parts.txt). Right-side names resolved; left = same concept with "left".',
  coordinates: 'mm; +x = subject left, +y = posterior, +z = superior',
  skin: { name: SKIN, ...resolve(SKIN) },
  regions,
  occluders: { concepts: OCCLUDER_CONCEPTS, exclude: OCCLUDER_EXCLUDE, files: occluderFiles },
}

fs.writeFileSync(OUT, JSON.stringify(map, null, 1) + '\n')
console.log(`wrote ${path.relative(ROOT, OUT)}: ${regions.length} regions, ${regionFiles.size} region files, ${occluderFiles.length} occluder files`)
