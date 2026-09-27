// Landmark alignment of the MakeHuman body (anatomical pose) to BodyParts3D with a thin-plate spline.
// Landmarks: matched joint centres (shoulders, elbows, wrists, hips, knees, ankles, sternoclavicular joints, C7,
// atlas), the skull vertex, the lowest point of each foot, and surface points found the same way on both skins:
// rays cast from points on each limb and trunk axis (between matched joints) in fixed anatomical directions.
// The surface points fix limb girth and axial rotation, which joint centres alone leave free.
import { bp3dLandmarks, bpMesh, conceptFiles, type Vec } from './bp3d.ts'
import { Bvh } from './bvh.ts'
import type { FigureMesh } from './figure.ts'
import { fitTps } from './tps.ts'

// figure axes (X left, Y up, Z forward, metres) -> BodyParts3D (x left, y posterior, z up, mm)
export const toBp = (p: ArrayLike<number>, i = 0): Vec => [p[i] * 1000, -p[i + 2] * 1000, p[i + 1] * 1000]

const JOINTS = ['upperarm01', 'lowerarm01', 'wrist', 'upperleg01', 'lowerleg01', 'foot', 'clavicle']
/** thin-plate smoothing (mm): lets conflicting surface points settle instead of folding the warp */
const LAMBDA = 8

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const addS = (a: Vec, b: Vec, s: number): Vec => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: Vec): Vec => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
/** `d` made perpendicular to the unit axis `u` */
const perp = (d: Vec, u: Vec) => norm(addS(d, u, -dot(d, u)))

type Probe = { name: string; a: string; b: string; f: number; dirs: [string, Vec][] }

function probes(): Probe[] {
  const out: Probe[] = []
  const ant: Vec = [0, -1, 0], post: Vec = [0, 1, 0], up: Vec = [0, 0, 1]
  for (const [S, sgn] of [['L', 1], ['R', -1]] as const) {
    const lat: Vec = [sgn, 0, 0], med: Vec = [-sgn, 0, 0]
    const four: [string, Vec][] = [['ant', ant], ['post', post], ['lat', lat], ['med', med]]
    const limb = (seg: string, a: string, b: string, fs: number[]) => {
      for (const f of fs) out.push({ name: `${seg}${f}_${S}`, a: `${a}_${S}`, b: `${b}_${S}`, f, dirs: four })
    }
    limb('upperarm', 'upperarm01', 'lowerarm01', [0.35, 0.6, 0.85])
    limb('forearm', 'lowerarm01', 'wrist', [0, 0.3, 0.6, 0.9])
    limb('thigh', 'upperleg01', 'lowerleg01', [0.3, 0.55, 0.8])
    limb('shank', 'lowerleg01', 'foot', [0, 0.25, 0.5, 0.75, 1])
    out.push({ name: `shoulder_${S}`, a: `upperarm01_${S}`, b: `lowerarm01_${S}`, f: 0, dirs: [['ant', ant], ['post', post], ['lat', lat], ['up', up]] })
    out.push({ name: `hip_${S}`, a: `upperleg01_${S}`, b: `lowerleg01_${S}`, f: 0, dirs: [['ant', ant], ['post', post], ['lat', lat]] })
  }
  const diag = (x: number, y: number): Vec => norm([x, y, 0])
  const eight: [string, Vec][] = [
    ['ant', ant], ['post', post], ['l', [1, 0, 0]], ['r', [-1, 0, 0]],
    ['al', diag(1, -1)], ['ar', diag(-1, -1)], ['pl', diag(1, 1)], ['pr', diag(-1, 1)],
  ]
  for (const f of [0.1, 0.3, 0.5, 0.7]) out.push({ name: `trunk${f}`, a: 'pelvis', b: 'neck01', f, dirs: eight })
  out.push({ name: 'trunk0.85', a: 'pelvis', b: 'neck01', f: 0.85, dirs: eight.filter(([n]) => n !== 'l' && n !== 'r') })
  out.push({ name: 'neck', a: 'neck01', b: 'head', f: 0.4, dirs: eight.slice(0, 4) })
  return out
}

