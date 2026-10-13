import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, Mesh, ShaderMaterial } from 'three'
import { ringGeo } from './geometry'
import { damp } from './math'
import { runtime } from './runtime'
import { ringFragment, ringVertex } from './shaders/misc'

interface Props {
  /** world-space radius of the ring centre line */
  radius: number
  /** ring half thickness (world units) */
  thickness: number
  /** getter so the ring reads fresh values without re-rendering */
  progress: () => number
  opacity: () => number
  color: string
  track?: string
  trackAlpha?: number
  pulse?: boolean
  rotation?: [number, number, number]
  position?: [number, number, number]
  /** how fast the arc follows the value */
  rate?: number
}

/** Circular progress indicator rendered as an in-world ring. */
export function ProgressRing({ radius, thickness, progress, opacity, color, track = '#8fa3c0', trackAlpha = 0.16, pulse, rotation, position, rate = 3 }: Props) {
  const mesh = useRef<Mesh>(null)
  const shown = useRef(progress())
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: ringVertex,
        fragmentShader: ringFragment,
        transparent: true,
        depthWrite: false,
        side: 2,
        uniforms: {
          uColor: { value: new Color() },
          uTrack: { value: new Color() },
          uProgress: { value: 0 },
          uOpacity: { value: 1 },
          uTrackAlpha: { value: 0.16 },
          uTime: { value: 0 },
          uPulse: { value: 0 },
        },
      }),
    [],
  )
  useEffect(() => {
    mat.uniforms.uColor!.value.set(color)
    mat.uniforms.uTrack!.value.set(track)
    mat.uniforms.uTrackAlpha!.value = trackAlpha
    mat.uniforms.uPulse!.value = pulse && !runtime.reducedMotion ? 1 : 0
  }, [mat, color, track, trackAlpha, pulse])
  useEffect(() => () => mat.dispose(), [mat])

  useFrame((_, dt) => {
    const target = progress()
    shown.current = runtime.reducedMotion ? target : damp(shown.current, target, rate, dt)
    const op = opacity()
    mat.uniforms.uProgress!.value = shown.current
    mat.uniforms.uOpacity!.value = op
    mat.uniforms.uTime!.value = runtime.time
    if (mesh.current) mesh.current.visible = op > 0.01
  })

  const half = thickness
  return (
    <mesh ref={mesh} geometry={ringGeo((radius - half) / radius, (radius + half) / radius, 160)} material={mat} scale={radius} rotation={rotation} position={position} />
  )
}
