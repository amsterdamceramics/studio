import opentype from 'opentype.js'
import { uni } from './geom'
import { makeKerner } from './kern'
import { EM, type BezierLoop, type Cubic, type Piece, type Poly, type Pt, type Shape } from './types'

export type Align = 'left' | 'center' | 'right'
export type TextCase = 'none' | 'upper' | 'lower'

/**
 * Clay type: tracking measured from the studio's Photoshop artwork, so letters sit close enough to
 * fuse. Leading is fixed at 95% so descenders and ascenders on neighbouring lines do not touch.
 */
export const BRAND_TYPE = { tracking: -0.06, lineHeight: 0.95 }

/** Plain type follows the Figma setting: -2% tracking. Its leading is the user's, 80% to 120%. */
export const PLAIN_TYPE = { tracking: -0.02, lineHeight: 0.8 }

export interface TextOptions {
  text: string
  align: Align
  textCase: TextCase
  /** Letter spacing in em. */
  tracking: number
  /** Line pitch in em. */
  lineHeight: number
}

export interface Layout {
  pieces: Piece[]
  /** Untouched source outlines, positioned, for the raw pass-through and the ghost overlay. */
  source: BezierLoop[]
  /** Artboard box in engine units. */
  box: { x: number; y: number; w: number; h: number }
}

interface GlyphGeom {
  shape: Shape
  loops: BezierLoop[]
}

const FLAT_TOL = EM / 1000

function flattenInto(out: Poly, p0: Pt, c1: Pt, c2: Pt, p3: Pt) {
  const dev = Math.max(
    Math.hypot(c1.x - (2 * p0.x + p3.x) / 3, c1.y - (2 * p0.y + p3.y) / 3),
    Math.hypot(c2.x - (p0.x + 2 * p3.x) / 3, c2.y - (p0.y + 2 * p3.y) / 3),
  )
  const n = Math.min(48, Math.max(1, Math.ceil(Math.sqrt((3 * dev) / (4 * FLAT_TOL)))))
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const m = 1 - t
    out.push({
      x: m * m * m * p0.x + 3 * m * m * t * c1.x + 3 * m * t * t * c2.x + t * t * t * p3.x,
      y: m * m * m * p0.y + 3 * m * m * t * c1.y + 3 * m * t * t * c2.y + t * t * t * p3.y,
    })
  }
}

export class TypeSetter {
  private cache = new Map<number, GlyphGeom>()
  readonly font: opentype.Font
  private kern: (left: number, right: number) => number

  constructor(buffer: ArrayBuffer) {
    this.font = opentype.parse(buffer)
    this.kern = makeKerner(buffer)
  }

  private geom(glyph: opentype.Glyph): GlyphGeom {
    const hit = this.cache.get(glyph.index)
    if (hit) return hit
    const cmds = glyph.getPath(0, 0, EM).commands
    const polys: Shape = []
    const loops: BezierLoop[] = []
    let cur: Poly = []
    let segs: Cubic[] = []
    let start: Pt = { x: 0, y: 0 }
    let p: Pt = start
    const close = () => {
      if (cur.length > 2) {
        polys.push(cur.map((v) => ({ x: Math.round(v.x), y: Math.round(v.y) })))
        if (p.x !== start.x || p.y !== start.y) segs.push({ c1: p, c2: start, p: start })
        loops.push({ start, segs })
      }
      cur = []
      segs = []
    }
    for (const c of cmds) {
      if (c.type === 'M') {
        close()
        start = p = { x: c.x, y: c.y }
        cur.push(p)
      } else if (c.type === 'L') {
        const q = { x: c.x, y: c.y }
        segs.push({ c1: p, c2: q, p: q })
        cur.push(q)
        p = q
      } else if (c.type === 'Q') {
        const q = { x: c.x, y: c.y }
        const c1 = { x: p.x + (2 / 3) * (c.x1 - p.x), y: p.y + (2 / 3) * (c.y1 - p.y) }
        const c2 = { x: q.x + (2 / 3) * (c.x1 - q.x), y: q.y + (2 / 3) * (c.y1 - q.y) }
        flattenInto(cur, p, c1, c2, q)
        segs.push({ c1, c2, p: q })
        p = q
      } else if (c.type === 'C') {
        const q = { x: c.x, y: c.y }
        const c1 = { x: c.x1, y: c.y1 }
        const c2 = { x: c.x2, y: c.y2 }
        flattenInto(cur, p, c1, c2, q)
        segs.push({ c1, c2, p: q })
        p = q
      } else if (c.type === 'Z') {
        close()
      }
    }
    close()
    const g = { shape: uni(polys), loops }
    this.cache.set(glyph.index, g)
    return g
  }

  layout(o: TextOptions): Layout {
    const font = this.font
    const k = EM / font.unitsPerEm
    const asc = font.ascender * k
    const desc = -font.descender * k
    const pitch = Math.round(o.lineHeight * EM)
    const track = o.tracking * EM
    const cased = o.textCase === 'upper' ? o.text.toUpperCase() : o.textCase === 'lower' ? o.text.toLowerCase() : o.text
    const lines = cased.split('\n')

    const rows = lines.map((line) => {
      // Per-character lookup: opentype.js cannot run this font's contextual substitutions, and the brand sets no ligatures.
      const glyphs = Array.from(line).map((ch) => font.charToGlyph(ch))
      const xs: number[] = []
      let x = 0
      for (let i = 0; i < glyphs.length; i++) {
        xs.push(x)
        x += (glyphs[i].advanceWidth ?? 0) * k + track
        if (i < glyphs.length - 1) x += this.kern(glyphs[i].index, glyphs[i + 1].index) * k
      }
      return { glyphs, xs, width: glyphs.length ? x - track : 0 }
    })
    const width = Math.max(1, ...rows.map((r) => r.width))

    const pieces: Piece[] = []
    const source: BezierLoop[] = []
    rows.forEach((row, li) => {
      const ox = o.align === 'left' ? 0 : o.align === 'center' ? (width - row.width) / 2 : width - row.width
      const y = li * pitch
      row.glyphs.forEach((glyph, gi) => {
        const g = this.geom(glyph)
        if (!g.shape.length) return
        const x = Math.round(ox + row.xs[gi])
        pieces.push({ id: `g${glyph.index}`, shape: g.shape, x, y })
        const mv = (v: Pt) => ({ x: v.x + x, y: v.y + y })
        for (const l of g.loops)
          source.push({ start: mv(l.start), segs: l.segs.map((s) => ({ c1: mv(s.c1), c2: mv(s.c2), p: mv(s.p) })) })
      })
    })

    return {
      pieces,
      source,
      box: { x: 0, y: -asc, w: width, h: asc + desc + (rows.length - 1) * pitch },
    }
  }
}
