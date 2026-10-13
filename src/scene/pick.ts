import { Raycaster, Vector2, type Camera, type Mesh, type Object3D } from 'three'
import { useEffect, type RefObject } from 'react'
import { runtime } from './runtime'

/**
 * The invisible hit meshes that already drive hover/click (planets, moons, satellites)
 * are registered here so the camera can aim with the very same geometry — no second
 * picking system. A mesh that is hidden swaps its `raycast` for a no-op, so it is
 * naturally excluded.
 */
export function usePickable(ref: RefObject<Mesh | null>, key: string) {
  useEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    runtime.pickables.set(key, mesh)
    return () => {
      if (runtime.pickables.get(key) === mesh) runtime.pickables.delete(key)
    }
  }, [ref, key])
}

const raycaster = new Raycaster()
const ndc = new Vector2()

export interface PickHit {
  key: string
  distance: number
}

/** Nearest pickable under the cursor (normalised device coordinates), or null. */
export function pickAt(x: number, y: number, camera: Camera): PickHit | null {
  ndc.set(x, y)
  raycaster.setFromCamera(ndc, camera)
  let best: PickHit | null = null
  const hits: Object3D[] = []
  for (const m of runtime.pickables.values()) hits.push(m)
  for (const h of raycaster.intersectObjects(hits, false)) {
    for (const [key, m] of runtime.pickables) {
      if (m === h.object) {
        if (!best || h.distance < best.distance) best = { key, distance: h.distance }
        break
      }
    }
  }
  return best
}

export { raycaster as sharedRaycaster }