function firstHit(bvh: Bvh, o: Vec, d: Vec, maxT: number) {
  const e = 1e-7
  const h = bvh.raycast(o[0], o[1], o[2], d[0] + e, d[1] + e, d[2] + e, 0.5, maxT)
  return h ? h.t : null
}

export function alignFigure(fig: FigureMesh) {
  const posed = fig.pose('anatomical')
  const nv = fig.rest.length / 3
  const bp = bp3dLandmarks()
  const src: Vec[] = [], dst: Vec[] = [], names: string[] = []
  const add = (name: string, a: Vec, b: Vec) => {
    names.push(name)
    src.push(a)
    dst.push(b)
  }
  const mhJ: Record<string, Vec> = {}
  const bpJ: Record<string, Vec> = {}
  for (const j of JOINTS) for (const S of ['L', 'R']) {
    mhJ[`${j}_${S}`] = toBp(posed.joints[`${j}_${S}`])
    bpJ[`${j}_${S}`] = bp[`${j}_${S}`]
    add(`${j}_${S}`, mhJ[`${j}_${S}`], bpJ[`${j}_${S}`])
  }
  for (const j of ['neck01', 'head']) {
    mhJ[j] = toBp(posed.joints[j])
    bpJ[j] = bp[j]
    add(j, mhJ[j], bpJ[j])
  }
  const mid = (a: Vec, b: Vec): Vec => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
  mhJ.pelvis = mid(mhJ.upperleg01_L, mhJ.upperleg01_R)
  bpJ.pelvis = mid(bpJ.upperleg01_L, bpJ.upperleg01_R)

  let top = 0
  for (let i = 0; i < nv; i++) if (posed.positions[i * 3 + 1] > posed.positions[top * 3 + 1]) top = i
  add('vertex', toBp(posed.positions, top * 3), bp.vertex)
  const skin = bpMesh(conceptFiles('skin')[0])
  const P = skin.positions
  for (const [S, sign] of [['L', 1], ['R', -1]] as const) {
    let mh = -1
    for (let i = 0; i < nv; i++) if (posed.positions[i * 3] * sign > 0.03 && (mh < 0 || posed.positions[i * 3 + 1] < posed.positions[mh * 3 + 1])) mh = i
    let b = -1
    for (let i = 0; i < P.length / 3; i++) if (P[i * 3] * sign > 30 && (b < 0 || P[i * 3 + 2] < P[b * 3 + 2])) b = i
    add(`sole_${S}`, toBp(posed.positions, mh * 3), [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]])
  }
  const jointCount = names.length

  // surface landmarks
  const mhPos = new Float32Array(nv * 3)
  for (let i = 0; i < nv; i++) mhPos.set(toBp(posed.positions, i * 3), i * 3)
  const mhBvh = new Bvh(mhPos, fig.indices)
  const bpBvh = new Bvh(P, skin.indices)
  const skipped: string[] = []
  for (const p of probes()) {
    const side = (J: Record<string, Vec>) => {
      const A = J[p.a], B = J[p.b]
      const u = norm(sub(B, A))
      return { o: addS(A, sub(B, A), p.f), u }
    }
    const m = side(mhJ), b = side(bpJ)
    for (const [dn, d] of p.dirs) {
      const dm = perp(d, m.u), db = perp(d, b.u)
      const tm = firstHit(mhBvh, m.o, dm, 250), tb = firstHit(bpBvh, b.o, db, 250)
      const name = `${p.name}.${dn}`
      // a ray that leaves through a neighbouring part on one body only is not a match
      if (tm === null || tb === null || tm > 2 * tb + 15 || tb > 2 * tm + 15) {
        skipped.push(name)
        continue
      }
      add(name, addS(m.o, dm, tm), addS(b.o, db, tb))
    }
  }

  const tps = fitTps(src, dst, LAMBDA)
  const mapped = new Float32Array(nv * 3)
  for (let i = 0; i < nv; i++) mapped.set(tps.map(toBp(posed.positions, i * 3)), i * 3)
  return { posed, mapped, tps, names, src, dst, jointCount, skipped }
}
