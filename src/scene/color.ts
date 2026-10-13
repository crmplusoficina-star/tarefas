import { Color } from 'three'

const c = new Color()
const hsl = { h: 0, s: 0, l: 0 }

/** Darken (<1) or lighten (>1) a hex colour while preserving hue. */
export function shade(hex: string, factor: number): string {
  c.set(hex).getHSL(hsl)
  const l = Math.min(0.95, Math.max(0.03, hsl.l * factor))
  return `#${c.setHSL(hsl.h, hsl.s, l).getHexString()}`
}

export function mix(a: string, b: string, t: number): string {
  const ca = new Color(a)
  return `#${ca.lerp(new Color(b), t).getHexString()}`
}
