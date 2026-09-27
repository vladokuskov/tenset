// 3D thin-plate spline (biharmonic kernel U(r) = r) with optional smoothing.
import type { Vec } from './bp3d.ts'

function solve(A: number[][], B: number[][]) {
  const n = A.length
  const M = A.map((row, i) => [...row, ...B[i]])
  const m = B[0].length
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    ;[M[c], M[piv]] = [M[piv], M[c]]
    const d = M[c][c]
    if (Math.abs(d) < 1e-12) throw new Error('tps: singular system')
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / d
      if (!f) continue
      for (let k = c; k < n + m; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row.slice(n).map((v) => v / M[i][i]))
}

export type Tps = { map(p: Vec): Vec; residuals: number[] }

/**
 * Warp taking `src[i]` to `dst[i]`, relaxed by `lambda` (units of r). U = r is minus the 3D biharmonic Green's
 * function, so a positive `lambda` slightly exaggerates each landmark's pull instead of smoothing it (the atlas is
 * calibrated with that), and a pair of landmarks about `lambda` apart makes the system singular.
 */
export function fitTps(src: Vec[], dst: Vec[], lambda = 0): Tps {
  const n = src.length
  const A: number[][] = []
  for (let i = 0; i < n + 4; i++) A.push(new Array(n + 4).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      A[i][j] = Math.hypot(src[i][0] - src[j][0], src[i][1] - src[j][1], src[i][2] - src[j][2]) + (i === j ? lambda : 0)
    }
    const P = [1, ...src[i]]
    for (let k = 0; k < 4; k++) {
      A[i][n + k] = P[k]
      A[n + k][i] = P[k]
    }
  }
  const B = [...dst.map((d) => [...d]), [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]
  const X = solve(A, B)
  const map = (p: Vec): Vec => {
    const out: Vec = [0, 0, 0]
    for (let k = 0; k < 3; k++) out[k] = X[n][k] + X[n + 1][k] * p[0] + X[n + 2][k] * p[1] + X[n + 3][k] * p[2]
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(p[0] - src[i][0], p[1] - src[i][1], p[2] - src[i][2])
      for (let k = 0; k < 3; k++) out[k] += X[i][k] * r
    }
    return out
  }
  const residuals = src.map((s, i) => {
    const m = map(s)
    return Math.hypot(m[0] - dst[i][0], m[1] - dst[i][1], m[2] - dst[i][2])
  })
  return { map, residuals }
}
