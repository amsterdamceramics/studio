import type { BezierLoop } from './types'

export interface Frame {
  /** Engine-space box to map onto the output. */
  x: number
  y: number
  w: number
  h: number
  /** Output pixels per engine unit. */
  scale: number
}

const f = (n: number) => {
  const s = n.toFixed(2)
  return s.indexOf('.') < 0 ? s : s.replace(/\.?0+$/, '')
}

/** One compound path, absolute cubics only: the form every vector tool reads without surprises. */
export function pathData(loops: BezierLoop[], frame: Frame): string {
  const X = (v: number) => f((v - frame.x) * frame.scale)
  const Y = (v: number) => f((v - frame.y) * frame.scale)
  let d = ''
  for (const l of loops) {
    d += `M${X(l.start.x)} ${Y(l.start.y)}`
    for (const s of l.segs) d += `C${X(s.c1.x)} ${Y(s.c1.y)} ${X(s.c2.x)} ${Y(s.c2.y)} ${X(s.p.x)} ${Y(s.p.y)}`
    d += 'Z'
  }
  return d
}

/** Where the type is allowed to show: inside these outlines, or everywhere except inside them. */
export interface TypeClip {
  loops: BezierLoop[]
  inverse: boolean
}

/** Path data for a type clip, to be filled with the even-odd rule. An inverse clip is the board with the outlines cut out. */
export function clipData(clip: TypeClip, frame: Frame): string {
  const board = clip.inverse ? `M0 0H${f(frame.w * frame.scale)}V${f(frame.h * frame.scale)}H0Z` : ''
  return board + pathData(clip.loops, frame)
}

/** A shape filled with a flat colour, used in place of a photo. */
export interface FlatShape {
  loops: BezierLoop[]
  fill: string
}

export interface SvgImage {
  /** A full-board picture (the treated photo) placed under the type. */
  href: string
  /** Shape the picture is cropped to, in engine space. */
  clip?: BezierLoop[]
}

/** `fill` null leaves the type out, for when the type is only the photo's crop. */
export function svgDocument(loops: BezierLoop[], frame: Frame, fill: string | null, background: string | null, image?: SvgImage, typeClip?: TypeClip, flat?: FlatShape): string {
  const w = f(frame.w * frame.scale)
  const h = f(frame.h * frame.scale)
  let body = ''
  // An unclipped photo covers the board, so the ground under it would never show.
  if (background && !(image && !image.clip)) body += `\n  <rect width="${w}" height="${h}" fill="${background}"/>`
  if (image) {
    const clip = image.clip ? `\n  <clipPath id="crop"><path d="${pathData(image.clip, frame)}"/></clipPath>` : ''
    body += `${clip}\n  <image width="${w}" height="${h}" preserveAspectRatio="none"${image.clip ? ' clip-path="url(#crop)"' : ''} href="${image.href}"/>`
  }
  if (flat) body += `\n  <path fill="${flat.fill}" d="${pathData(flat.loops, frame)}"/>`
  if (fill && typeClip) body += `\n  <clipPath id="hide"><path clip-rule="evenodd" d="${clipData(typeClip, frame)}"/></clipPath>`
  if (fill) body += `\n  <path fill="${fill}"${typeClip ? ' clip-path="url(#hide)"' : ''} d="${pathData(loops, frame)}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}
</svg>
`
}
