import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial, Vector3 } from 'three'
import { runtime } from './runtime'
import { linkFragment, linkVertex } from './shaders/misc'

const DOTS = 56

/**
 * Luminous trails between related tasks: a bezier of soft light-dots with pulses of energy
 * travelling along it. Endpoints are read from the live anchor positions each frame.
 */
export function LinkLines({ pairs, opacity, centerKey }: { pairs: [string, string][]; opacity: () => number; centerKey: string }) {
  const ref = useRef<Points>(null)
  const { gl, camera } = useThree()
  const { geo, pos, mat } = useMemo(() => {
    const n = Math.max(1, pairs.length) * DOTS
    const pos = new Float32Array(n * 3)
    const t = new Float32Array(n)
    const phase = new Float32Array(n)
    for (let p = 0; p < Math.max(1, pairs.length); p++)
      for (let i = 0; i < DOTS; i++) {
        t[p * DOTS + i] = i / (DOTS - 1)
        phase[p * DOTS + i] = p * 0.37
      }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(pos, 3))
    geo.setAttribute('aT', new BufferAttribute(t, 1))
    geo.setAttribute('aPhase', new BufferAttribute(phase, 1))
    const mat = new ShaderMaterial({
      vertexShader: linkVertex,
      fragmentShader: linkFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uColor: { value: new Color('#f3dcaa') }, uTime: { value: 0 }, uOpacity: { value: 1 }, uScale: { value: 1 }, uSize: { value: 0.12 } },
    })
    return { geo, pos, mat }
  }, [pairs])
  useEffect(
    () => () => {
      geo.dispose()
      mat.dispose()
    },
    [geo, mat],
  )

  const a = useMemo(() => new Vector3(), [])
  const b = useMemo(() => new Vector3(), [])
  const c = useMemo(() => new Vector3(), [])

  useFrame(() => {
    const pts = ref.current
    if (!pts) return
    const op = opacity()
    mat.uniforms.uOpacity!.value = op
    mat.uniforms.uTime!.value = runtime.reducedMotion ? 0 : runtime.time
    const fov = ('fov' in camera ? (camera as { fov: number }).fov : 45) * (Math.PI / 180)
    mat.uniforms.uScale!.value = (gl.domElement.height * 0.5) / Math.tan(fov / 2)
    pts.visible = op > 0.01 && pairs.length > 0
    if (!pts.visible) return
    let drawn = 0
    pairs.forEach(([ka, kb], p) => {
      const pa = runtime.pos.get(ka)
      const pb = runtime.pos.get(kb)
      if (!pa || !pb) return
      a.copy(pa)
      b.copy(pb)
      // pull the arc towards the system centre so links read as a web, not chords
      c.copy(a).add(b).multiplyScalar(0.5)
      const centre = runtime.pos.get(centerKey)
      if (centre) c.lerp(centre, 0.4)
      for (let i = 0; i < DOTS; i++) {
        const u = i / (DOTS - 1)
        const iu = 1 - u
        pos.set(
          [
            iu * iu * a.x + 2 * iu * u * c.x + u * u * b.x,
            iu * iu * a.y + 2 * iu * u * c.y + u * u * b.y,
            iu * iu * a.z + 2 * iu * u * c.z + u * u * b.z,
          ],
          (p * DOTS + i) * 3,
        )
      }
      drawn++
    })
    geo.setDrawRange(0, drawn * DOTS)
    ;(geo.getAttribute('position') as BufferAttribute).needsUpdate = true
  })

  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} renderOrder={4} />
}
