import { contour, type Field } from './field'
import { fitClosed } from './fit'
import { resample, taubin } from './smooth'
import type { Frame } from './svg'
import type { BezierLoop } from './types'

/**
 * Clay windows: where the photo shows on a board that is otherwise flat ground.
 *
 * A smooth field drifts across the board and is cut at a level, which is how the type gets its
 * outline too, so the shape splits, merges and wanders as one soft material. The result is a set
 * of vector outlines per frame, used as a clip for the photo and (inverted) for the type, so the
 * moving shape hides the type as it passes and every export keeps it as clean vectors.
 */

export type WindowStyle = 'roam' | 'open' | 'cover' | 'islands'

export const WINDOW_STYLES: { id: WindowStyle; label: string; hint: string }[] = [
  { id: 'roam', label: 'Roaming window', hint: 'The photo shows through one opening that wanders over the board, changing shape as it goes' },
  { id: 'open', label: 'Opening and closing', hint: 'An opening grows from the middle to show the photo, breaks up at its edge, and closes again' },
  { id: 'cover', label: 'Drifting cover', hint: 'The photo fills the board and flat patches of the ground colour drift across it' },
  { id: 'islands', label: 'Islands', hint: 'Several small openings, each showing a different part of the photo' },
]

export interface WindowShape {
  style: WindowStyle
  /** 0..1: how much of the photo shows. 0.5 is the designed amount. */
  size: number
  /** Picks which drifting pattern is used. */
  seed: number
}

const TAU = Math.PI * 2

function makeNoise(seed: number) {
  const lattice = (x: number, y: number) => {
    const v = Math.sin(x * 127.1 + y * 311.7 + seed * 53.3) * 43758.5453
    return v - Math.floor(v)
  }
  return (x: number, y: number) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const fx = x - xi
    const fy = y - yi
    const u = fx * fx * (3 - 2 * fx)
    const v = fy * fy * (3 - 2 * fy)
    return (lattice(xi, yi) * (1 - u) + lattice(xi + 1, yi) * u) * (1 - v) + (lattice(xi, yi + 1) * (1 - u) + lattice(xi + 1, yi + 1) * u) * v
  }
}

/** The region of the board where the photo shows, at a loop phase, as outlines in the frame's engine space. */
export function clayWindow(frame: Frame, shape: WindowShape, phase: number): BezierLoop[] {
  // The field is smooth, so a coarse grid is enough: the outline is found between samples.
  const cell = frame.w / 96
  const pad = 2
  const gw = Math.ceil(frame.w / cell) + 1 + pad * 2
  const gh = Math.ceil(frame.h / cell) + 1 + pad * 2
  const data = new Float32Array(gw * gh)
  const noise = makeNoise(shape.seed)
  const a = phase * TAU
  // Everything drifts along closed paths, so phase 0 and 1 are the same frame.
  const ca = 0.9 * Math.cos(a)
  const sa = 0.9 * Math.sin(a)
  const drift = (u: number, v: number, scale: number) =>
    noise(u * scale + ca, v * scale + sa) * 0.62 + noise(u * scale * 2.1 + 7 - 0.78 * sa, v * scale * 2.1 + 3 + 0.78 * ca) * 0.38

  const H = frame.h / frame.w
  const bias = (shape.size - 0.5) * 0.5
  const swell = 0.5 - 0.5 * Math.cos(a)
  const cx = 0.5 + 0.26 * Math.cos(a)
  const cy = H * (0.45 + 0.24 * Math.sin(a * 2))

  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const k = gy * gw + gx
      // A rim outside the board is forced empty so every outline closes; the board clips it off anyway.
      if (gx === 0 || gy === 0 || gx === gw - 1 || gy === gh - 1) {
        data[k] = -1
        continue
      }
      // Board coordinates in units of its width.
      const u = ((gx - pad) * cell) / frame.w
      const v = ((gy - pad) * cell) / frame.w
      let f: number
      if (shape.style === 'roam') {
        const near = 1 - Math.hypot(u - cx, v - cy) / 0.62
        f = near * 0.75 + (drift(u, v, 3.2) - 0.5) * 0.9 - 0.42
      } else if (shape.style === 'open') {
        const near = 1 - Math.hypot(u - 0.5, (v - H * 0.48) * 0.85) / 0.8
        f = near + (drift(u, v, 3.6) - 0.5) * 0.7 - (0.95 - 0.6 * swell)
      } else if (shape.style === 'cover') {
        f = 0.52 - drift(u, v, 4.2)
      } else {
        f = drift(u, v, 5.5) - 0.6
      }
      data[k] = f + bias
    }
  }

  const field: Field = { data, w: gw, h: gh, x0: frame.x - pad * cell, y0: frame.y - pad * cell, cell }
  const step = frame.w / 220
  const loops: BezierLoop[] = []
  for (const poly of contour(field, 0)) {
    if (poly.length < 8) continue
    loops.push(fitClosed(taubin(resample(poly, step), 3), frame.w * 0.0012))
  }
  return loops
}
