import type { OrganicParams } from './engine'

export interface Preset {
  id: string
  label: string
  params: Omit<OrganicParams, 'seed'>
}

export const PRESETS: Preset[] = [
  {
    // Fitted to the studio's Photoshop recipe: Gaussian 9 px + field blur 10 px + threshold 190 on 270 px type.
    id: 'brand',
    label: 'Brand',
    params: { softness: 0.5, blob: 0.25, mergeDistance: 0, mergeStrength: 0, noise: 0, counterProtection: 0, edgeSmoothness: 0.3 },
  },
  {
    id: 'soft',
    label: 'Soft',
    params: { softness: 0.3, blob: 0.12, mergeDistance: 0, mergeStrength: 0, noise: 0, counterProtection: 0, edgeSmoothness: 0.3 },
  },
  {
    id: 'heavy',
    label: 'Heavy',
    params: { softness: 0.62, blob: 0.5, mergeDistance: 0, mergeStrength: 0, noise: 0, counterProtection: 0.6, edgeSmoothness: 0.3 },
  },
  {
    id: 'fused',
    label: 'Fused',
    params: { softness: 0.55, blob: 0.3, mergeDistance: 0.5, mergeStrength: 0.5, noise: 0, counterProtection: 0.5, edgeSmoothness: 0.4 },
  },
  {
    id: 'original',
    label: 'Original',
    params: { softness: 0, blob: 0, mergeDistance: 0, mergeStrength: 0, noise: 0, counterProtection: 0, edgeSmoothness: 0 },
  },
]

export const COLORS = [
  { id: 'black', label: 'Black', hex: '#000000' },
  { id: 'white', label: 'White', hex: '#FFFFFF' },
  { id: 'clay', label: 'Clay', hex: '#B4A48A' },
  { id: 'acid', label: 'Acid', hex: '#C7FF00' },
  { id: 'violet', label: 'Violet', hex: '#968FC1' },
]

/** Gradient-map ramps. Violet and Clay are sampled from the studio's featured-artist posts. */
export const RAMPS = [
  { id: 'violet', label: 'Violet', shadow: '#968FC1', highlight: '#FBFAFC' },
  { id: 'clay', label: 'Clay', shadow: '#AC9979', highlight: '#FFFCF5' },
  { id: 'acid', label: 'Acid', shadow: '#1B1F00', highlight: '#C7FF00' },
  { id: 'mono', label: 'Mono', shadow: '#000000', highlight: '#FFFFFF' },
]
