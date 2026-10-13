import { Vector3 } from 'three'

/** Wheel notch → multiplicative zoom factor (>1 zooms out). Handles line/page delta modes. */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1
  return Math.exp(Math.max(-240, Math.min(240, deltaY * unit)) * 0.0011)
}

/**
 * Point where a ray meets the horizontal plane `y = planeY`, or null when the ray is
 * (nearly) parallel to it, points away from it, or hits beyond `maxDist`.
 */
export function rayPlaneHit(origin: Vector3, dir: Vector3, planeY: number, maxDist: number, out = new Vector3()): Vector3 | null {
  if (Math.abs(dir.y) < 0.04) return null
  const t = (planeY - origin.y) / dir.y
  if (!(t > 0) || t > maxDist) return null
  return out.copy(origin).addScaledVector(dir, t)
}

/** Perpendicular distance from a point to a ray (dir normalised); Infinity if the point is behind. */
export function rayPointDistance(origin: Vector3, dir: Vector3, p: Vector3): number {
  const v = new Vector3().subVectors(p, origin)
  const along = v.dot(dir)
  if (along <= 0) return Infinity
  return v.addScaledVector(dir, -along).length()
}

/**
 * Dolly toward a fixed world point: the vector from the point to the look-at target is
 * scaled by `f`, so the point keeps its place under the cursor while the view scales
 * around it. f < 1 zooms in.
 */
export function dollyTarget(target: Vector3, point: Vector3, f: number, out = new Vector3()): Vector3 {
  const v = new Vector3().subVectors(target, point)
  return out.copy(point).addScaledVector(v, f)
}

/**
 * Blend weight toward a (possibly moving) focus object after a zoom step. The remaining
 * gap (1 − w) shrinks by `f`, so zooming in converges geometrically on the object and
 * zooming out undoes it symmetrically.
 */
export function focusWeightAfterZoom(w: number, f: number): number {
  return Math.min(1, Math.max(0, 1 - (1 - w) * f))
}

/** Push `pos` out of a sphere (centre, radius) along the centre→pos direction. */
export function pushOutOfSphere(pos: Vector3, centre: Vector3, radius: number): boolean {
  const d = pos.distanceTo(centre)
  if (d >= radius) return false
  if (d < 1e-6) {
    pos.set(centre.x, centre.y + radius, centre.z)
    return true
  }
  pos.sub(centre).multiplyScalar(radius / d).add(centre)
  return true
}
