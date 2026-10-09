import { EM, type Modulation, type OrganicParams } from './types'

export type Motion = 'off' | 'wave' | 'morph' | 'breathe' | 'wobble' | 'settle'

export const MOTIONS: { id: Motion; label: string; hint: string; seconds: number }[] = [
  { id: 'off', label: 'Still', hint: 'No motion', seconds: 1 },
  { id: 'wave', label: 'Wave', hint: 'A swell of clay travels through the word', seconds: 5 },
  { id: 'morph', label: 'Morph', hint: 'Original type to organic and back', seconds: 5 },
  { id: 'breathe', label: 'Breathe', hint: 'The mass slowly swells and relaxes', seconds: 4 },
  { id: 'wobble', label: 'Wobble', hint: 'The surface drifts, the letters stay put', seconds: 6 },
  { id: 'settle', label: 'Settle', hint: 'Crisp type softens, overshoots, rests, then lets go', seconds: 5 },
]

export interface FrameState {
  params: OrganicParams
  /** `box` is the text block in engine space. */
  mod: (box: { x: number; w: number }) => Modulation
}

const TAU = Math.PI * 2
const ease = (t: number) => t * t * (3 - 2 * t)
const scaleAll = (p: OrganicParams, k: number): OrganicParams => ({
  ...p,
  // Never quite zero: the crisp end of a motion goes through the same pipeline as every other frame,
  // so there is no pop where the loop meets the untouched font outlines.
  softness: Math.max(p.softness * k, 0.03),
  mergeDistance: p.mergeDistance * k,
  blob: p.blob * k,
  noise: p.noise * k,
})

/** Where the travelling swell sits at a phase, and how wide it is. Shared so a photo's frame can ride the same wave as the type. */
export function waveAt(box: { x: number; w: number }, phase: number) {
  const sigma = Math.max(0.6 * EM, box.w * 0.16)
  // Start and end far enough outside the word that both ends of the loop are the same crisp type.
  const run = box.w + sigma * 5.2
  return { cx: box.x - sigma * 2.6 + phase * run, sigma }
}

/**
 * Every motion is a pure function of loop phase (0..1): it only moves the same parameters the
 * sliders move. Topology changes (letters fusing, counters closing) need no special handling
 * because each frame is generated from scratch.
 */
/** What each motion's resting slider means, and where it starts. */
export const REST: Record<Motion, { start: number; hint: string }> = {
  off: { start: 0, hint: '' },
  wave: { start: 0.5, hint: 'How soft the type stays outside the swell' },
  morph: { start: 0, hint: 'How soft the type stays at its crispest point' },
  breathe: { start: 0.5, hint: 'How much of the look is left at the bottom of the breath' },
  wobble: { start: 1, hint: 'How much the surface keeps drifting at its calmest' },
  settle: { start: 0, hint: 'How soft the type is before it lands' },
}

export function frameAt(motion: Motion, phase: number, base: OrganicParams, rest = 0): FrameState {
  const still: FrameState = { params: base, mod: () => ({}) }
  // Rest is how much of the look the type keeps at the quietest point of a motion. The more it
  // keeps, the further the peak pushes past the look, so there is always something to see move.
  const between = (k: number) => rest + (1 + 0.3 * rest - rest) * k
  switch (motion) {
    case 'wave': {
      // The swell enters from the left, crosses, and leaves; letters outside it stay crisp.
      return {
        params: base,
        mod: (box) => {
          const { cx, sigma } = waveAt(box, phase)
          return {
            rest,
            weightAt: (x) => {
              const d = (x - cx) / sigma
              return Math.exp(-d * d)
            },
          }
        },
      }
    }
    case 'morph':
      return { ...still, params: scaleAll(base, between(ease(0.5 - 0.5 * Math.cos(phase * TAU)))) }
    case 'breathe': {
      // A breath is a small swing, so rest sets where the exhale sits rather than emptying the look.
      const low = 0.6 + 0.4 * rest
      return { ...still, params: scaleAll(base, low + 0.45 * (0.5 + 0.5 * Math.sin(phase * TAU))) }
    }
    case 'wobble': {
      // Rest is how much drift is left at the calmest point of the loop; at 1 the surface never stops.
      const drift = rest + (1 - rest) * (0.5 - 0.5 * Math.cos(phase * TAU))
      return { params: { ...base, noise: Math.max(base.noise, 0.45) * drift }, mod: () => ({ noiseTime: phase }) }
    }
    case 'settle': {
      // Damped overshoot: lands heavy, rebounds, rests, then lets go so the loop closes on crisp type.
      const t = Math.min(1, phase / 0.55)
      const land = t <= 0 ? 0 : 1 - Math.exp(-5.5 * t) * Math.cos(9 * t)
      const k = land * (1 - ease(Math.min(1, Math.max(0, (phase - 0.78) / 0.22))))
      return { ...still, params: scaleAll(base, between(Math.min(1.3, Math.max(0, k)))) }
    }
    default:
      return still
  }
}
