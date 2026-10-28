/**
 * Clay cut: the type's own recipe applied to a photo or a video frame. The picture is blurred, then
 * cut hard at one level into two colours, so the background melts into the ground and the subject is
 * left as soft clay shapes. Detail cuts each spot against its own neighbourhood instead of the whole
 * picture, which keeps a face recognisable while it is still only two colours.
 *
 * The blurs are measured against the picture's long side, so a setting looks the same on a phone
 * clip and on a full-size photo.
 */

export interface ClayCut {
  /** 0..1: how far the picture is blurred before the cut. */
  softness: number
  /** 0.15..0.85: where the cut sits; higher leaves less ink. */
  level: number
  /** 0..1: 0 cuts against the whole picture, 1 against each spot's surroundings. */
  detail: number
  /** Ink goes on the light parts instead of the dark ones. */
  light: boolean
}

export const CLAY_CUT: ClayCut = { softness: 0.5, level: 0.5, detail: 0, light: false }

/** The cut's blur as a share of the picture's long side. */
export const cutBlur = (softness: number) => (0.5 + softness * 14) / 450
/** The neighbourhood Detail compares against. */
export const WIDE_BLUR = 18 / 450
const DETAIL_GAIN = 1.8

export interface CutFields {
  w: number
  h: number
  /** Luminance 0..255 after the cut's blur. */
  cut: Float32Array
  /** Luminance 0..255 after the wide blur. */
  wide: Float32Array
}

type Source = HTMLCanvasElement | HTMLVideoElement

/** Reused scratch canvas: the browser's own blur filter does the heavy lifting. */
let scratch: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null

function blurred(source: Source, sw: number, sh: number, w: number, h: number, px: number): Float32Array {
  if (!scratch) {
    const canvas = document.createElement('canvas')
    scratch = { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true })! }
  }
  const { canvas, ctx } = scratch
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  ctx.filter = px > 0.05 ? `blur(${px}px)` : 'none'
  // Drawn oversize by the blur's reach, so the blur does not pull the picture's edge toward black.
  const m = px * 3
  ctx.drawImage(source, 0, 0, sw, sh, -m, -m, w + m * 2, h + m * 2)
  ctx.filter = 'none'
  const d = ctx.getImageData(0, 0, w, h).data
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) out[i] = d[i * 4] * 0.2126 + d[i * 4 + 1] * 0.7152 + d[i * 4 + 2] * 0.0722
  return out
}

/** The two blurred tone fields the cut works from, at `side` pixels on the long side. */
export function cutFields(source: Source, sw: number, sh: number, side: number, softness: number): CutFields {
  const k = side / Math.max(sw, sh)
  const w = Math.max(8, Math.round(sw * k))
  const h = Math.max(8, Math.round(sh * k))
  const long = Math.max(w, h)
  return { w, h, cut: blurred(source, sw, sh, w, h, cutBlur(softness) * long), wide: blurred(source, sw, sh, w, h, WIDE_BLUR * long) }
}

/** The 3rd and 97th percentile of a tone field: the cut is set between them, so a dull picture still splits. */
export function levelsOf(field: Float32Array): [number, number] {
  const hist = new Uint32Array(256)
  for (let i = 0; i < field.length; i++) hist[Math.min(255, field[i] | 0)]++
  let acc = 0
  let lo = 0
  let hi = 255
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc < field.length * 0.03) lo = v
    if (acc < field.length * 0.97) hi = v
  }
  return [lo, Math.max(lo + 8, hi)]
}

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** The value the cut is made on, about 0..1, 1 where the ink goes. */
export function fieldAt(cut: number, wide: number, levels: [number, number], light: boolean, detail: number) {
  const span = levels[1] - levels[0]
  let f = clamp((cut - levels[0]) / span)
  let w = clamp((wide - levels[0]) / span)
  if (!light) {
    f = 1 - f
    w = 1 - w
  }
  return f + (0.5 + (f - w) * DETAIL_GAIN - f) * detail
}

/**
 * Try the settings on a picture and keep the one that best keeps it recognisable while it still
 * reads as a few soft shapes: the ink follows the picture's overall light and dark and its
 * features, sits mostly on the subject (the middle), splits the picture fairly evenly, and does
 * not break into a mass of outline.
 */
export function autoClayCut(source: Source, sw: number, sh: number): ClayCut {
  const SIDE = 450
  const sharp = cutFields(source, sw, sh, SIDE, 0)
  const { w, h } = sharp
  const levels = levelsOf(sharp.cut)
  // Every other pixel is plenty to score with.
  const n = (w * h) >> 1
  const centre = new Float32Array(n)
  for (let j = 0; j < n; j++) {
    const i = j * 2
    const dx = ((i % w) / w - 0.5) / 0.3
    const dy = (Math.floor(i / w) / h - 0.45) / 0.35
    centre[j] = Math.exp(-(dx * dx + dy * dy))
  }
  let centreSum = 0
  for (let j = 0; j < n; j++) centreSum += centre[j]

  const corr = (a: Float32Array, b: Float32Array) => {
    let sa = 0
    let sb = 0
    let saa = 0
    let sbb = 0
    let sab = 0
    for (let j = 0; j < n; j++) {
      sa += a[j]
      sb += b[j]
      saa += a[j] * a[j]
      sbb += b[j] * b[j]
      sab += a[j] * b[j]
    }
    const va = saa / n - (sa / n) ** 2
    const vb = sbb / n - (sb / n) ** 2
    return (sab / n - (sa / n) * (sb / n)) / Math.sqrt(Math.max(1e-9, va * vb))
  }

  const mask = new Float32Array(n)
  let best: (ClayCut & { score: number }) | null = null
  // Never sharper than a little blur: the brand's shapes are soft and round.
  for (const softness of [0.2, 0.35, 0.5, 0.65]) {
    const f = cutFields(source, sw, sh, SIDE, softness)
    for (const light of [false, true]) {
      // What the ink should follow: the picture's tones, and its features (tones minus their surroundings).
      const ref = new Float32Array(n)
      const feat = new Float32Array(n)
      for (let j = 0; j < n; j++) {
        const i = j * 2
        const r = fieldAt(sharp.cut[i], sharp.wide[i], levels, light, 0)
        ref[j] = r
        feat[j] = r - fieldAt(sharp.wide[i], sharp.wide[i], levels, light, 0)
      }
      for (const detail of [0, 0.35, 0.6, 0.85]) {
        const field = new Float32Array(n)
        for (let j = 0; j < n; j++) field[j] = fieldAt(f.cut[j * 2], f.wide[j * 2], levels, light, detail)
        for (let level = 0.3; level <= 0.701; level += 0.05) {
          let cover = 0
          let middle = 0
          let edges = 0
          for (let j = 0; j < n; j++) {
            mask[j] = field[j] > level ? 1 : 0
            cover += mask[j]
            middle += mask[j] * centre[j]
            if (j > 0 && (j * 2) % w !== 0 && mask[j] !== mask[j - 1]) edges++
          }
          cover /= n
          const subject = middle / centreSum - cover
          const outline = edges / h
          const score =
            corr(mask, ref) * 0.5 + corr(mask, feat) * 1.2 + subject * 0.5 - Math.abs(cover - 0.45) * 0.8 - Math.max(0, outline - 4) * 0.05
          if (!best || score > best.score) best = { score, softness, light, detail, level: Math.round(level * 100) / 100 }
        }
      }
    }
  }
  const { score: _, ...pick } = best!
  return pick
}

