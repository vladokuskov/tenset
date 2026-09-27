// Builds public/models/body.glb (stylized head): MPFB2 (pinned) in headless Blender, then gltf-transform.
// node pipeline/body/build-body.ts [--skip-blender] [--out file.glb --work dir] [--proportions '{"target": weight}']
// --out/--work build a variant elsewhere (the shipped GLB and cache stay); --proportions overrides PROPORTIONS weights.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { type Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { compactPrimitive, dedup, meshopt, prune, quantize, reorder, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import { CACHE, PUBLIC, ROOT } from '../lib/paths.ts'
import { MPFB2 } from './mpfb2-pin.ts'

const { values: args } = parseArgs({
  options: { 'skip-blender': { type: 'boolean' }, out: { type: 'string' }, work: { type: 'string' }, proportions: { type: 'string' } },
})
const BLENDER = process.env.BLENDER ?? 'blender'
const WORK = path.resolve(args.work ?? path.join(CACHE, 'body'))
const RAW = path.join(WORK, 'body.raw.glb')
const REPORT = path.join(WORK, 'report.json')
const OUT = path.resolve(args.out ?? path.join(PUBLIC, 'models/body.glb'))
const SHIPPED = !args.out
const LEGACY = ['body-a.glb', 'body-b.glb'].map((f) => path.join(PUBLIC, 'models', f))
const BUDGET = 700 * 1024

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

