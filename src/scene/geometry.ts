import { SphereGeometry, PlaneGeometry, RingGeometry, TorusGeometry, BufferGeometry } from 'three'

const spheres = new Map<number, SphereGeometry>()
export function sphereGeo(segments: number): SphereGeometry {
  let g = spheres.get(segments)
  if (!g) {
    g = new SphereGeometry(1, segments, Math.max(12, Math.round(segments * 0.66)))
    spheres.set(segments, g)
  }
  return g
}

let quad: PlaneGeometry | null = null
/** unit quad (−0.5…0.5) used with billboard shaders */
export function quadGeo(): PlaneGeometry {
  return (quad ??= new PlaneGeometry(1, 1))
}

const rings = new Map<string, RingGeometry>()
/** flat ring in the XY plane; inner/outer expressed as fractions of the radius */
export function ringGeo(inner: number, outer: number, segments = 128): RingGeometry {
  const key = `${inner}:${outer}:${segments}`
  let g = rings.get(key)
  if (!g) {
    g = new RingGeometry(inner, outer, segments, 1)
    rings.set(key, g)
  }
  return g
}

const tori = new Map<string, TorusGeometry>()
export function torusGeo(radius: number, tube: number, radial = 8, tubular = 48): TorusGeometry {
  const key = `${radius}:${tube}:${radial}:${tubular}`
  let g = tori.get(key)
  if (!g) {
    g = new TorusGeometry(radius, tube, radial, tubular)
    tori.set(key, g)
  }
  return g
}

export type Geo = BufferGeometry
