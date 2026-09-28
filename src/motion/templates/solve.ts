// Small solvers shared by the bodyweight and press templates.

/**
 * Root of f by secant steps from two starting points (smooth, near-linear problems with a good guess: balance
 * offsets, body heights). Returns the last iterate; callers that set state inside f should evaluate it last.
 */
export function secant(f: (x: number) => number, x0: number, x1: number, tol = 1e-7, iters = 20): number {
  let a = x0, b = x1, fa = f(a), fb = f(b)
  for (let k = 0; k < iters && Math.abs(fb) > tol && fb !== fa; k++) {
    const c = b - (fb * (b - a)) / (fb - fa)
    ;[a, fa] = [b, fb]
    b = c
    fb = f(b)
  }
  return b
}

/** piecewise-cubic Hermite through (xs, ys), Fritsch-Carlson tangents: smooth and without overshoot */
export function monotoneCubic(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length
  const d = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]))
  const m = xs.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i])))
  return (x) => {
    const k = Math.min(n - 2, Math.max(0, Math.floor(((x - xs[0]) / (xs[n - 1] - xs[0])) * (n - 1))))
    const h = xs[k + 1] - xs[k], t = (x - xs[k]) / h
    const t2 = t * t, t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1]
  }
}

/** natural cubic spline through (xs, ys), xs ascending: C2, so a scheduled channel has no acceleration steps */
export function naturalCubic(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length
  const h = xs.slice(1).map((x, i) => x - xs[i])
  const m = new Array<number>(n).fill(0)
  const c = new Array<number>(n).fill(0)
  const d = new Array<number>(n).fill(0)
  for (let i = 1; i < n - 1; i++) {
    const a = h[i - 1], b = 2 * (h[i - 1] + h[i])
    const r = 6 * ((ys[i + 1] - ys[i]) / h[i] - (ys[i] - ys[i - 1]) / h[i - 1])
    const den = b - a * c[i - 1]
    c[i] = h[i] / den
    d[i] = (r - a * d[i - 1]) / den
  }
  for (let i = n - 2; i > 0; i--) m[i] = d[i] - c[i] * m[i + 1]
  return (x) => {
    let k = 0
    for (let lo = 0, hi = n - 1; hi - lo > 1; ) {
      const mid = (lo + hi) >> 1
      if (xs[mid] <= x) lo = mid
      else hi = mid
      k = lo
    }
    const t = x - xs[k], hk = h[k]
    const b = (ys[k + 1] - ys[k]) / hk - (hk * (2 * m[k] + m[k + 1])) / 6
    return ys[k] + b * t + (m[k] / 2) * t * t + ((m[k + 1] - m[k]) / (6 * hk)) * t * t * t
  }
}
