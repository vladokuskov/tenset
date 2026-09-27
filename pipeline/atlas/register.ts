// Registers BodyParts3D 4.0 (CC BY 4.0) onto the MakeHuman body and labels every body texel with the
// superficial muscle under it. Output goes to pipeline/.cache/atlas/ for bake.ts.
// node pipeline/atlas/register.ts [--res 2048]
//
// 1. Pose the shipped body into BodyParts3D's anatomical position (poses.ts `anatomical`, runtime skinning).
// 2. Thin-plate spline from matched landmarks into BodyParts3D millimetres (align.ts): joint centres plus
//    surface points cast from the limb and trunk axes.
// 3. Per texel: follow the surface normal to the BodyParts3D skin, then cast inward along the skin normal;
//    the first muscle or bone hit decides the region, with the 2D map's rules (clips, deep heads, the thin
//    oblique aponeurosis, serratus over oblique). Lats and rectus abdominis come from hand polygons.
import fs from 'node:fs'
import path from 'node:path'
import { conceptFiles, type Side, type Vec } from './bp3d.ts'
import { alignFigure } from './align.ts'
import { buildScene, buildTables, handRegions, lineZ, passesClips, skinScene, vertexNormals } from './anatomy3d.ts'
import { loadFigure } from './figure.ts'
import { ATLAS_CACHE } from './paths.ts'
import { saveTexels, type Texels } from './texels.ts'

const RES = process.argv.includes('--res') ? Number(process.argv[process.argv.indexOf('--res') + 1]) : 2048

function pointInPolygon(x: number, y: number, poly: [number, number][]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const percentile = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y)
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN
}

