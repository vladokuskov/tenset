// Builds public/models/body-a.glb (realistic head) and body-b.glb (stylized head): MPFB2 (pinned) in headless
// Blender, then gltf-transform. Both share skeleton, UVs, hair, shorts and corrective morphs.
// node pipeline/body/build-body.ts [--skip-blender] [--variant a|b]
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { type Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, meshopt, prune, quantize, reorder, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import { CACHE, PUBLIC, ROOT } from '../lib/paths.ts'
import { MPFB2 } from './mpfb2-pin.ts'

const BLENDER = process.env.BLENDER ?? 'blender'
const WORK = path.join(CACHE, 'body')
const VARIANTS = ['a', 'b'] as const
type Variant = (typeof VARIANTS)[number]
const raw = (v: Variant) => path.join(WORK, `body-${v}.raw.glb`)
const reportPath = (v: Variant) => path.join(WORK, `report-${v}.json`)
const out = (v: Variant) => path.join(PUBLIC, `models/body-${v}.glb`)
const LEGACY = path.join(PUBLIC, 'models/body.glb')
const BUDGET = 900 * 1024

function sh(cmd: string, args: string[]) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).toString()
}

function installedVersion(): string | null {
  const manifest = path.join(homedir(), `Library/Application Support/Blender/${MPFB2.blenderSeries}/extensions/user_default/mpfb/blender_manifest.toml`)
  if (!existsSync(manifest)) return null
  return /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(manifest, 'utf8'))?.[1] ?? null
}

async function ensureMpfb() {
  if (installedVersion() === MPFB2.version) return
  const dir = path.join(CACHE, 'mpfb2')
  mkdirSync(dir, { recursive: true })
  const tarball = path.join(dir, `mpfb2-${MPFB2.commit.slice(0, 7)}.tar.gz`)
  if (!existsSync(tarball)) {
    const res = await fetch(`https://codeload.github.com/makehumancommunity/mpfb2/tar.gz/${MPFB2.commit}`)
    if (!res.ok) throw new Error(`MPFB2 download failed: ${res.status}`)
    writeFileSync(tarball, Buffer.from(await res.arrayBuffer()))
  }
  const sha = createHash('sha256').update(readFileSync(tarball)).digest('hex')
  if (sha !== MPFB2.tarballSha256) throw new Error(`MPFB2 tarball sha256 mismatch: ${sha}`)
  sh('tar', ['xzf', tarball, '-C', dir])
  const src = path.join(dir, `mpfb2-${MPFB2.commit}`, 'src/mpfb')
  const zip = path.join(dir, `mpfb-${MPFB2.version}.zip`)
  execFileSync('zip', ['-qr', zip, '.', '-x', '*.pyc', '__pycache__/*'], { cwd: src })
  sh(BLENDER, ['--command', 'extension', 'install-file', '-r', 'user_default', '-e', zip])
  if (installedVersion() !== MPFB2.version) throw new Error('MPFB2 install did not take')
}

function blender(v: Variant) {
  const log = sh(BLENDER, [
    '-b', '--factory-startup', '-P', path.join(ROOT, 'pipeline/body/build_body.py'),
    '--', '--variant', v, '--out', raw(v), '--report', reportPath(v), '--blend', path.join(WORK, `body-${v}.blend`),
  ])
  const ok = log.split('\n').find((l) => l.startsWith('BUILD_BODY_OK'))
  if (!ok) throw new Error(`Blender build failed:\n${log.slice(-4000)}`)
  console.log(ok)
}

function meshNode(doc: Document, name: string) {
  const node = doc.getRoot().listNodes().find((n) => n.getName() === name && n.getMesh())
  if (!node) throw new Error(`no mesh node ${name}`)
  return node
}

function attr(doc: Document, mesh: string, semantic: string) {
  const prim = meshNode(doc, mesh).getMesh()!.listPrimitives()[0]
  return prim.getAttribute(semantic)!.getArray()!
}

/** equal within `tol`: quantized arrays may differ by one step because both variants round independently */
function sameArray(a: ArrayLike<number>, b: ArrayLike<number>, tol = 1) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > tol) return false
  return true
}

/**
 * correctives.py exports each corrective's normal delta as a companion shape key `<name>__n` (its POSITION delta is
 * the normal delta, already rotated into rest space). Move those into the targets' NORMAL slot and drop them.
 */
