// BodyParts3D 4.0 access for the atlas: concept lookup, cached OBJ meshes and bone landmarks.
// BodyParts3D axes: +x subject left, +y posterior, +z up, millimetres.
import fs from 'node:fs'
import path from 'node:path'
import { CACHE } from '../lib/paths.ts'
import { loadObj, type Mesh } from '../lib/obj.ts'

export const BP3D = path.join(CACHE, 'bodyparts3d')
const OBJ_DIR = path.join(BP3D, 'isa_BP3D_4.0_obj_99')

export type Vec = [number, number, number]

let concepts: Map<string, string[]> | null = null

export function conceptFiles(name: string): string[] {
  if (!concepts) {
    concepts = new Map()
    for (const line of fs.readFileSync(path.join(BP3D, 'isa_element_parts.txt'), 'utf8').split('\n').slice(1)) {
      const [, n, file] = line.trim().split('\t')
      if (!file) continue
      const list = concepts.get(n) ?? []
      list.push(file)
      concepts.set(n, list)
    }
  }
  const f = concepts.get(name)
  if (!f) throw new Error(`BodyParts3D concept not found: "${name}"`)
  return [...f].sort()
}

const meshes = new Map<string, Mesh>()
export function bpMesh(file: string): Mesh {
  let m = meshes.get(file)
  if (!m) {
    const p = path.join(OBJ_DIR, `${file}.obj`)
    if (!fs.existsSync(p)) throw new Error(`missing ${p}; run node pipeline/anatomy/fetch-bodyparts3d.ts`)
    m = loadObj(p)
    meshes.set(file, m)
  }
  return m
}

function points(name: string): Vec[] {
  const out: Vec[] = []
  for (const f of conceptFiles(name)) {
    const p = bpMesh(f).positions
    for (let i = 0; i < p.length; i += 3) out.push([p[i], p[i + 1], p[i + 2]])
  }
  return out
}

const mid = (a: Vec, b: Vec): Vec => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
const extreme = (pts: Vec[], score: (p: Vec) => number) => pts.reduce((best, p) => (score(p) > score(best) ? p : best))
const centroid = (pts: Vec[]): Vec => {
  const c: Vec = [0, 0, 0]
  for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / pts.length
  return c
}

function solve4(A: number[][], b: number[]) {
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < 4; c++) {
    let piv = c
    for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    ;[M[c], M[piv]] = [M[piv], M[c]]
    for (let r = 0; r < 4; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k < 5; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[4] / M[i][i])
}

/** Least-squares sphere, refit on the best-fitting half three times (drops tubercles and trochanters). */
export function fitSphere(pts: Vec[]): { center: Vec; radius: number } {
  let use = pts
  let center: Vec = [0, 0, 0]
  let radius = 0
  for (let iter = 0; iter < 4; iter++) {
    const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]
    const b = [0, 0, 0, 0]
    for (const [x, y, z] of use) {
      const row = [2 * x, 2 * y, 2 * z, 1]
      const rhs = x * x + y * y + z * z
      for (let i = 0; i < 4; i++) {
        b[i] += row[i] * rhs
        for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j]
      }
    }
    const s = solve4(A, b)
    center = [s[0], s[1], s[2]]
    radius = Math.sqrt(s[3] + s[0] * s[0] + s[1] * s[1] + s[2] * s[2])
    const res = pts.map((p) => Math.abs(Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]) - radius))
    const cut = [...res].sort((a, b) => a - b)[Math.floor(res.length * 0.5)]
    use = pts.filter((_, i) => res[i] <= cut)
  }
  return { center, radius }
}

export type Side = 'l' | 'r'
export const SIDES: Side[] = ['l', 'r']
const sideName = (s: Side) => (s === 'l' ? 'left' : 'right')

/**
 * Joint centres and a few bony landmarks, named after the MakeHuman bones whose heads they match.
 * Conventions follow the ISB joint-centre definitions where a bone mesh allows it.
 */
export function bp3dLandmarks() {
  const out: Record<string, Vec> = {}
  const sgn = (s: Side) => (s === 'l' ? 1 : -1)
  for (const s of SIDES) {
    const S = s === 'l' ? 'L' : 'R'
    const lat = (p: Vec) => p[0] * sgn(s)
    const humerus = points(`${sideName(s)} humerus`)
    const hTop = Math.max(...humerus.map((p) => p[2]))
    out[`upperarm01_${S}`] = fitSphere(humerus.filter((p) => p[2] > hTop - 45)).center
    const hBot = Math.min(...humerus.map((p) => p[2]))
    const distal = humerus.filter((p) => p[2] < hBot + 45)
    out[`lowerarm01_${S}`] = mid(extreme(distal, lat), extreme(distal, (p) => -lat(p)))
    const radius = points(`${sideName(s)} radius`)
    const ulna = points(`${sideName(s)} ulna`)
    const radialStyloid = extreme(radius, (p) => -p[2])
    const ulnarStyloid = extreme(ulna, (p) => -p[2])
    out[`wrist_${S}`] = mid(radialStyloid, ulnarStyloid)
    out[`radial_${S}`] = radialStyloid
    out[`ulnar_${S}`] = ulnarStyloid
    const femur = points(`${sideName(s)} femur`)
    const fTop = Math.max(...femur.map((p) => p[2]))
    const top = femur.filter((p) => p[2] > fTop - 60)
    const medianLat = [...top.map(lat)].sort((a, b) => a - b)[Math.floor(top.length / 2)]
    out[`upperleg01_${S}`] = fitSphere(top.filter((p) => lat(p) < medianLat)).center
    const fBot = Math.min(...femur.map((p) => p[2]))
    const condyles = femur.filter((p) => p[2] < fBot + 50)
    out[`lowerleg01_${S}`] = mid(extreme(condyles, lat), extreme(condyles, (p) => -lat(p)))
    const medialMalleolus = extreme(points(`${sideName(s)} tibia`), (p) => -p[2])
    const lateralMalleolus = extreme(points(`${sideName(s)} fibula`), (p) => -p[2])
    out[`foot_${S}`] = mid(medialMalleolus, lateralMalleolus)
    const clavicle = points(`${sideName(s)} clavicle`)
    out[`clavicle_${S}`] = extreme(clavicle, (p) => -lat(p))
    out[`shoulder01_${S}`] = extreme(clavicle, lat)
  }
  out.neck01 = centroid(points('seventh cervical vertebra'))
  out.head = centroid(points('atlas'))
  out.jugular = extreme(points('manubrium'), (p) => p[2])
  out.xiphoid = extreme(points('xiphoid process'), (p) => -p[2])
  const skin = points('skin')
  out.vertex = extreme(skin, (p) => p[2])
  return out
}