function blender() {
  const log = sh(BLENDER, [
    '-b', '--factory-startup', '-P', path.join(ROOT, 'pipeline/body/build_body.py'),
    '--', '--out', RAW, '--report', REPORT, '--blend', path.join(WORK, 'body.blend'),
    ...(args.proportions ? ['--proportions', args.proportions] : []),
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

/**
 * Size trims that change nothing on screen: sub-millimetre corrective deltas become exact zeros (meshopt stores
 * runs of zeros almost for free), all-zero targets are dropped per mesh (the shorts never see the shoulder keys),
 * and UVs the shaders never read (hair, shorts) are removed. Correctives look targets up by name per mesh.
 */
function trim(doc: Document, { minDelta = 0.0003, minNormal = 0.02 } = {}) {
  for (const mesh of doc.getRoot().listMeshes()) {
    const extras = mesh.getExtras() as { targetNames?: string[] }
    const names = extras.targetNames ?? []
    const keep: boolean[] = []
    for (const prim of mesh.listPrimitives()) {
      if (['hair', 'shorts'].includes(prim.getMaterial()?.getName() ?? '')) prim.setAttribute('TEXCOORD_0', null)
      prim.listTargets().forEach((t, i) => {
        const pos = t.getAttribute('POSITION')!.getArray()!
        const nrm = t.getAttribute('NORMAL')?.getArray()
        let any = false
        for (let v = 0; v < pos.length; v += 3) {
          if (Math.hypot(pos[v], pos[v + 1], pos[v + 2]) < minDelta) pos[v] = pos[v + 1] = pos[v + 2] = 0
          else any = true
          if (nrm && Math.hypot(nrm[v], nrm[v + 1], nrm[v + 2]) < minNormal) nrm[v] = nrm[v + 1] = nrm[v + 2] = 0
        }
        keep[i] = any
      })
      prim.listTargets().forEach((t, i) => { if (!keep[i]) prim.removeTarget(t) })
    }
    if (!names.length) continue
    mesh.setExtras({ ...extras, targetNames: names.filter((_, i) => keep[i]) })
    mesh.setWeights(mesh.getWeights().filter((_, i) => keep[i]))
  }
}

// bone groups whose weight shares steer the simplifier (deformation must stay smooth where they blend)
const GROUPS = [/^upperarm0\d_L/, /^upperarm0\d_R/, /^(lowerarm0\d|wrist)_L/, /^(lowerarm0\d|wrist)_R/, /^(metacarpal|finger).*_L/, /^(metacarpal|finger).*_R/,
  /^upperleg0\d_L/, /^upperleg0\d_R/, /^lowerleg0\d_L/, /^lowerleg0\d_R/, /^(clavicle|shoulder01)_L/, /^(clavicle|shoulder01)_R/,
  /^spine0[12]$/, /^(spine0[345]|root|pelvis_.)$/, /^(neck0\d|head)$/, /^(foot|toe).*_L/, /^(foot|toe).*_R/]

/**
 * Drops body vertices that carry no information: meshopt collapses edges where position, normal, UV, skin weight
 * shares and corrective deltas all stay (near) linear, keeping UV seams and borders. Relief and muscle detail live in
 * the atlas textures, so the smooth subdivision surface does not need its full density.
 */
async function simplifyBody(doc: Document, ratio: number, error: number) {
  await MeshoptSimplifier.ready
  const prim = meshNode(doc, 'body').getMesh()!.listPrimitives()[0]
  const pos = prim.getAttribute('POSITION')!
  const n = pos.getCount()
  const P = new Float32Array(pos.getArray()!)
  const scale = MeshoptSimplifier.getScale(P, 3)
  const nrm = prim.getAttribute('NORMAL')!
  const uv = prim.getAttribute('TEXCOORD_0')!
  const joints = prim.getAttribute('JOINTS_0')!
  const weights = prim.getAttribute('WEIGHTS_0')!
  const bones = doc.getRoot().listSkins()[0].listJoints().map((j) => j.getName())
  const group = bones.map((b) => GROUPS.findIndex((re) => re.test(b)))
  const targets = prim.listTargets()
  // corrective delta magnitude summed per joint and side (the simplifier takes at most 32 attributes)
  const names = (meshNode(doc, 'body').getMesh()!.getExtras() as { targetNames: string[] }).targetNames
  const families = [...new Set(names.map((t) => t.replace(/^cor_([a-z]+).*_([LR])$/, '$1_$2')))]
  const family = names.map((t) => families.indexOf(t.replace(/^cor_([a-z]+).*_([LR])$/, '$1_$2')))
  const K = 5 + GROUPS.length + families.length
  const A = new Float32Array(n * K)
  const wts = [0.02, 0.02, 0.02, 1.5, 1.5, ...GROUPS.map(() => 0.15), ...families.map(() => 1 / scale)]
  const v3 = [0, 0, 0], v2 = [0, 0], j4 = [0, 0, 0, 0], w4 = [0, 0, 0, 0]
  for (let i = 0; i < n; i++) {
    const o = i * K
    nrm.getElement(i, v3)
    A.set(v3, o)
    uv.getElement(i, v2)
    A.set(v2, o + 3)
    joints.getElement(i, j4)
    weights.getElement(i, w4)
    for (let k = 0; k < 4; k++) if (group[j4[k]] >= 0) A[o + 5 + group[j4[k]]] += w4[k]
    targets.forEach((t, k) => {
      t.getAttribute('POSITION')!.getElement(i, v3)
      A[o + 5 + GROUPS.length + family[k]] += Math.hypot(v3[0], v3[1], v3[2])
    })
  }
  // the face, hands and feet carry their shape in geometry alone (no relief texture): keep them as built
  const lock = new Uint8Array(n)
  const locked = [4, 5, 14, 15, 16].map((g) => 5 + g)
  for (let i = 0; i < n; i++) if (locked.some((c) => A[i * K + c] > 0.3)) lock[i] = 1
  const idx = new Uint32Array(prim.getIndices()!.getArray()!)
  const [out, err] = MeshoptSimplifier.simplifyWithAttributes(idx, P, 3, A, K, wts, lock, Math.floor(idx.length * ratio / 3) * 3, error, ['LockBorder'])
  prim.getIndices()!.setArray(n > 65535 ? new Uint32Array(out) : new Uint16Array(out))
  compactPrimitive(prim)
  return { before: n, after: prim.getAttribute('POSITION')!.getCount(), error: +(err * scale * 1000).toFixed(2) }
}

async function main() {
  mkdirSync(WORK, { recursive: true })
  if (!args['skip-blender']) {
    await ensureMpfb()
    blender()
  }

  await MeshoptEncoder.ready
  await MeshoptDecoder.ready
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
  const report = JSON.parse(readFileSync(REPORT, 'utf8'))
  const doc = await io.read(RAW)
  const asset = doc.getRoot().getAsset()
  asset.generator = 'gym-builder build-body'
  asset.copyright = 'Base mesh, rig, targets and tights proxy: MakeHuman/MPFB2 assets, CC0 1.0'
  meshNode(doc, 'body').setExtras({ correctives: report.correctives })
  adoptMorphNormals(doc)
  trim(doc)
  // error is relative to the figure's extent: 0.00051 is under a millimetre
  const simplified = await simplifyBody(doc, 0.3, 0.00051)
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
  mkdirSync(path.dirname(OUT), { recursive: true })
  await io.write(OUT, doc)
  const bytes = statSync(OUT).size
  const meshes = Object.fromEntries(['body', 'shorts', 'hair', 'eyes'].map((m) => {
    const prim = meshNode(doc, m).getMesh()!.listPrimitives()[0]
    return [m, { vertices: prim.getAttribute('POSITION')!.getCount(), triangles: prim.getIndices()!.getCount() / 3, morphs: prim.listTargets().length }]
  }))
  console.log(JSON.stringify({ out: path.relative(ROOT, OUT), bytes, kb: +(bytes / 1024).toFixed(1), meshes, simplified, bones: report.bones.length }, null, 1))
  if (bytes > BUDGET) throw new Error(`body.glb is ${bytes} bytes, over the ${BUDGET} budget`)
  if (SHIPPED) for (const f of LEGACY) if (existsSync(f)) rmSync(f)
}

await main()
