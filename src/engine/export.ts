import { clipData, pathData, svgDocument, type FlatShape, type Frame, type SvgImage, type TypeClip } from './svg'
import type { BezierLoop } from './types'

export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export const svgBlob = (loops: BezierLoop[], frame: Frame, fill: string | null, bg: string | null, image?: SvgImage, typeClip?: TypeClip, flat?: FlatShape) =>
  new Blob([svgDocument(loops, frame, fill, bg, image, typeClip, flat)], { type: 'image/svg+xml' })

/** `backdrop` is the board without its type (ground plus photo); when given it replaces the flat ground. `fill` null leaves the type out. */
export function drawToCanvas(
  ctx: CanvasRenderingContext2D,
  loops: BezierLoop[],
  frame: Frame,
  fill: string | null,
  bg: string | null,
  backdrop?: HTMLCanvasElement | null,
  typeClip?: TypeClip | null,
) {
  const w = frame.w * frame.scale
  const h = frame.h * frame.scale
  if (backdrop) {
    ctx.drawImage(backdrop, 0, 0, w, h)
  } else if (bg) {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)
  } else {
    ctx.clearRect(0, 0, w, h)
  }
  if (!fill) return
  ctx.save()
  if (typeClip) ctx.clip(new Path2D(clipData(typeClip, frame)), 'evenodd')
  ctx.fillStyle = fill
  ctx.fill(new Path2D(pathData(loops, frame)))
  ctx.restore()
}

export function pngBlob(
  loops: BezierLoop[],
  frame: Frame,
  fill: string | null,
  bg: string | null,
  density = 2,
  backdrop?: HTMLCanvasElement | null,
  typeClip?: TypeClip | null,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(frame.w * frame.scale * density)
  canvas.height = Math.ceil(frame.h * frame.scale * density)
  const ctx = canvas.getContext('2d')!
  ctx.scale(density, density)
  drawToCanvas(ctx, loops, frame, fill, bg, backdrop, typeClip)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'))
}

const rgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255).toFixed(3)).join(' ')
}

export interface PdfImage {
  /** JPEG file bytes; PDF stores them as they are. */
  jpeg: Uint8Array
  width: number
  height: number
  /** Shape the picture is cropped to, in engine space. */
  clip?: BezierLoop[]
}

/**
 * A one-page PDF written by hand: the type is the same cubics as the SVG, as native path operators.
 * A photo, when there is one, goes in as a full-page JPEG underneath; the type stays vector on top.
 */
export function pdfBlob(loops: BezierLoop[], frame: Frame, fill: string | null, bg: string | null, image?: PdfImage, typeClip?: TypeClip, flat?: FlatShape): Blob {
  const w = frame.w * frame.scale
  const h = frame.h * frame.scale
  const n = (v: number) => v.toFixed(2)
  const X = (v: number) => n((v - frame.x) * frame.scale)
  const Y = (v: number) => n(h - (v - frame.y) * frame.scale)
  const path = (ls: BezierLoop[]) => {
    let p = ''
    for (const l of ls) {
      p += `${X(l.start.x)} ${Y(l.start.y)} m\n`
      for (const s of l.segs) p += `${X(s.c1.x)} ${Y(s.c1.y)} ${X(s.c2.x)} ${Y(s.c2.y)} ${X(s.p.x)} ${Y(s.p.y)} c\n`
      p += 'h\n'
    }
    return p
  }
  let c = ''
  if (bg && !(image && !image.clip)) c += `${rgb(bg)} rg\n0 0 ${n(w)} ${n(h)} re\nf\n`
  if (image) c += `q\n${image.clip ? `${path(image.clip)}W n\n` : ''}${n(w)} 0 0 ${n(h)} 0 0 cm\n/Im0 Do\nQ\n`
  if (flat) c += `${rgb(flat.fill)} rg\n${path(flat.loops)}f\n`
  if (fill && typeClip) {
    // Even-odd clip: for an inverse clip the board rectangle goes in first, so the outlines become holes.
    const board = typeClip.inverse ? `0 0 ${n(w)} ${n(h)} re\n` : ''
    c += `q\n${board}${path(typeClip.loops)}W* n\n${rgb(fill)} rg\n${path(loops)}f\nQ\n`
  } else if (fill) {
    c += `${rgb(fill)} rg\n${path(loops)}f\n`
  }

  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  let length = 0
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data
    parts.push(bytes)
    length += bytes.length
  }
  const offsets: number[] = []
  const object = (body: (string | Uint8Array)[]) => {
    offsets.push(length)
    push(`${offsets.length} 0 obj\n`)
    body.forEach(push)
    push('\nendobj\n')
  }

  push('%PDF-1.4\n')
  object(['<< /Type /Catalog /Pages 2 0 R >>'])
  object(['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'])
  object([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(w)} ${n(h)}] /Contents 4 0 R /Resources << ${image ? '/XObject << /Im0 5 0 R >> ' : ''}>> >>`])
  object([`<< /Length ${enc.encode(c).length} >>\nstream\n${c}endstream`])
  if (image) {
    object([
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.jpeg.length} >>\nstream\n`,
      image.jpeg,
      '\nendstream',
    ])
  }
  const xref = length
  push(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`)
  for (const o of offsets) push(`${String(o).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(parts as BlobPart[], { type: 'application/pdf' })
}