async function main() {
  const started = Date.now()
  const fig = await loadFigure('a')
  const nv = fig.rest.length / 3

  const { posed, mapped, tps, names, src, dst, jointCount, skipped } = alignFigure(fig)
  const stat = (v: number[]) => ({ n: v.length, medianMm: +percentile(v, 0.5).toFixed(1), maxMm: +Math.max(...v).toFixed(1) })
  const landmarkFit = { joints: stat(tps.residuals.slice(0, jointCount)), surface: stat(tps.residuals.slice(jointCount)), skipped }
  // folds: triangles whose normal flips under the warp
  let flipped = 0
  {
    const A = posed.positions, I0 = fig.indices
    for (let t = 0; t < I0.length; t += 3) {
      const n = [0, 0].map(() => [0, 0, 0])
      for (const [P, o] of [[A, 0], [mapped, 1]] as const) {
        const g = (i: number): Vec => (o ? [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]] : [P[i * 3] * 1000, -P[i * 3 + 2] * 1000, P[i * 3 + 1] * 1000])
        const a = g(I0[t]), b = g(I0[t + 1]), c = g(I0[t + 2])
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
        n[o] = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
      }
      if (n[0][0] * n[1][0] + n[0][1] * n[1][1] + n[0][2] * n[1][2] < 0) flipped++
    }
  }
  console.log('landmark fit:', JSON.stringify(landmarkFit), 'flipped triangles:', flipped)
  // welded normals so UV seams don't split them
  const W = fig.weld
  const wpos = new Float32Array(fig.weldCount * 3)
  for (let i = 0; i < nv; i++) wpos.set(mapped.subarray(i * 3, i * 3 + 3), W[i] * 3)
  const widx = fig.indices.map((i) => W[i])
  const wn = vertexNormals(wpos, widx)
  const normals = new Float32Array(nv * 3)
  for (let i = 0; i < nv; i++) normals.set(wn.subarray(W[i] * 3, W[i] * 3 + 3), i * 3)

  // --- BodyParts3D scene ---
  const tables = buildTables()
  const scene = buildScene(tables)
  const skin = skinScene()
  const tags = scene.tags
  const E = tables.elements
  const labelOf = tables.labelOf
  const skinTriN = (tri: number) => {
    const P = skin.positions, I = skin.indices
    const a = I[tri * 3] * 3, b = I[tri * 3 + 1] * 3, c = I[tri * 3 + 2] * 3
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2]
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz) || 1
    return [nx / l, ny / l, nz / l]
  }

  // skin crossing along the line p + t n closest to p, where the skin faces the same way
  const MAX_SKIN = 70
  const toSkin = (px: number, py: number, pz: number, nx: number, ny: number, nz: number) => {
    const ok = (tri: number) => {
      const f = skinTriN(tri)
      return f[0] * nx + f[1] * ny + f[2] * nz > 0.25
    }
    const fwd = skin.bvh.raycast(px, py, pz, nx, ny, nz, 0, MAX_SKIN, ok)
    const back = skin.bvh.raycast(px, py, pz, -nx, -ny, -nz, 0, fwd ? Math.min(fwd.t, MAX_SKIN) : MAX_SKIN, ok)
    const h = back ?? fwd
    if (!h) return null
    const t = back ? -back.t : fwd!.t
    const I = skin.indices, N = skin.normals
    const w0 = 1 - h.u - h.v
    const sn = [0, 1, 2].map((k) => w0 * N[I[h.tri * 3] * 3 + k] + h.u * N[I[h.tri * 3 + 1] * 3 + k] + h.v * N[I[h.tri * 3 + 2] * 3 + k])
    const l = Math.hypot(sn[0], sn[1], sn[2]) || 1
    return { t, s: [px + nx * t, py + ny * t, pz + nz * t] as Vec, n: [sn[0] / l, sn[1] / l, sn[2] / l] as Vec }
  }

  // skin orientation check: BodyParts3D winding must face outward for the normal test above
  {
    let vol = 0
    const P = skin.positions, I = skin.indices
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3
      vol += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])
    }
    if (vol < 0) throw new Error('BodyParts3D skin winding faces inward; flip skinTriN')
  }

  const bones = new Set([...conceptFiles('bone organ'), ...conceptFiles('cartilage organ')])
  const boneTag = Uint8Array.from(E, (e) => (!e.side && bones.has(e.file) ? 1 : 0))
  const MAX_DEPTH = 80
  type Found = { label: number; segment: number; depth: number; hx: number; hy: number; hz: number; uncovered: boolean }
  const eoLabels = new Set(['l', 'r'].map((s) => labelOf.get(`external_oblique:${s}`)!))
  const inward = (s: Vec, n: Vec): Found => {
    const ox = s[0] + n[0] * 2, oy = s[1] + n[1] * 2, oz = s[2] + n[2] * 2
    const dx = -n[0], dy = -n[1], dz = -n[2]
    let alt = E[0].alts[0]
    const accept = (tri: number, t: number) => {
      const e = E[tags[tri]]
      const hx = ox + dx * t, hz = oz + dz * t
      if (!e.side) {
        alt = e.alts[0]
        return true
      }
      const lat = e.side === 'l' ? hx : -hx
      for (const a of e.alts) {
        if (passesClips(a.clip, lat, hz)) {
          alt = a
          return true
        }
      }
      return false
    }
    const h = scene.bvh.raycast(ox, oy, oz, dx, dy, dz, 0, MAX_DEPTH, accept)
    if (!h) return { label: 0, segment: 0, depth: Infinity, hx: 0, hy: 0, hz: 0, uncovered: true }
    const hit = alt
    const e = E[tags[h.tri]]
    const hx = ox + dx * h.t, hy = oy + dy * h.t, hz = oz + dz * h.t
    const found: Found = { label: hit.label, segment: hit.segment, depth: h.t - 2, hx, hy, hz, uncovered: hit.label === 0 }
    if (eoLabels.has(hit.label)) {
      // serratus wins where it lies under the oblique before the ribs (the meshes overlap instead of interdigitating)
      let over = E[0].alts[0]
      let overBone = false
      const o = scene.bvh.raycast(ox, oy, oz, dx, dy, dz, h.t, h.t + 60, (tri) => {
        const oe = E[tags[tri]]
        overBone = boneTag[tags[tri]] === 1
        if (!overBone && !oe.overrides.includes(hit.label)) return false
        over = oe.alts[0]
        return true
      })
      if (o && !overBone) return { ...found, label: over.label, segment: over.segment }
      if (hit.maxThickness) {
        // thickness seen from the front or back, as in the 2D map: the aponeurosis is the thin front of the sheet, while
        // the muscular flank is thin along its own normal too
        const tag = tags[h.tri]
        const vy = n[1] < 0 ? 1 : -1
        const exit = scene.bvh.raycast(hx, hy - 0.05 * vy, hz, 1e-7, vy, 1e-7, 0.1, 40, (tri) => tags[tri] === tag)
        if (!exit || exit.t < hit.maxThickness) return { ...found, label: 0, segment: 0, uncovered: true }
      }
    }
    void e
    return found
  }

  // --- per-vertex residuals (distance along the normal from the warped body to the BodyParts3D skin) ---
  const resid: Record<string, number[]> = { all: [] }
  for (let i = 0; i < nv; i++) {
    const r = toSkin(mapped[i * 3], mapped[i * 3 + 1], mapped[i * 3 + 2], normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2])
    const z = mapped[i * 3 + 2]
    const band = z > 1450 ? 'head' : z > 1100 ? 'chest' : z > 800 ? 'abdomen-pelvis' : z > 420 ? 'thigh' : 'shank-foot'
    const key = Math.abs(mapped[i * 3]) > 180 && z > 750 ? 'arm' : band
    ;(resid[key] ??= []).push(r ? Math.abs(r.t) : NaN)
    resid.all.push(r ? Math.abs(r.t) : NaN)
  }
  const residual = Object.fromEntries(Object.entries(resid).map(([k, v]) => {
    const ok = v.filter((x) => !Number.isNaN(x))
    return [k, { vertices: v.length, missed: v.length - ok.length, medianMm: +percentile(ok, 0.5).toFixed(1), p90Mm: +percentile(ok, 0.9).toFixed(1) }]
  }))
  console.log('skin residual along normals (mm):', JSON.stringify(residual))

  // --- texel rasterization in UV space ---
  const N = RES
  const T: Texels = {
    res: N,
    tri: new Int32Array(N * N).fill(-1),
    bary: new Float32Array(N * N * 2),
    label: new Uint8Array(N * N),
    segment: new Uint16Array(N * N),
    skin: new Float32Array(N * N * 3).fill(NaN),
    skinN: new Float32Array(N * N * 3),
    rest: new Float32Array(N * N * 3),
    depth: new Float32Array(N * N).fill(Infinity),
  }
  const uv = fig.uv, I = fig.indices
  for (let t = 0; t < I.length / 3; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2]
    const ax = uv[a * 2] * N, ay = uv[a * 2 + 1] * N, bx = uv[b * 2] * N, by = uv[b * 2 + 1] * N, cx = uv[c * 2] * N, cy = uv[c * 2 + 1] * N
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (Math.abs(d) < 1e-12) continue
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx, cx)))
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(N - 1, Math.ceil(Math.max(ay, by, cy)))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5
        const l0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d
        const l1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d
        if (l0 < -1e-9 || l1 < -1e-9 || 1 - l0 - l1 < -1e-9) continue
        const k = y * N + x
        T.tri[k] = t
        T.bary[k * 2] = l0
        T.bary[k * 2 + 1] = l1
      }
    }
  }

  // --- per-texel labelling ---
  const lats = handRegions.latissimus_dorsi, rectus = handRegions.rectus_abdominis
  const serratusLabels = new Set(['l', 'r'].map((sd) => labelOf.get(`serratus_anterior:${sd}`)!))
  const serratus = new Set(['l', 'r'].map((s) => labelOf.get(`serratus_anterior:${s}`)!))
  const latOverride = new Set([...eoLabels])
  const handSeg = new Map<string, number>()
  const handSegment = (key: string, label: number, side: Side) => {
    let s = handSeg.get(key)
    if (s === undefined) {
      tables.segments.push({ key, concept: key, label, side, files: [] })
      s = tables.segments.length
      handSeg.set(key, s)
    }
    return s
  }
  // muscles stop at the joints the body's skinning puts them past: trunk muscles never land on the arms (near the
  // armpit the arm's normals can reach the chest wall), thigh muscles never below the knee (tendons, retinacula)
  const jointRules: [RegExp, Set<number>][] = [
    [/^(upperarm|lowerarm|wrist|metacarpal|finger)/, ['serratus_anterior', 'external_oblique', 'rectus_abdominis', 'erector_spinae', 'trap_upper', 'trap_middle', 'trap_lower', 'latissimus_dorsi']],
    [/^(lowerleg|foot|toe)/, ['rectus_femoris', 'vastus_lateralis', 'vastus_medialis', 'biceps_femoris_long', 'semitendinosus', 'semimembranosus', 'adductor_longus', 'adductor_magnus']],
  ].map(([re, ids]) => [re as RegExp, new Set((ids as string[]).flatMap((id) => ['l', 'r'].map((sd) => labelOf.get(`${id}:${sd}`)!)))])
  let texels = 0, noSkin = 0, jointFixed = 0
  for (let k = 0; k < N * N; k++) {
    const t = T.tri[k]
    if (t < 0) continue
    texels++
    const l0 = T.bary[k * 2], l1 = T.bary[k * 2 + 1], l2 = 1 - l0 - l1
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2]
    const p = [0, 1, 2].map((q) => l0 * mapped[a * 3 + q] + l1 * mapped[b * 3 + q] + l2 * mapped[c * 3 + q])
    const nn = [0, 1, 2].map((q) => l0 * normals[a * 3 + q] + l1 * normals[b * 3 + q] + l2 * normals[c * 3 + q])
    const nl = Math.hypot(nn[0], nn[1], nn[2]) || 1
    for (let q = 0; q < 3; q++) T.rest[k * 3 + q] = (l0 * fig.rest[a * 3 + q] + l1 * fig.rest[b * 3 + q] + l2 * fig.rest[c * 3 + q]) * 1000
    let sk = toSkin(p[0], p[1], p[2], nn[0] / nl, nn[1] / nl, nn[2] / nl)
    if (!sk) {
      // no matching BodyParts3D skin along the normal (inner thighs, where its legs touch): label from the warped point
      noSkin++
      sk = { t: 0, s: p as Vec, n: [nn[0] / nl, nn[1] / nl, nn[2] / nl] as Vec }
    }
    T.skin.set(sk.s, k * 3)
    T.skinN.set(sk.n, k * 3)
    const f = inward(sk.s, sk.n)
    let label = f.label, segment = f.segment
    T.depth[k] = f.depth
    const side: Side = sk.s[0] >= 0 ? 'l' : 'r'
    const lat = side === 'l' ? sk.s[0] : -sk.s[0]
    const z = sk.s[2], ny = sk.n[1]
    // the 2D map's rule, seen from the front: serratus wins over the oblique (or bare skin) wherever it lies
    // behind it before the ribs, looking straight back
    if ((label === 0 || eoLabels.has(label)) && ny < -0.15 && z > 1000 && z < 1300) {
      let hitS = -1
      const o = scene.bvh.raycast(sk.s[0], sk.s[1] - 2, sk.s[2], 1e-7, 1, 1e-7, 0, 70, (tri) => {
        const tag = tags[tri]
        if (boneTag[tag]) return true
        const e = E[tag]
        if (e.side && serratusLabels.has(e.alts[0].label)) {
          hitS = tag
          return true
        }
        return false
      })
      if (o && hitS >= 0 && E[hitS].side === side) {
        label = E[hitS].alts[0].label
        segment = E[hitS].alts[0].segment
      }
    }
    // rectus abdominis: front-facing uncovered skin inside the polygon; tendinous intersections split its bellies
    if ((label === 0 || eoLabels.has(label)) && ny < -0.3 && pointInPolygon(lat, z, rectus.polygon)) {
      label = labelOf.get(`rectus_abdominis:${side}`)!
      const lines = (rectus.gaps ?? []).map((g) => lineZ(g.line, lat))
      const belly = lines.filter((lz) => z < lz).length
      segment = handSegment(`rectus_abdominis:${side}:${belly}`, label, side)
    }
    // latissimus dorsi: back- and side-facing skin inside the polygon, over uncovered skin, the posterior oblique
    // slips and (facing backwards) the serratus it hides
    const latPoly = lats.polygon
    if (ny > -0.3 && pointInPolygon(Math.min(lat, 170), z, latPoly) &&
      (label === 0 || latOverride.has(label) || (serratus.has(label) && ny > -0.1))) {
      label = labelOf.get(`latissimus_dorsi:${side}`)!
      segment = handSegment(`latissimus_dorsi:${side}`, label, side)
    }
    const vMax = l0 >= l1 && l0 >= l2 ? a : l1 >= l2 ? b : c
    if (jointRules.some(([re, ids]) => ids.has(label) && re.test(fig.bone[vMax]))) {
      label = 0
      segment = 0
      jointFixed++
    }
    T.label[k] = label
    T.segment[k] = segment
  }

  fs.mkdirSync(ATLAS_CACHE, { recursive: true })
  saveTexels(ATLAS_CACHE, T)
  const meta = {
    res: N,
    texels,
    noSkin,
    regions: tables.regions,
    segments: tables.segments,
    landmarks: names.map((n, i) => ({ name: n, figure: src[i].map((v) => +v.toFixed(1)), bp3d: dst[i].map((v) => +v.toFixed(1)), tpsResidualMm: +tps.residuals[i].toFixed(2) })),
    residual,
    landmarkFit,
    flippedTriangles: flipped,
    seconds: (Date.now() - started) / 1000,
  }
  fs.writeFileSync(path.join(ATLAS_CACHE, 'register.json'), JSON.stringify(meta, null, 1))
  console.log(`register: ${texels} texels (${noSkin} labelled from the warped surface, ${jointFixed} labels removed past a joint), ${meta.seconds.toFixed(1)} s`)
}

await main()
