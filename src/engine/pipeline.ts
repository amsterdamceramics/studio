import { add, and, bounds, closing, inside, off, opening, polyArea, sub, translate, uni } from './geom'
import { contour, coverage, gaussian } from './field'
import { fitClosed } from './fit'
import { makeNoise } from './noise'
import { resample, taubin } from './smooth'
import { EM, type BezierLoop, type Modulation, type OrganicParams, type OrganicResult, type Piece, type Shape } from './types'

/**
 * How each 0..1 control maps to the recipe. Everything is em-relative, so the same settings
 * give the same letterforms at 24px and at poster size.
 */
export const SCALE = {
  /** Gaussian sigma at softness 1. The studio's Photoshop recipe measures 0.045 em, which is softness 0.5. */
  sigma: 0.09 * EM,
  /** Ink level the contour sits on: 0.5 keeps the weight, lower swells it (Photoshop's threshold slider). */
  levelAt0: 0.5,
  levelAt1: 0.16,
  /** Largest gap that can bridge at merge distance 1. */
  mergeGap: 0.2 * EM,
  /** How much fatter than the minimum a bridge gets at merge strength 1. */
  mergeFill: 1.6,
  /** Contour drift at noise 1. */
  noise: 0.03 * EM,
  /** Noise wavelength, in em. */
  noiseWave: 0.55,
}

const STEP = EM / 110

/** A piece's own fill at a given radius is the same wherever it sits, so repeated letters cost nothing. */
const cache = new Map<string, Shape>()
function own(piece: Piece, r: number): Shape {
  const key = `${piece.id}:${r | 0}`
  let s = cache.get(key)
  if (!s) {
    s = closing(piece.shape, r)
    if (cache.size > 4000) cache.clear()
    cache.set(key, s)
  }
  return translate(s, piece.x, piece.y)
}

/** The polygons of `candidates` (holes included) that overlap `seeds`. */
function touching(candidates: Shape, seeds: Shape): Shape {
  const hits = and(candidates, seeds)
  if (!hits.length) return []
  const kept = candidates.filter((poly) => polyArea(poly) > 0 && hits.some((h) => inside(h[0], poly) || inside(h[h.length >> 1], poly)))
  return kept.length === 0 ? [] : and(candidates, kept)
}

const count = (loops: BezierLoop[]) => loops.reduce((n, l) => n + l.segs.length, 0)

/** Inverse of the standard normal CDF (Acklam's central region), for turning an ink level into an edge shift. */
function probit(p: number) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const q = p - 0.5
  const r = q * q
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

/**
 * The deformation engine. Pure function of (pieces, params, modulation): no state, no randomness
 * beyond the seed, so any frame of any animation can be regenerated exactly.
 *
 *   ink      = pieces, plus bridges where two pieces come within reach, minus protected counters
 *   field    = Gaussian(ink, softness)
 *   contour  = where field crosses the blob level
 *   output   = that contour, relaxed and fitted with cubic Béziers
 */
