/** Engine space: integers, y down, one em = EM units. Output size is applied only when serialising. */
export const EM = 4096

export interface Pt {
  x: number
  y: number
}
export type Poly = Pt[]
/** Closed polygons; outers are positive area, holes negative (Clipper convention). */
export type Shape = Poly[]

/** One cubic segment: p0 is the previous segment's p3. */
export interface Cubic {
  c1: Pt
  c2: Pt
  p: Pt
}
export interface BezierLoop {
  start: Pt
  segs: Cubic[]
}

/**
 * A piece is anything the engine can soften and merge with its neighbours:
 * a glyph today, an icon, frame or poster shape later.
 */
export interface Piece {
  /** Cache identity of the local shape (same id = same geometry). */
  id: string
  /** Local geometry, origin at the piece anchor (glyph origin on the baseline). */
  shape: Shape
  /** Anchor position in engine space. */
  x: number
  y: number
}

/** All organic controls are 0..1; the engine maps them to em-relative distances. */
export interface OrganicParams {
  softness: number
  mergeDistance: number
  mergeStrength: number
  blob: number
  noise: number
  counterProtection: number
  edgeSmoothness: number
  seed: number
}

/** Per-frame modulation, the hook animation uses. */
export interface Modulation {
  /** 0..1 over engine space: how much of the softness and blob applies at a point. Drives travelling waves. */
  weightAt?: (x: number, y: number) => number
  /** With `weightAt`: how much of the effect the type keeps where the weight is 0. 0 is crisp type, 1 is the full look. */
  rest?: number
  /** Loop phase 0..1 for the noise field; 0 and 1 give the same surface. */
  noiseTime?: number
}

export interface OrganicResult {
  loops: BezierLoop[]
  nodes: number
  ms: number
  /** True when every control is zero and the source outlines were passed through untouched. */
  raw: boolean
}

export const ZERO_PARAMS: OrganicParams = {
  softness: 0,
  mergeDistance: 0,
  mergeStrength: 0,
  blob: 0,
  noise: 0,
  counterProtection: 0,
  edgeSmoothness: 0,
  seed: 1,
}
