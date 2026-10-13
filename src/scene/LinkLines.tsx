import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, LineSegments, ShaderMaterial, Vector3 } from 'three'
import { runtime } from './runtime'
import { linkFragment, linkVertex } from './shaders/misc'

const SEG = 28

/** Luminous bezier arcs between related tasks. Endpoints are read from the live anchor positions. */
export function LinkLines({ pairs, opacity }: { pairs: [string, string][]; opacity: () => number }) {
  const ref = useRef<LineSegments>(null)
  const { geo, pos, mat } = useMemo(() => {
    const maxPairs = Math.max(1, pairs.length)
    const pos = new Float32Array(maxPairs * SEG * 2 * 3)
    const t = new Float32Array(maxPairs * SEG * 2)
    for (let p = 0; p < maxPairs; p++)
      for (let i = 0; i < SEG; i++) {
        const o = (p * SEG + i) * 2
        t[o] = i / SEG
        t[o + 1] = (i + 1) / SEG
      }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(pos, 3))
    geo.setAttribute('aT', new BufferAttribute(t, 1))
    const mat = new ShaderMaterial({
      vertexShader: linkVertex,
      fragmentShader: linkFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uColor: { value: new Color('#f0d9a8') }, uTime: { value: 0 }, uOpacity: { value: 1 }, uPhase: { value: 0 } },
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
    const line = ref.current
    if (!line) return
    const op = opacity()
    mat.uniforms.uOpacity!.value = op
    mat.uniforms.uTime!.value = runtime.time
    line.visible = op > 0.01 && pairs.length > 0
    if (!line.visible) return
    let drawn = 0
    pairs.forEach(([ka, kb], p) => {
      const pa = runtime.pos.get(ka)
      const pb = runtime.pos.get(kb)
      if (!pa || !pb) return
      a.copy(pa)
      b.copy(pb)
      // pull the arc towards the system centre so links read as a web, not chords
      c.copy(a).add(b).multiplyScalar(0.5)
      const centre = runtime.pos.get('center')
      if (centre) c.lerp(centre, 0.38)
      for (let i = 0; i < SEG; i++) {
        for (let k = 0; k < 2; k++) {
          const u = (i + k) / SEG
          const iu = 1 - u
          const x = iu * iu * a.x + 2 * iu * u * c.x + u * u * b.x
          const y = iu * iu * a.y + 2 * iu * u * c.y + u * u * b.y
          const z = iu * iu * a.z + 2 * iu * u * c.z + u * u * b.z
          pos.set([x, y, z], ((p * SEG + i) * 2 + k) * 3)
        }
      }
      drawn++
    })
    geo.setDrawRange(0, drawn * SEG * 2)
    ;(geo.getAttribute('position') as BufferAttribute).needsUpdate = true
  })

  return <lineSegments ref={ref} geometry={geo} material={mat} frustumCulled={false} renderOrder={4} />
}