function adoptMorphNormals(doc: Document) {
  for (const mesh of doc.getRoot().listMeshes()) {
    const extras = mesh.getExtras() as { targetNames?: string[] }
    const names = extras.targetNames
    if (!names?.some((n) => n.endsWith('__n'))) continue
    for (const prim of mesh.listPrimitives()) {
      const targets = prim.listTargets()
      names.forEach((name, i) => {
        if (!name.endsWith('__n')) return
        const base = targets[names.indexOf(name.slice(0, -3))]
        const delta = targets[i].getAttribute('POSITION')!
        if (!base) throw new Error(`no target for ${name}`)
        base.setAttribute('NORMAL', delta.clone())
        prim.removeTarget(targets[i])
      })
    }
    mesh.setExtras({ ...extras, targetNames: names.filter((n) => !n.endsWith('__n')) })
    mesh.setWeights(mesh.getWeights().filter((_, i) => !names[i].endsWith('__n')))
  }
}

/** Variants must be interchangeable: same skeleton, body UVs and topology, identical hair and shorts. */
function assertCompatible(a: Document, b: Document) {
  const skin = (d: Document) => d.getRoot().listSkins()
  if (skin(a).length !== 1 || skin(b).length !== 1) throw new Error('expected exactly one skin per variant')
  const joints = (d: Document) => skin(d)[0].listJoints().map((j) => j.getName()).join(',')
  if (joints(a) !== joints(b)) throw new Error('variant skeletons differ')
  if (!sameArray(skin(a)[0].getInverseBindMatrices()!.getArray()!, skin(b)[0].getInverseBindMatrices()!.getArray()!, 1e-5)) {
    throw new Error('variant bind poses differ')
  }
  for (const [mesh, semantic] of [['body', 'TEXCOORD_0'], ['body', 'JOINTS_0'], ['hair', 'POSITION'], ['shorts', 'POSITION'], ['shorts', 'TEXCOORD_0']]) {
    // positions are 14-bit values in 16-bit storage: one quantization step is 4 units
    const tol = semantic === 'POSITION' ? 4 : 1
    if (!sameArray(attr(a, mesh, semantic), attr(b, mesh, semantic), tol)) throw new Error(`variant ${mesh}.${semantic} differs`)
  }
}

async function main() {
  mkdirSync(WORK, { recursive: true })
  const only = process.argv.includes('--variant') ? [process.argv[process.argv.indexOf('--variant') + 1] as Variant] : VARIANTS
  if (!process.argv.includes('--skip-blender')) {
    await ensureMpfb()
    for (const v of only) blender(v)
  }

  await MeshoptEncoder.ready
  await MeshoptDecoder.ready
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
  const docs: Partial<Record<Variant, Document>> = {}
  const summary = []
  for (const v of only) {
    const report = JSON.parse(readFileSync(reportPath(v), 'utf8'))
    const doc = await io.read(raw(v))
    const asset = doc.getRoot().getAsset()
    asset.generator = 'gym-builder build-body'
    asset.copyright = 'Base mesh, rig, targets and tights proxy: MakeHuman/MPFB2 assets, CC0 1.0'
    meshNode(doc, 'body').setExtras({ variant: v, correctives: report.correctives })
    adoptMorphNormals(doc)
    // one quantization volume for every mesh, so all skins share inverse binds and Rig.dequant (meshopt re-runs quantize).
    // Blender splits vertices whose per-corner morph normals differ in the last float bits; weld after quantizing.
    const q = { quantizationVolume: 'scene', quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14, quantizeColor: 8, quantizeWeight: 8 } as const
    await doc.transform(
      dedup({ keepUniqueNames: true }),
      prune({ keepAttributes: true }),
      reorder({ encoder: MeshoptEncoder }),
      quantize(q),
      weld(),
      meshopt({ encoder: MeshoptEncoder, level: 'high', ...q }),
    )
    mkdirSync(path.dirname(out(v)), { recursive: true })
    await io.write(out(v), doc)
    docs[v] = doc
    const bytes = statSync(out(v)).size
    const meshes = Object.fromEntries(['body', 'shorts', 'hair', 'eyes'].map((m) => {
      const prim = meshNode(doc, m).getMesh()!.listPrimitives()[0]
      return [m, { vertices: prim.getAttribute('POSITION')!.getCount(), triangles: prim.getIndices()!.getCount() / 3, morphs: prim.listTargets().length }]
    }))
    summary.push({ out: path.relative(ROOT, out(v)), bytes, kb: +(bytes / 1024).toFixed(1), meshes, bones: report.bones.length })
    if (bytes > BUDGET) throw new Error(`body-${v}.glb is ${bytes} bytes, over the ${BUDGET} budget`)
  }
  if (docs.a && docs.b) assertCompatible(docs.a, docs.b)
  if (existsSync(LEGACY)) rmSync(LEGACY)
  console.log(JSON.stringify(summary, null, 1))
}

await main()
