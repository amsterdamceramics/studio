import {
  EndType,
  FillRule,
  JoinType,
  PointInPolygonResult,
  area,
  difference,
  inflatePaths,
  intersect,
  pointInPolygon,
  simplifyPaths,
  union,
} from 'clipper2-ts'
import { EM, type Poly, type Pt, type Shape } from './types'

const NZ = FillRule.NonZero
/** Max chord error of the round joins, in engine units. */
const ARC = EM / 500

export const polyArea = (p: Poly) => area(p)

export const uni = (s: Shape): Shape => union(s, NZ)
export const add = (a: Shape, b: Shape): Shape => (b.length ? union(a, b, NZ) : a)
export const sub = (a: Shape, b: Shape): Shape => (a.length && b.length ? difference(a, b, NZ) : a)
export const and = (a: Shape, b: Shape): Shape => (a.length && b.length ? intersect(a, b, NZ) : [])

/** Round offset. Positive grows, negative shrinks. */
export function off(s: Shape, d: number): Shape {
  if (!s.length || Math.abs(d) < 1) return s
  // Every offset adds a vertex per input vertex; thinning to the arc tolerance keeps later passes fast.
  return simplifyPaths(inflatePaths(s, Math.round(d), JoinType.Round, EndType.Polygon, 2, ARC), ARC * 0.5, true)
}

/** Fills concave corners and gaps narrower than 2r. Never removes material. */
export const closing = (s: Shape, r: number): Shape => (r < 1 ? s : off(off(s, r), -r))

/** Rounds convex corners. Removes anything thinner than 2r. */
export const opening = (s: Shape, r: number): Shape => (r < 1 ? s : off(off(s, -r), r))

export function translate(s: Shape, dx: number, dy: number): Shape {
  const out: Shape = new Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const p = s[i]
    const q: Poly = new Array(p.length)
    for (let j = 0; j < p.length; j++) q[j] = { x: p[j].x + dx, y: p[j].y + dy }
    out[i] = q
  }
  return out
}

export const inside = (pt: Pt, poly: Poly) => pointInPolygon(pt, poly) !== PointInPolygonResult.IsOutside

export function bounds(s: Shape) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of s)
    for (const v of p) {
      if (v.x < x0) x0 = v.x
      if (v.x > x1) x1 = v.x
      if (v.y < y0) y0 = v.y
      if (v.y > y1) y1 = v.y
    }
  return { x0, y0, x1, y1 }
}
