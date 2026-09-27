// Downloads BodyParts3D 4.0 (isa tree) into pipeline/.cache/bodyparts3d, verifies the pinned
// sha256 and unzips the OBJs. Usage: node pipeline/anatomy/fetch-bodyparts3d.ts
// DBCLS can be very slow; the zip falls back to the Wayback capture, which is byte-identical.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { CACHE } from '../lib/paths.ts'

const DIR = path.join(CACHE, 'bodyparts3d')
const BASE = 'https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST'
const WAYBACK = 'http://web.archive.org/web/20251024110942id_/' + BASE + '/isa_BP3D_4.0_obj_99.zip'
const ZIP = 'isa_BP3D_4.0_obj_99.zip'
const PINNED: Record<string, string> = {
  [ZIP]: '40665852c49f218326590e204db91064a1ecfc3c6f8cbd7bbbcaac62c7cd409e',
  'isa_element_parts.txt': 'a3de74423f943b0d724ae8f59b3a817f87c423a544f8db98113b1980817cbeaf',
  'isa_parts_list_e.txt': 'ab7796deedd49205e77f3609a1cb8c53e2bbee14ecb5c9a6ca05227469780513',
}

const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

async function download(url: string, dest: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

fs.mkdirSync(DIR, { recursive: true })
for (const [name, hash] of Object.entries(PINNED)) {
  const dest = path.join(DIR, name)
  if (fs.existsSync(dest) && sha256(dest) === hash) continue
  const urls = name === ZIP ? [`${BASE}/${name}`, WAYBACK] : [`${BASE}/${name}`]
  for (const url of urls) {
    try {
      console.log(`downloading ${url}`)
      await download(url, dest)
      if (sha256(dest) === hash) break
      console.log(`  sha256 mismatch for ${name}`)
    } catch (e) {
      console.log(`  failed: ${(e as Error).message}`)
    }
  }
  if (!fs.existsSync(dest) || sha256(dest) !== hash) throw new Error(`could not fetch ${name} with sha256 ${hash}`)
}

if (!fs.existsSync(path.join(DIR, 'isa_BP3D_4.0_obj_99', 'FJ2810.obj'))) {
  execFileSync('unzip', ['-qo', path.join(DIR, ZIP), '-d', DIR], { stdio: 'inherit' })
}
console.log(`BodyParts3D ready in ${path.relative(process.cwd(), DIR)}`)
