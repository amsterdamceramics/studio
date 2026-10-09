import type { Poly, Pt } from './types'

/** Re-space a closed polygon to uniform arc length so smoothing acts evenly along the contour. */
export function resample(poly: Poly, step: number): Poly {
  const n = poly.length
  let total = 0
  const seg = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    seg[i] = Math.hypot(b.x - a.x, b.y - a.y)
    total += seg[i]
  }
  const count = Math.max(12, Math.round(total / step))
  const h = total / count
  const out: Poly = new Array(count)
  let i = 0
  let acc = 0
  for (let k = 0; k < count; k++) {
    const d = k * h
    while (i < n - 1 && acc + seg[i] < d) {
      acc += seg[i]
      i++
    }
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const t = seg[i] > 0 ? (d - acc) / seg[i] : 0
    out[k] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  }
  return out
}

/**
 * Taubin smoothing: a Laplacian pass followed by an inverse pass, so the contour relaxes
 * like curvature flow (clay settling) without the shrinkage a plain Laplacian causes.
 */
export function taubin(pts: Poly, iterations: number, lambda = 0.5, mu = -0.52): Poly {
  const n = pts.length
  let x = new Float64Array(n)
  let y = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    x[i] = pts[i].x
    y[i] = pts[i].y
  }
  let tx = new Float64Array(n)
  let ty = new Float64Array(n)
  const pass = (f: number) => {
    for (let i = 0; i < n; i++) {
      const a = i === 0 ? n - 1 : i - 1
      const b = i === n - 1 ? 0 : i + 1
      tx[i] = x[i] + f * ((x[a] + x[b]) * 0.5 - x[i])
      ty[i] = y[i] + f * ((y[a] + y[b]) * 0.5 - y[i])
    }
    const sx = x
    const sy = y
    x = tx
    y = ty
    tx = sx
    ty = sy
  }
  for (let k = 0; k < iterations; k++) {
    pass(lambda)
    pass(mu)
  }
  const out: Pt[] = new Array(n)
  for (let i = 0; i < n; i++) out[i] = { x: x[i], y: y[i] }
  return out
}
