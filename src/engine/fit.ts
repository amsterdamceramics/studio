import type { BezierLoop, Cubic, Poly, Pt } from './types'

/**
 * Least-squares cubic Bézier fitting (Schneider, Graphics Gems 1990), adapted for closed
 * loops: tangents are shared across every split and across the seam, so the result is
 * G1-continuous all the way round and uses as few segments as the tolerance allows.
 */

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y })
const mul = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s })
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y
const norm = (a: Pt): Pt => {
  const l = Math.hypot(a.x, a.y) || 1
  return { x: a.x / l, y: a.y / l }
}

type Bez = [Pt, Pt, Pt, Pt]

function bez(b: Bez, t: number): Pt {
  const m = 1 - t
  const a = m * m * m
  const c = 3 * m * m * t
  const d = 3 * m * t * t
  const e = t * t * t
  return {
    x: a * b[0].x + c * b[1].x + d * b[2].x + e * b[3].x,
    y: a * b[0].y + c * b[1].y + d * b[2].y + e * b[3].y,
  }
}

function chordParams(pts: Poly, first: number, last: number): number[] {
  const u = [0]
  for (let i = first + 1; i <= last; i++) {
    u.push(u[i - first - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  }
  const total = u[u.length - 1] || 1
  for (let i = 0; i < u.length; i++) u[i] /= total
  return u
}

function generate(pts: Poly, first: number, last: number, u: number[], t1: Pt, t2: Pt): Bez {
  const p0 = pts[first]
  const p3 = pts[last]
  let c00 = 0
  let c01 = 0
  let c11 = 0
  let x0 = 0
  let x1 = 0
  for (let i = 0; i <= last - first; i++) {
    const t = u[i]
    const m = 1 - t
    const b0 = m * m * m
    const b1 = 3 * m * m * t
    const b2 = 3 * m * t * t
    const b3 = t * t * t
    const a1 = mul(t1, b1)
    const a2 = mul(t2, b2)
    c00 += dot(a1, a1)
    c01 += dot(a1, a2)
    c11 += dot(a2, a2)
    const tmp = sub(pts[first + i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)))
    x0 += dot(a1, tmp)
    x1 += dot(a2, tmp)
  }
  const det = c00 * c11 - c01 * c01
  let al = 0
  let ar = 0
  if (Math.abs(det) > 1e-9) {
    al = (x0 * c11 - x1 * c01) / det
    ar = (c00 * x1 - c01 * x0) / det
  }
  const seg = Math.hypot(p3.x - p0.x, p3.y - p0.y)
  const eps = 1e-6 * seg
  if (al < eps || ar < eps || al > seg * 4 || ar > seg * 4) {
    al = ar = seg / 3
  }
  return [p0, add(p0, mul(t1, al)), add(p3, mul(t2, ar)), p3]
}

function maxError(pts: Poly, first: number, last: number, b: Bez, u: number[]) {
  let max = 0
  let split = (first + last) >> 1
  for (let i = first + 1; i < last; i++) {
    const p = bez(b, u[i - first])
    const d = (p.x - pts[i].x) ** 2 + (p.y - pts[i].y) ** 2
    if (d >= max) {
      max = d
      split = i
    }
  }
  return { max, split }
}

function reparam(pts: Poly, first: number, u: number[], b: Bez): number[] {
  const d1: Pt[] = [mul(sub(b[1], b[0]), 3), mul(sub(b[2], b[1]), 3), mul(sub(b[3], b[2]), 3)]
  const d2: Pt[] = [mul(sub(d1[1], d1[0]), 2), mul(sub(d1[2], d1[1]), 2)]
  const out: number[] = new Array(u.length)
  for (let i = 0; i < u.length; i++) {
    const t = u[i]
    const m = 1 - t
    const q = bez(b, t)
    const q1 = add(add(mul(d1[0], m * m), mul(d1[1], 2 * m * t)), mul(d1[2], t * t))
    const q2 = add(mul(d2[0], m), mul(d2[1], t))
    const diff = sub(q, pts[first + i])
    const den = dot(q1, q1) + dot(diff, q2)
    out[i] = Math.abs(den) < 1e-12 ? t : Math.min(1, Math.max(0, t - dot(diff, q1) / den))
  }
  return out
}

function fit(pts: Poly, first: number, last: number, t1: Pt, t2: Pt, err: number, out: Cubic[], depth: number) {
  if (last - first === 1) {
    const p0 = pts[first]
    const p3 = pts[last]
    const d = Math.hypot(p3.x - p0.x, p3.y - p0.y) / 3
    out.push({ c1: add(p0, mul(t1, d)), c2: add(p3, mul(t2, d)), p: p3 })
    return
  }
  let u = chordParams(pts, first, last)
  let b = generate(pts, first, last, u, t1, t2)
  let e = maxError(pts, first, last, b, u)
  if (e.max < err) {
    out.push({ c1: b[1], c2: b[2], p: b[3] })
    return
  }
  if (e.max < err * 16 && depth < 40) {
    for (let i = 0; i < 4; i++) {
      u = reparam(pts, first, u, b)
      b = generate(pts, first, last, u, t1, t2)
      e = maxError(pts, first, last, b, u)
      if (e.max < err) {
        out.push({ c1: b[1], c2: b[2], p: b[3] })
        return
      }
    }
  }
  const s = e.split
  const tc = norm(sub(pts[s - 1], pts[s + 1]))
  fit(pts, first, s, t1, tc, err, out, depth + 1)
  fit(pts, s, last, mul(tc, -1), t2, err, out, depth + 1)
}

/** Fit a closed, smooth polyline. `tolerance` is the max deviation in the polyline's own units. */
export function fitClosed(loop: Poly, tolerance: number): BezierLoop {
  const n = loop.length
  // Seam at the topmost point: a natural extremum, so the first node lands where a type designer would put it.
  let s = 0
  for (let i = 1; i < n; i++) if (loop[i].y < loop[s].y) s = i
  const pts: Poly = new Array(n + 1)
  for (let i = 0; i <= n; i++) pts[i] = loop[(s + i) % n]
  const t = norm(sub(pts[1], pts[n - 1]))
  const segs: Cubic[] = []
  // Fit two halves so a single curve is never asked to span the whole loop.
  const mid = n >> 1
  const tm = norm(sub(pts[mid - 1], pts[mid + 1]))
  const err = tolerance * tolerance
  fit(pts, 0, mid, t, tm, err, segs, 0)
  fit(pts, mid, n, mul(tm, -1), mul(t, -1), err, segs, 0)
  return { start: pts[0], segs }
}
