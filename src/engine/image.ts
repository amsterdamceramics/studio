/** Photo treatment for the board behind the type. Browser-only: everything here works on canvases. */

export interface GradientMap {
  enabled: boolean
  /** Colour the darkest tones become. */
  shadow: string
  /** Colour the lightest tones become. */
  highlight: string
  /** -1..1. Positive pulls tones apart around the midpoint. */
  contrast: number
  /** -1..1. Positive lifts the midtones toward the highlight colour. */
  brightness: number
}

export interface Placement {
  /** 1 fills the board exactly; larger crops in. */
  zoom: number
  /** -1..1 across the slack left by the crop. */
  x: number
  y: number
}

const MAX_SIDE = 2400

/** Decode a file to a canvas, capped so every later pass stays quick. */
export async function loadPhoto(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * k)
  canvas.height = Math.round(bitmap.height * k)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas
}

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Photoshop's Gradient Map: each pixel's luminosity picks a colour on the ramp from shadow to
 * highlight. Done through a 256-entry table, so it is exact and costs one lookup per pixel.
 */
export function gradientMap(source: HTMLCanvasElement, g: GradientMap): HTMLCanvasElement {
  if (!g.enabled) return source
  const out = document.createElement('canvas')
  out.width = source.width
  out.height = source.height
  const ctx = out.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source, 0, 0)
  const img = ctx.getImageData(0, 0, out.width, out.height)
  const d = img.data

  const lo = rgb(g.shadow)
  const hi = rgb(g.highlight)
  const gamma = Math.pow(2, -g.brightness * 1.5)
  const gain = g.contrast >= 0 ? 1 + g.contrast * 2 : 1 + g.contrast * 0.9
  const table = new Uint8ClampedArray(256 * 3)
  for (let i = 0; i < 256; i++) {
    let t = Math.pow(i / 255, gamma)
    t = Math.min(1, Math.max(0, (t - 0.5) * gain + 0.5))
    for (let c = 0; c < 3; c++) table[i * 3 + c] = lo[c] + (hi[c] - lo[c]) * t
  }
  for (let i = 0; i < d.length; i += 4) {
    const l = ((d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8) * 3
    d[i] = table[l]
    d[i + 1] = table[l + 1]
    d[i + 2] = table[l + 2]
  }
  ctx.putImageData(img, 0, 0)
  return out
}

export interface BackdropOptions {
  /** Shape the photo is cropped to, as path data in board pixels. Outside it the ground shows. */
  clip?: string
  /** Leave the ground out, for the picture that vector exports embed under their own ground. */
  bare?: boolean
}

/** Paints the photo so that it covers a canvas of the given size. */
export type PhotoPainter = (ctx: CanvasRenderingContext2D, width: number, height: number) => void

/** A painter for a photo canvas, cropped to cover. Used when the effects renderer is not available. */
export const coverPainter =
  (photo: HTMLCanvasElement, place: Placement): PhotoPainter =>
  (ctx, width, height) => {
    const s = Math.max(width / photo.width, height / photo.height) * place.zoom
    const w = photo.width * s
    const h = photo.height * s
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(photo, (width - w) / 2 - (place.x * (w - width)) / 2, (height - h) / 2 - (place.y * (h - height)) / 2, w, h)
  }

/** The board without its type: ground colour, then the photo. `boardWidth` is the board in its own pixels. */
export function composeBackdrop(width: number, height: number, boardWidth: number, ground: string, paint: PhotoPainter | null, options: BackdropOptions = {}): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')!
  if (!options.bare) {
    ctx.fillStyle = ground
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  if (paint) {
    if (options.clip) {
      const k = canvas.width / boardWidth
      ctx.save()
      ctx.scale(k, k)
      ctx.clip(new Path2D(options.clip))
      ctx.setTransform(1, 0, 0, 1, 0, 0)
    }
    paint(ctx, canvas.width, canvas.height)
    if (options.clip) ctx.restore()
  }
  return canvas
}

export const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encode failed'))), type, quality))
