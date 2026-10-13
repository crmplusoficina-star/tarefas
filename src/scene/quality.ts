import type { EffectsLevel } from '../domain/types'
import type { Quality } from '../state/uiStore'

export interface QualityProfile {
  tier: Quality
  maxDpr: number
  antialias: boolean
  sphereSegments: number
  starScale: number
  nebula: 0 | 3 | 5
  /** extra atmosphere / cloud shells */
  atmosphereLayers: boolean
  shaderOctaves: number
  detailedSatellites: boolean
  dust: boolean
  glow: number
}

export const PROFILES: Record<Quality, QualityProfile> = {
  low: {
    tier: 'low',
    maxDpr: 1,
    antialias: false,
    sphereSegments: 28,
    starScale: 0.35,
    nebula: 0,
    atmosphereLayers: false,
    shaderOctaves: 3,
    detailedSatellites: false,
    dust: false,
    glow: 0.7,
  },
  medium: {
    tier: 'medium',
    maxDpr: 1.35,
    antialias: true,
    sphereSegments: 48,
    starScale: 0.7,
    nebula: 3,
    atmosphereLayers: true,
    shaderOctaves: 4,
    detailedSatellites: true,
    dust: false,
    glow: 0.9,
  },
  high: {
    tier: 'high',
    maxDpr: 2,
    antialias: true,
    sphereSegments: 80,
    starScale: 1,
    nebula: 5,
    atmosphereLayers: true,
    shaderOctaves: 5,
    detailedSatellites: true,
    dust: true,
    glow: 1,
  },
}

export function resolveQuality(effects: EffectsLevel, auto: Quality): Quality {
  switch (effects) {
    case 'minimal':
      return 'low'
    case 'balanced':
      return 'medium'
    case 'cinematic':
      return 'high'
    default:
      return auto
  }
}

/** Best-effort first guess before real frame timings are available. */
export function guessInitialQuality(): Quality {
  if (typeof navigator === 'undefined') return 'medium'
  const cores = navigator.hardwareConcurrency ?? 4
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  if (coarse || cores <= 2 || mem <= 2) return 'low'
  if (cores <= 4 || mem <= 4) return 'medium'
  return 'high'
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}
