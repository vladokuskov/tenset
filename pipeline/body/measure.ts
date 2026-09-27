// Segment lengths and landmark heights of a body GLB, compared with adult male ratios of stature.
// node pipeline/body/measure.ts [glb ...] [--json out.json]
// Joint lengths are between rig joint centres at rest; heights assume arms hanging straight (shoulder joint height
// minus the arm segments), as in the Drillis-Contini figure.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { MeshoptDecoder } from 'meshoptimizer'
import { Vector3, type Object3D, type SkinnedMesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { poses } from '../../src/features/figure/poses.ts'
import { Rig } from '../../src/features/figure/rig.ts'
import { PUBLIC } from '../lib/paths.ts'

// Drillis & Contini (1966), as tabulated in Winter, Biomechanics and Motor Control of Human Movement
export const REFERENCE: Record<string, number> = {
  upperArm: 0.186, forearm: 0.146, hand: 0.108, thigh: 0.245, shank: 0.246, shoulderWidth: 0.259,
  shoulderHeight: 0.818, elbowHeight: 0.63, wristHeight: 0.485, fingertipHeight: 0.377, hipHeight: 0.53, kneeHeight: 0.285,
  headHeight: 0.13, trunk: 0.288,
}

async function load(file: string): Promise<Object3D> {
  await MeshoptDecoder.ready
  const buf = readFileSync(file)
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  return (await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '')).scene
}

function skinned(mesh: SkinnedMesh) {
  mesh.updateMatrixWorld(true)
  mesh.skeleton.update()
  const n = mesh.geometry.getAttribute('position').count
  const out: Vector3[] = []
  for (let i = 0; i < n; i++) out.push(mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld))
  return out
}

function dominant(mesh: SkinnedMesh, i: number) {
  const si = mesh.geometry.getAttribute('skinIndex')
  const sw = mesh.geometry.getAttribute('skinWeight')
  let b = 0, w = -1
  for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > w) { w = sw.getComponent(i, k); b = si.getComponent(i, k) }
  return mesh.skeleton.bones[b].name
}

export async function measure(file: string) {
  const scene = await load(file)
  const rig = new Rig(scene)
  const mesh = rig.mesh
  // correctives.ts is loaded at runtime only: it uses the app's extensionless imports, which the pipeline tsconfig rejects
  const { Correctives } = (await import(String('../../src/features/figure/correctives.ts'))) as {
    Correctives: { fromScene(rig: Rig, scene: Object3D): { update(): void } }
  }
  const correctives = Correctives.fromScene(rig, scene)
  rig.reset()
  correctives.update()
  scene.updateMatrixWorld(true)
  const P = skinned(mesh)
  const names = P.map((_, i) => dominant(mesh, i))
  const at = (b: string) => rig.bone(b).getWorldPosition(new Vector3())
  const both = (f: (s: string) => number) => (f('L') + f('R')) / 2
  const len = (a: string, b: string) => both((s) => at(`${a}_${s}`).distanceTo(at(`${b}_${s}`)))
  const ys = P.map((p) => p.y)
  const floor = Math.min(...ys)
  const H = Math.max(...ys) - floor
  const hand = both((s) => Math.max(...P.filter((_, i) => names[i].startsWith('finger3') && names[i].endsWith(`_${s}`)).map((p) => p.distanceTo(at(`wrist_${s}`)))))
  const upperArm = len('upperarm01', 'lowerarm01')
  const forearm = len('lowerarm01', 'wrist')
  const shoulderY = both((s) => at(`upperarm01_${s}`).y) - floor
  const hipY = both((s) => at(`upperleg01_${s}`).y) - floor
  // mesh breadth at and above the shoulder joints, within 4 cm of their depth (upper bound for biacromial)
  const jz = at('upperarm01_L').z
  const top = P.filter((p) => p.y > shoulderY + floor && Math.abs(p.z - jz) < 0.04)
  const shoulderMesh = Math.max(...top.map((p) => p.x)) - Math.min(...top.map((p) => p.x))
  // menton: lowest midline point clearly in front of the throat
  const neckY = at('neck01').y
  const mid = P.filter((p) => Math.abs(p.x) < 0.006 && p.y > neckY && p.y < at('head').y)
  const throat = Math.max(...mid.filter((p) => p.y < neckY + 0.01).map((p) => p.z))
  const front = (throat + Math.max(...mid.map((p) => p.z))) / 2
  const menton = Math.min(...mid.filter((p) => p.z > front).map((p) => p.y))
  // arms hanging at the sides (anatomical pose): widest point across the deltoids
  rig.apply(poses.anatomical)
  correctives.update()
  scene.updateMatrixWorld(true)
  const Q = skinned(mesh)
  const delt = Q.filter((p) => p.y - floor > shoulderY - 0.16 && p.y - floor < shoulderY + 0.03)
  const bideltoid = Math.max(...delt.map((p) => p.x)) - Math.min(...delt.map((p) => p.x))
  rig.reset()
  const m = {
    stature: H,
    upperArm, forearm, hand,
    thigh: len('upperleg01', 'lowerleg01'),
    shank: len('lowerleg01', 'foot'),
    shoulderWidth: at('upperarm01_L').distanceTo(at('upperarm01_R')),
    shoulderMesh,
    bideltoid,
    trunk: shoulderY - hipY,
    headHeight: H + floor - menton,
    shoulderHeight: shoulderY,
    elbowHeight: shoulderY - upperArm,
    wristHeight: shoulderY - upperArm - forearm,
    fingertipHeight: shoulderY - upperArm - forearm - hand,
    hipHeight: hipY,
    kneeHeight: both((s) => at(`lowerleg01_${s}`).y) - floor,
    armSpan: at('upperarm01_L').distanceTo(at('upperarm01_R')) + 2 * (upperArm + forearm + hand),
  }
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 10000) / 10000])) as typeof m
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const j = args.indexOf('--json')
  const jsonOut = j >= 0 ? args.splice(j, 2)[1] : undefined
  const files = args.length ? args : [path.join(PUBLIC, 'models/body.glb')]
  const all = await Promise.all(files.map(measure))
  const rows = Object.keys(all[0]).map((k) => {
    const cells = all.flatMap((m) => {
      const v = m[k as keyof typeof m]
      return [`${(v * 100).toFixed(1)} cm`, k === 'stature' ? '' : `${(v / m.stature).toFixed(3)}H`]
    })
    return [k, ...cells, REFERENCE[k] ? `${REFERENCE[k].toFixed(3)}H` : '']
  })
  for (const r of rows) console.log(r.map((c, i) => (i ? c.padStart(10) : c.padEnd(16))).join(' '))
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(Object.fromEntries(files.map((f, i) => [path.basename(f), all[i]])), null, 1))
}
