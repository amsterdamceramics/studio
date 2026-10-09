import { frameAt, waveAt, type Motion } from './animate'
import { organic } from './pipeline'
import type { Frame } from './svg'
import { EM, ZERO_PARAMS, type BezierLoop, type Piece, type Poly } from './types'

export interface BlobShape {
  /** Picks the arrangement of lobes; the same seed always gives the same shape. */
  seed: number
  /** 1 fills the room inside the margin; larger runs off the board. */
  size: number
}

/** The type's motion, handed to the frame so both move as one material. */
export interface FrameMotion {
  motion: Motion
  phase: number
  rest: number
}

/** Small deterministic generator (mulberry32). */
function random(seed: number) {
  let a = (seed * 2654435761) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function ellipse(cx: number, cy: number, rx: number, ry: number): Poly {
  const pts: Poly = []
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * Math.PI * 2
    pts.push({ x: Math.round(cx + Math.cos(a) * rx), y: Math.round(cy + Math.sin(a) * ry) })
  }
  return pts
}

/**
 * A clay frame for a photo, made by the same engine as the type: a handful of overlapping
 * lobes go through the blur-and-threshold pipeline, which fuses them and fills the necks
 * between them exactly as it does between letters.
 *
 * The lobes are laid out in a space where the frame is about two em across, the scale of a single
 * fat letter, so the same softness that fuses letters visibly fuses and releases the lobes when
 * the frame is in motion; the result is then scaled onto the board. `margin` and the returned loops are in engine units of `frame`.
 * `move` makes the frame follow a type motion.
 */
export function clayFrame(frame: Frame, margin: number, shape: BlobShape, move?: FrameMotion): BezierLoop[] {
  const rx = Math.max(1, (frame.w / 2 - margin) * shape.size)
  const ry = Math.max(1, (frame.h / 2 - margin) * shape.size)
  const k = Math.max(rx, ry) / EM
  const ax = rx / k
  const ay = ry / k

  // The frame goes through the very same motion functions as the type, and its lobes ride them too:
  // they swell as the wave passes, pull apart and fuse with a morph, pulse with a breath, and wander
  // with a wobble. The blur then fills and releases the necks between them, which is what makes the
  // movement read as one soft material rather than as shapes sliding about.
  const look = { ...ZERO_PARAMS, softness: 1, blob: 0.2, edgeSmoothness: 0.8, seed: shape.seed }
  const motion = move?.motion ?? 'off'
  const phase = move?.phase ?? 0
  const fr = frameAt(motion, phase, look, move?.rest ?? 0)
  const box = { x: -ax, w: ax * 2 }
  const turn = phase * Math.PI * 2
  // How fused the frame is: 1 is the resting clay, 0 is the lobes standing apart.
  const fused = motion === 'morph' || motion === 'settle' ? fr.params.blob / look.blob : 1
  const breath = motion === 'breathe' ? Math.sin(turn) : 0
  const wave = motion === 'wave' ? waveAt(box, phase) : null

  const rnd = random(shape.seed)
  const lobes = 4 + Math.floor(rnd() * 2)
  const spin = rnd() * Math.PI * 2
  const core = 0.5 * (0.7 + 0.3 * fused) * (1 + 0.06 * breath)
  // Lobe centres sit on a ring and their radii reach the edge of the room, so the frame fills it
  // whatever the seed; a central lobe guarantees there is never a hole in the middle.
  const pieces: Piece[] = [{ id: 'clay-core', shape: [ellipse(0, 0, ax * core, ay * core)], x: 0, y: 0 }]
  for (let i = 0; i < lobes; i++) {
    let a = spin + ((i + (rnd() - 0.5) * 0.5) / lobes) * Math.PI * 2
    // Lobes stand well apart, so at rest the frame has real necks for the motion to fill and release.
    let reach = 0.44 + rnd() * 0.12
    let r = 1 - reach - 0.02
    const sx = rnd() < 0.5 ? 0.82 + rnd() * 0.18 : 1
    const sy = rnd() < 0.5 ? 0.82 + rnd() * 0.18 : 1
    const offset = rnd() * Math.PI * 2
    if (motion === 'wobble') {
      // Whole turns of phase only, so the wander closes exactly.
      a += 0.22 * Math.sin(turn + offset)
      reach += 0.06 * Math.sin(turn * 2 + offset * 1.7)
    }
    r *= (0.72 + 0.28 * fused) * (1 + 0.1 * breath)
    reach += 0.1 * (1 - fused)
    if (wave) {
      const d = (Math.cos(a) * ax * reach - wave.cx) / wave.sigma
      const lift = Math.exp(-d * d)
      r *= 1 + 0.3 * lift
      reach += 0.05 * lift
    }
    pieces.push({ id: `clay-${i}`, shape: [ellipse(Math.cos(a) * ax * reach, Math.sin(a) * ay * reach, ax * r * sx, ay * r * sy)], x: 0, y: 0 })
  }

  const res = organic(pieces, [], fr.params, fr.mod(box))
  const cx = frame.x + frame.w / 2
  const cy = frame.y + frame.h / 2
  const map = (p: { x: number; y: number }) => ({ x: cx + p.x * k, y: cy + p.y * k })
  return res.loops.map((l) => ({ start: map(l.start), segs: l.segs.map((s) => ({ c1: map(s.c1), c2: map(s.c2), p: map(s.p) })) }))
}
