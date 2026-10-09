import type { Poly, Shape } from './types'

/**
 * A scalar field over engine space: ink coverage 0..1 sampled at cell centres.
 * This is the mathematical form of the studio's Photoshop recipe (blur, then threshold):
 * the Gaussian is computed on exact area coverage and the threshold becomes an iso-contour
 * located by interpolation, so the result is a smooth curve rather than a pixel trace.
 */
export interface Field {
  data: Float32Array
  w: number
  h: number
  /** Engine-space position of the centre of cell (0, 0). */
  x0: number
  y0: number
  cell: number
}

/** Exact area coverage of a shape (outers and holes with opposite winding), by signed-area accumulation. */
export function coverage(shape: Shape, cell: number, margin: number, box: { x0: number; y0: number; x1: number; y1: number }): Field {
  const ox = box.x0 - margin
  const oy = box.y0 - margin
  const w = Math.ceil((box.x1 - box.x0 + margin * 2) / cell) + 2
  const h = Math.ceil((box.y1 - box.y0 + margin * 2) / cell) + 2
  const a = new Float32Array(w * h + 4)

  for (const poly of shape) {
    const n = poly.length
    for (let k = 0; k < n; k++) {
      let ax = (poly[k].x - ox) / cell
      let ay = (poly[k].y - oy) / cell
      let bx = (poly[(k + 1) % n].x - ox) / cell
      let by = (poly[(k + 1) % n].y - oy) / cell
      if (ay === by) continue
      let dir = 1
      if (ay > by) {
        dir = -1
        const tx = ax
        const ty = ay
        ax = bx
        ay = by
        bx = tx
        by = ty
      }
      const dxdy = (bx - ax) / (by - ay)
      let x = ax
      const yEnd = Math.min(h, Math.ceil(by))
      for (let y = Math.max(0, Math.floor(ay)); y < yEnd; y++) {
        const row = y * w
        const dy = Math.min(y + 1, by) - Math.max(y, ay)
        const xn = x + dxdy * dy
        const d = dy * dir
        const xa = x < xn ? x : xn
        const xb = x < xn ? xn : x
        const xaf = Math.floor(xa)
        const xbc = Math.ceil(xb)
        if (xbc <= xaf + 1) {
          const xm = 0.5 * (x + xn) - xaf
          a[row + xaf] += d - d * xm
          a[row + xaf + 1] += d * xm
        } else {
          const s = 1 / (xb - xa)
          const f0 = xa - xaf
          const a0 = 0.5 * s * (1 - f0) * (1 - f0)
          const f1 = xb - xbc + 1
          const am = 0.5 * s * f1 * f1
          a[row + xaf] += d * a0
          if (xbc === xaf + 2) {
            a[row + xaf + 1] += d * (1 - a0 - am)
          } else {
            const a1 = s * (1.5 - f0)
            a[row + xaf + 1] += d * (a1 - a0)
            for (let xi = xaf + 2; xi < xbc - 1; xi++) a[row + xi] += d * s
            const a2 = a1 + (xbc - xaf - 3) * s
            a[row + xbc - 1] += d * (1 - a2 - am)
          }
          a[row + xbc] += d * am
        }
        x = xn
      }
    }
  }

  const data = new Float32Array(w * h)
  let acc = 0
  for (let i = 0; i < w * h; i++) {
    acc += a[i]
    const v = Math.abs(acc)
    data[i] = v > 1 ? 1 : v
  }
  return { data, w, h, x0: ox + cell / 2, y0: oy + cell / 2, cell }
}

/** Separable Gaussian, sigma in cells. Returns a new field. */
export function gaussian(f: Field, sigma: number): Field {
  const r = Math.max(1, Math.ceil(sigma * 3))
  const k = new Float32Array(r * 2 + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) {
    k[i + r] = Math.exp((-i * i) / (2 * sigma * sigma))
    sum += k[i + r]
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum
  const { w, h } = f
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let v = 0
      const lo = Math.max(0, x - r)
      const hi = Math.min(w - 1, x + r)
      for (let i = lo; i <= hi; i++) v += f.data[row + i] * k[i - x + r]
      tmp[row + x] = v
    }
  }
  for (let y = 0; y < h; y++) {
    const lo = Math.max(0, y - r)
    const hi = Math.min(h - 1, y + r)
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let j = lo; j <= hi; j++) v += tmp[j * w + x] * k[j - y + r]
      out[y * w + x] = v
    }
  }
  return { ...f, data: out }
}

/**
 * Iso-contour of the field at zero crossing of (value - level), as closed polygons in engine space.
 * Loops come out consistently oriented (holes opposite to outers), so a non-zero fill is correct.
 */
export function contour(f: Field, level: Float32Array | number): Poly[] {
  const { w, h, data } = f
  const lv = typeof level === 'number' ? null : level
  const v = (i: number) => data[i] - (lv ? lv[i] : (level as number))
  // A crossing lives on a grid edge: horizontal edges first, then vertical ones.
  const H = (x: number, y: number) => y * w + x
  const V = (x: number, y: number) => w * h + y * w + x
  const next = new Map<number, number>()

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x
      const tl = v(i) >= 0
      const tr = v(i + 1) >= 0
      const br = v(i + w + 1) >= 0
      const bl = v(i + w) >= 0
      const n = (tl ? 1 : 0) + (tr ? 1 : 0) + (br ? 1 : 0) + (bl ? 1 : 0)
      if (n === 0 || n === 4) continue
      const T = H(x, y)
      const R = V(x + 1, y)
      const B = H(x, y + 1)
      const L = V(x, y)
      // Walking the cell clockwise, an edge is an exit where it leaves the ink and an entry where it returns.
      if (n === 2 && tl === br) {
        const centre = (v(i) + v(i + 1) + v(i + w) + v(i + w + 1)) / 4 >= 0
        if (tl) {
          if (centre) {
            next.set(T, R)
            next.set(B, L)
          } else {
            next.set(T, L)
            next.set(B, R)
          }
        } else if (centre) {
          next.set(R, T)
          next.set(L, B)
        } else {
          next.set(R, B)
          next.set(L, T)
        }
        continue
      }
      const out = tl && !tr ? T : tr && !br ? R : br && !bl ? B : L
      const inn = !tl && tr ? T : !tr && br ? R : !br && bl ? B : L
      next.set(out, inn)
    }
  }

  const point = (e: number) => {
    const vertical = e >= w * h
    const id = vertical ? e - w * h : e
    const x = id % w
    const y = (id - x) / w
    const a = v(id)
    const b = v(vertical ? id + w : id + 1)
    const t = a === b ? 0.5 : a / (a - b)
    return {
      x: f.x0 + (x + (vertical ? 0 : t)) * f.cell,
      y: f.y0 + (y + (vertical ? t : 0)) * f.cell,
    }
  }

  const loops: Poly[] = []
  for (const start of next.keys()) {
    if (!next.has(start)) continue
    const loop: Poly = []
    let e: number | undefined = start
    while (e !== undefined && next.has(e)) {
      loop.push(point(e))
      const n: number = next.get(e)!
      next.delete(e)
      e = n
    }
    if (loop.length > 5) loops.push(loop)
  }
  return loops
}