export function organic(pieces: Piece[], source: BezierLoop[], p: OrganicParams, mod: Modulation = {}): OrganicResult {
  const t0 = performance.now()
  if (!(p.softness > 0 || p.mergeDistance > 0 || p.blob > 0 || p.noise > 0) || !pieces.length) {
    return { loops: source, nodes: count(source), ms: performance.now() - t0, raw: true }
  }

  const sigma = p.softness * SCALE.sigma
  const level = SCALE.levelAt0 + (SCALE.levelAt1 - SCALE.levelAt0) * p.blob
  // How far a straight edge moves outward at this level.
  const swell = -probit(level) * sigma

  let ink = uni(pieces.flatMap((pc) => translate(pc.shape, pc.x, pc.y)))

  // Local merges: what the whole word fills in, minus what each piece fills in alone,
  // is exactly the material that exists because two pieces are near each other.
  const reach = (p.mergeDistance * SCALE.mergeGap) / 2
  if (reach >= 1) {
    const fill = reach * (1 + p.mergeStrength * SCALE.mergeFill)
    let bridges = sub(closing(ink, fill), uni(pieces.flatMap((pc) => own(pc, fill))))
    if (fill > reach + 1 && bridges.length) {
      // Strength fattens bridges but must not create new ones: keep only fills seeded by a real contact.
      bridges = touching(bridges, sub(closing(ink, reach), uni(pieces.flatMap((pc) => own(pc, reach)))))
    }
    ink = add(ink, opening(bridges, EM * 0.006))
  }

  // Counters are opened up beforehand by as much as the swell will take back.
  if (p.counterProtection > 0 && sigma > 0) {
    const holes = ink.filter((poly) => polyArea(poly) < 0).map((poly) => [...poly].reverse())
    if (holes.length) ink = sub(ink, off(holes, p.counterProtection * (Math.max(0, swell) + sigma * 0.35)))
  }

  // Sample finely enough that the grid never shows: at least three cells per sigma.
  const cell = Math.max(EM / 150, Math.min(EM / 70, sigma / 3))
  const crisp = 0.9
  // A travelling swell runs between a resting state and a peak. With rest at 0 the type outside the
  // swell is crisp and the peak is the look as set; the more the type keeps at rest, the further the
  // peak pushes past it, so the swell always reads against its surroundings.
  const rest = Math.min(1, Math.max(0, mod.rest ?? 0))
  const peak = mod.weightAt ? 1 + 0.3 * rest : 1
  const at = (k: number) => ({ sigma: Math.max(crisp, (sigma * k) / cell), level: Math.max(0.08, 0.5 + (level - 0.5) * k) })

  const margin = Math.max(sigma * peak, cell) * 3.5 + Math.max(0, swell) * peak
  const base = coverage(ink, cell, margin, bounds(ink))
  const soft = gaussian(base, at(peak).sigma)

  let field = soft
  let levels: Float32Array | number = at(peak).level
  if (mod.weightAt) {
    const low = at(rest)
    const high = at(peak)
    const calm = gaussian(base, low.sigma)
    const data = new Float32Array(soft.data.length)
    const lv = new Float32Array(soft.data.length)
    for (let y = 0; y < soft.h; y++) {
      for (let x = 0; x < soft.w; x++) {
        const i = y * soft.w + x
        const w = mod.weightAt(soft.x0 + x * cell, soft.y0 + y * cell)
        data[i] = calm.data[i] + (soft.data[i] - calm.data[i]) * w
        lv[i] = low.level + (high.level - low.level) * w
      }
    }
    field = { ...soft, data }
    levels = lv
  }

  const noise = p.noise > 0 ? makeNoise(p.seed) : null
  const amp = p.noise * SCALE.noise
  const freq = 1 / (SCALE.noiseWave * EM)
  // Wobble loops exactly: two slices of the same field cross-fade over one phase.
  const phase = mod.noiseTime ?? 0
  const LOOP = 1.4
  const drift = (x: number, y: number) => (noise ? (1 - phase) * noise(x, y, phase * LOOP) + phase * noise(x, y, (phase - 1) * LOOP) : 0)

  const iterations = Math.round(1 + p.edgeSmoothness * 24)
  const tolerance = EM * (0.0008 + 0.0022 * p.edgeSmoothness)
  const minArea = EM * EM * 0.0002

  const loops: BezierLoop[] = []
  for (const poly of contour(field, levels)) {
    if (Math.abs(polyArea(poly)) < minArea) continue
    let pts = resample(poly, STEP)
    if (noise) {
      pts = pts.map((v) => ({
        x: v.x + amp * drift(v.x * freq, v.y * freq),
        y: v.y + amp * drift(v.x * freq + 37.2, v.y * freq + 11.7),
      }))
    }
    loops.push(fitClosed(taubin(pts, iterations), tolerance))
  }

  return { loops, nodes: count(loops), ms: performance.now() - t0, raw: false }
}

export function loopsBounds(loops: BezierLoop[]) {
  return bounds(loops.map((l) => [l.start, ...l.segs.flatMap((s) => [s.c1, s.c2, s.p])]))
}
